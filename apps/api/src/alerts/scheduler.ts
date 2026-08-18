/**
 * `docs/api.md` §8 — alert scheduler, normative steps 1-7. `tick` is a pure
 * async function over injected deps + `now` (no timers), exported for direct
 * unit testing. `startScheduler` aligns to the next minute boundary and
 * calls `tick` every 60 s thereafter, guarding against overlapping runs.
 */
import type { Pool } from '@dockcast/db';
import type { Logger } from 'pino';
import { localDateString, localParts, zonedTimeToUtc } from '@dockcast/shared';
import { lookup } from '../forecast/lookup.js';
import { alternatives, type AlternativeResult } from '../forecast/alternatives.js';
import {
  listAlertableCities,
  listDueCommutes,
  insertAlertEvent,
  type AlertCommuteRow,
} from '../services/alerts.queries.js';
import { listSubscriptionsForUser } from '../services/push.queries.js';
import { sendToSubscriptions, type PushTransport } from './sender.js';
import { composeAlertBody, titleForKind, type AlertKind } from './compose.js';

export interface SchedulerDeps {
  pool: Pool;
  logger: Logger;
  pushTransport: PushTransport;
}

const NO_ALTERNATIVES: AlternativeResult[] = [];

/** `docs/api.md` §8 steps 3-6 for a single due commute. Returns whether an alert was sent. */
async function processCommute(
  deps: SchedulerDeps,
  cityTz: string,
  commute: AlertCommuteRow,
  now: Date,
): Promise<boolean> {
  const today = localParts(now, cityTz);
  const departAt = zonedTimeToUtc(today, commute.depart_local_time, cityTz);
  const arriveAt = new Date(departAt.getTime() + commute.ride_minutes * 60_000);

  const [originLookup, destLookup] = await Promise.all([
    lookup(deps.pool, { stationPk: commute.origin_station_pk, target: 'bike', at: departAt, now }),
    lookup(deps.pool, { stationPk: commute.dest_station_pk, target: 'dock', at: arriveAt, now }),
  ]);

  // `docs/api.md` §8 step 4: legs with kind != 'forecast' never trigger.
  const originLow =
    originLookup.kind === 'forecast' && originLookup.p !== null && originLookup.p < commute.threshold;
  const destLow =
    destLookup.kind === 'forecast' && destLookup.p !== null && destLookup.p < commute.threshold;

  if (!originLow && !destLow) return false;

  const kind: AlertKind = originLow && destLow ? 'both_low' : originLow ? 'origin_low' : 'dest_low';

  const [originAlternatives, destAlternatives] = await Promise.all([
    originLow
      ? alternatives(deps.pool, { stationPk: commute.origin_station_pk, target: 'bike', at: departAt, now })
      : Promise.resolve(NO_ALTERNATIVES),
    destLow
      ? alternatives(deps.pool, { stationPk: commute.dest_station_pk, target: 'dock', at: arriveAt, now })
      : Promise.resolve(NO_ALTERNATIVES),
  ]);

  const body = composeAlertBody({
    kind,
    tzName: cityTz,
    origin: originLow
      ? {
          stationName: commute.origin_name,
          p: originLookup.p as number,
          at: departAt,
          alternatives: originAlternatives,
        }
      : undefined,
    dest: destLow
      ? {
          stationName: commute.dest_name,
          p: destLookup.p as number,
          at: arriveAt,
          alternatives: destAlternatives,
        }
      : undefined,
  });

  // `docs/api.md` §8 step 5: the SPA route's params, not the API's own query names.
  const url = `/trip?from=${commute.origin_station_pk}&to=${commute.dest_station_pk}&at=${encodeURIComponent(departAt.toISOString())}&ride=${commute.ride_minutes}`;

  const pushPayload = { title: titleForKind(kind), body, url, tag: commute.id };

  const subscriptions = await listSubscriptionsForUser(deps.pool, commute.user_id);
  const delivered = await sendToSubscriptions(
    deps.pool,
    subscriptions,
    pushPayload,
    deps.pushTransport,
    now,
  );

  await insertAlertEvent(deps.pool, {
    commuteId: commute.id,
    localDate: localDateString(now, cityTz),
    kind,
    payload: {
      origin: originLow ? { p: originLookup.p, alternatives: originAlternatives } : null,
      dest: destLow ? { p: destLookup.p, alternatives: destAlternatives } : null,
      push: pushPayload,
    },
    delivered,
  });

  return true;
}

/** One scheduler pass at instant `now`. Exported for direct unit testing (no timers). */
export async function tick(deps: SchedulerDeps, now: Date): Promise<void> {
  const cities = await listAlertableCities(deps.pool);
  let due = 0;
  let sent = 0;

  for (const city of cities) {
    const local = localParts(now, city.tz);
    const commutes = await listDueCommutes(deps.pool, {
      cityId: city.id,
      todayDow: local.dow,
      nowMinuteOfDay: local.minuteOfDay,
      todayDate: localDateString(now, city.tz),
    });
    due += commutes.length;

    // Commutes are processed serially by design — single-replica scheduler
    // (`docs/architecture.md` §2), no need for cross-commute concurrency.
    for (const commute of commutes) {
      const wasSent = await processCommute(deps, city.tz, commute, now);
      if (wasSent) sent += 1;
    }
  }

  deps.logger.info(
    { event: 'alert_scheduler_tick', cities: cities.length, due, sent },
    'alert scheduler tick',
  );
}

export interface StartSchedulerDeps extends SchedulerDeps {
  now?: () => Date;
}

export interface SchedulerHandle {
  stop: () => void;
}

/**
 * Aligns to the next `:00` boundary, then ticks every 60 s. A `running`
 * guard skips a tick if the previous one hasn't finished (never overlaps).
 */
export function startScheduler(deps: StartSchedulerDeps): SchedulerHandle {
  const now = deps.now ?? ((): Date => new Date());
  let running = false;
  let intervalHandle: NodeJS.Timeout | undefined;

  async function safeTick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      await tick(deps, now());
    } catch (err) {
      deps.logger.error({ err }, 'alert scheduler tick failed');
    } finally {
      running = false;
    }
  }

  const msUntilNextMinute = 60_000 - (now().getTime() % 60_000);
  const timeoutHandle = setTimeout(() => {
    void safeTick();
    intervalHandle = setInterval(() => {
      void safeTick();
    }, 60_000);
  }, msUntilNextMinute);

  return {
    stop: () => {
      clearTimeout(timeoutHandle);
      if (intervalHandle) clearInterval(intervalHandle);
    },
  };
}
