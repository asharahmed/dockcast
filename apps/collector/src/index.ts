/**
 * @dockcast/collector — GBFS + Open-Meteo poller (docs/collector-spec.md,
 * docs/plan.md WP-3).
 *
 * Boot order (collector-spec.md §6): config -> pool -> waitForSchema -> load
 * active cities -> per city: information sync (awaited) -> start status +
 * weather intervals. SIGTERM/SIGINT stop all intervals (awaiting any
 * in-flight cycle, max 30 s), close the pool, and exit 0.
 */
import { waitForSchema } from '@dockcast/db';
import type { Pool } from '@dockcast/db';
import { loadConfig } from './config.js';
import { createLogger } from './log.js';
import { createPool, loadActiveCities, loadIdMap, type CityRow } from './db.js';
import { runInformationSync } from './information.js';
import { runStatusCycle } from './status.js';
import { runWeatherFetch } from './weather.js';
import { startInterval, type IntervalHandle } from './scheduler.js';
import { pingHealthchecks } from './heartbeat.js';
import type { LastState, VehicleTypeMap } from './gbfs/types.js';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface CityHandle {
  city: CityRow;
  idMap: Map<string, number>;
  lastState: Map<number, LastState>;
  vehicleTypesRef: { current: VehicleTypeMap | null };
  needsInfoRefresh: boolean;
  lastStatusOk: boolean;
  intervals: IntervalHandle[];
}

function allCitiesOk(handles: CityHandle[]): boolean {
  return handles.length > 0 && handles.every((h) => h.lastStatusOk);
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createLogger(config.logLevel);
  const pool: Pool = createPool(config.databaseUrl);

  try {
    await waitForSchema(pool, config.migrationsDir);
  } catch (err) {
    logger.error({ event: 'boot_failed', error: errMsg(err) }, 'schema is not ready');
    await pool.end();
    process.exit(1);
  }

  const cities = await loadActiveCities(pool, config.cities);
  if (cities.length === 0) {
    logger.warn({ event: 'no_active_cities' }, 'no active cities to poll');
  }

  const cityHandles: CityHandle[] = [];

  for (const city of cities) {
    const idMap = await loadIdMap(pool, city.id);
    const handle: CityHandle = {
      city,
      idMap,
      lastState: new Map(),
      vehicleTypesRef: { current: null },
      needsInfoRefresh: false,
      lastStatusOk: false,
      intervals: [],
    };
    cityHandles.push(handle);

    const infoResult = await runInformationSync({
      pool,
      city: handle.city,
      idMap: handle.idMap,
      vehicleTypesRef: handle.vehicleTypesRef,
      logger,
      timeoutMs: config.httpTimeoutMs,
    });
    if (!infoResult.ok) {
      logger.warn(
        { event: 'initial_information_sync_failed', city: city.slug, error: infoResult.error },
        'starting status polling anyway; rows will be dropped as unknown until a sync succeeds',
      );
    }

    const statusInterval = startInterval(
      `${city.slug}:station_status`,
      config.pollIntervalMs,
      async () => {
        if (handle.needsInfoRefresh) {
          handle.needsInfoRefresh = false;
          await runInformationSync({
            pool,
            city: handle.city,
            idMap: handle.idMap,
            vehicleTypesRef: handle.vehicleTypesRef,
            logger,
            timeoutMs: config.httpTimeoutMs,
          });
        }

        const result = await runStatusCycle({
          pool,
          city: handle.city,
          idMap: handle.idMap,
          vehicleTypes: handle.vehicleTypesRef.current,
          lastState: handle.lastState,
          logger,
          timeoutMs: config.httpTimeoutMs,
        });
        handle.lastStatusOk = result.ok;
        if (result.n_unknown > 0) handle.needsInfoRefresh = true;

        if (allCitiesOk(cityHandles)) {
          await pingHealthchecks(config.healthchecksCollectorUrl, logger);
        }
      },
      logger,
    );
    handle.intervals.push(statusInterval);

    // immediate: false — the "on boot" information sync already ran above
    // (collector-spec.md §4, §6); this interval only fires from here on.
    const infoInterval = startInterval(
      `${city.slug}:station_information`,
      config.infoIntervalMs,
      async () => {
        const result = await runInformationSync({
          pool,
          city: handle.city,
          idMap: handle.idMap,
          vehicleTypesRef: handle.vehicleTypesRef,
          logger,
          timeoutMs: config.httpTimeoutMs,
        });
        if (result.ok) handle.needsInfoRefresh = false;
      },
      logger,
      { immediate: false },
    );
    handle.intervals.push(infoInterval);

    const weatherInterval = startInterval(
      `${city.slug}:weather`,
      config.weatherIntervalMs,
      async () => {
        await runWeatherFetch({ pool, city: handle.city, logger, timeoutMs: config.httpTimeoutMs });
      },
      logger,
    );
    handle.intervals.push(weatherInterval);
  }

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ event: 'shutdown_started', signal });

    const stopAll = Promise.all(cityHandles.flatMap((h) => h.intervals.map((iv) => iv.stop())));
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 30_000));
    await Promise.race([stopAll, timeout]);

    await pool.end();
    logger.info({ event: 'shutdown_complete' });
    process.exit(0);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.info({ event: 'boot_complete', n_cities: cities.length });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
