/**
 * Weather fetch (`docs/collector-spec.md` §5). On boot, then every
 * `WEATHER_INTERVAL_MS`: fetch the Open-Meteo hourly forecast for the city
 * centroid, parse the parallel `hourly.*` arrays into rows, and upsert into
 * `weather_forecasts` (`ON CONFLICT DO NOTHING` — forecasts are immutable
 * once fetched, keyed by `(city_id, fetched_at, valid_hour)`).
 */
import { unnestParams, type Pool, type UnnestColumn } from '@dockcast/db';
import type { Logger } from 'pino';
import { fetchJson, type FetchImpl } from './http.js';
import { recordPollFailure, type CityRow } from './db.js';

const WEATHER_COLUMNS: UnnestColumn[] = [
  { name: 'city_id', type: 'int' },
  { name: 'fetched_at', type: 'timestamptz' },
  { name: 'valid_hour', type: 'timestamptz' },
  { name: 'temp_c', type: 'real' },
  { name: 'precip_mm', type: 'real' },
  { name: 'precip_prob', type: 'smallint' },
  { name: 'wind_kmh', type: 'real' },
  { name: 'weather_code', type: 'smallint' },
];

export interface WeatherHourlyRow {
  valid_hour: Date;
  temp_c: number | null;
  precip_mm: number | null;
  precip_prob: number | null;
  wind_kmh: number | null;
  weather_code: number | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asRecord(v: unknown, context: string): Record<string, unknown> {
  if (!isRecord(v)) throw new Error(`Open-Meteo response: expected an object for ${context}`);
  return v;
}

function toNullableNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Pure: parsed Open-Meteo forecast response -> rows (collector-spec.md §5). */
export function parseOpenMeteoForecast(json: unknown): WeatherHourlyRow[] {
  const obj = asRecord(json, 'forecast document');
  const hourly = asRecord(obj.hourly, 'forecast document .hourly');

  const time = hourly.time;
  const temp = hourly.temperature_2m;
  const precip = hourly.precipitation;
  const precipProb = hourly.precipitation_probability;
  const wind = hourly.wind_speed_10m;
  const code = hourly.weather_code;

  const arrays: unknown[] = [time, temp, precip, precipProb, wind, code];
  if (arrays.some((a) => !Array.isArray(a))) {
    throw new Error('Open-Meteo response is missing one or more required hourly arrays');
  }
  const n = (time as unknown[]).length;
  if (arrays.some((a) => (a as unknown[]).length !== n)) {
    throw new Error(`Open-Meteo hourly arrays have mismatched lengths (expected ${n})`);
  }

  const rows: WeatherHourlyRow[] = [];
  for (let i = 0; i < n; i++) {
    const t = (time as unknown[])[i];
    if (typeof t !== 'string') {
      throw new Error(`Open-Meteo hourly.time[${i}] is not a string`);
    }
    rows.push({
      valid_hour: new Date(`${t}:00Z`),
      temp_c: toNullableNumber((temp as unknown[])[i]),
      precip_mm: toNullableNumber((precip as unknown[])[i]),
      precip_prob: toNullableNumber((precipProb as unknown[])[i]),
      wind_kmh: toNullableNumber((wind as unknown[])[i]),
      weather_code: toNullableNumber((code as unknown[])[i]),
    });
  }
  return rows;
}

function buildOpenMeteoUrl(lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: 'temperature_2m,precipitation,precipitation_probability,wind_speed_10m,weather_code',
    forecast_days: '3',
    timezone: 'UTC',
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

export interface WeatherFetchParams {
  pool: Pool;
  city: CityRow;
  logger: Logger;
  now?: Date;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
}

export interface WeatherFetchResult {
  ok: boolean;
  n: number;
  error?: string;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runWeatherFetch(params: WeatherFetchParams): Promise<WeatherFetchResult> {
  const { pool, city, logger } = params;
  const t_start = Date.now();
  const now = params.now ?? new Date();
  const fetched_at = new Date(Math.floor(now.getTime() / 1000) * 1000);

  try {
    const url = buildOpenMeteoUrl(city.lat, city.lon);
    const json = await fetchJson(url, { fetchImpl: params.fetchImpl, timeoutMs: params.timeoutMs });
    const rows = parseOpenMeteoForecast(json);

    const cols = unnestParams(
      rows.map((r) => ({
        city_id: city.id,
        fetched_at,
        valid_hour: r.valid_hour,
        temp_c: r.temp_c,
        precip_mm: r.precip_mm,
        precip_prob: r.precip_prob,
        wind_kmh: r.wind_kmh,
        weather_code: r.weather_code,
      })),
      WEATHER_COLUMNS,
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO weather_forecasts (city_id, fetched_at, valid_hour, temp_c, precip_mm, precip_prob, wind_kmh, weather_code)
         SELECT * FROM ${cols.placeholders}
         ON CONFLICT DO NOTHING`,
        cols.values,
      );
      await client.query(
        `INSERT INTO poll_log (city_id, polled_at, feed, ok, n_items, latency_ms, error)
         VALUES ($1, $2, 'weather', true, $3, $4, NULL)`,
        [city.id, now, rows.length, Date.now() - t_start],
      );
      await client.query(
        `INSERT INTO feed_state (city_id, feed, last_attempt_at, last_ok_at, last_error)
         VALUES ($1, 'weather', $2, $2, NULL)
         ON CONFLICT (city_id, feed) DO UPDATE SET
           last_attempt_at = EXCLUDED.last_attempt_at, last_ok_at = EXCLUDED.last_ok_at, last_error = NULL`,
        [city.id, now],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const latency_ms = Date.now() - t_start;
    logger.info({ event: 'weather_cycle', city: city.slug, ok: true, n: rows.length, latency_ms });
    return { ok: true, n: rows.length };
  } catch (err) {
    const latency_ms = Date.now() - t_start;
    const message = errMsg(err);
    await recordPollFailure(pool, city.id, 'weather', now, latency_ms, message, logger);
    logger.info({ event: 'weather_cycle', city: city.slug, ok: false, error: message, latency_ms });
    return { ok: false, n: 0, error: message };
  }
}
