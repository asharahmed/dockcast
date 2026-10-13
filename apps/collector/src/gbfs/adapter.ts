/**
 * GBFS adapter (`docs/collector-spec.md` §2). One code path handles GBFS
 * 1.x, 2.x and 3.0: everything version-specific is isolated in the pure
 * `normalise*()` functions (parsed JSON in, typed data out, `GbfsSchemaError`
 * on missing required structure). Network I/O lives only in the
 * `discover()`/`fetch*()` wrappers, which accept an injectable `fetchImpl`.
 */
import { fetchJson, type FetchImpl } from '../http.js';
import {
  GbfsSchemaError,
  type FeedMap,
  type NormalizedStationInfo,
  type NormalizedStationStatus,
  type VehicleTypeMap,
} from './types.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asRecord(v: unknown, context: string): Record<string, unknown> {
  if (!isRecord(v)) throw new GbfsSchemaError(`Expected an object for ${context}`);
  return v;
}

function idOf(raw: unknown): string {
  return raw === undefined || raw === null ? '' : String(raw);
}

// ---------------------------------------------------------------------------
// §2.1 Version detection & discovery
// ---------------------------------------------------------------------------

function collectFeeds(raw: unknown, into: Map<string, string>, context: string): void {
  if (!Array.isArray(raw)) {
    throw new GbfsSchemaError(`${context} is not an array`);
  }
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const { name, url } = entry;
    if (typeof name === 'string' && typeof url === 'string') into.set(name, url);
  }
}

/** Pure: parsed discovery document (`gbfs.json`) → `{version, feeds}`. */
export function normaliseDiscovery(json: unknown): FeedMap {
  const obj = asRecord(json, 'discovery document');
  const versionRaw = obj.version;
  const version =
    typeof versionRaw === 'string' || typeof versionRaw === 'number' ? String(versionRaw) : '2.0';
  const major = Number.parseInt(version, 10);
  const data = asRecord(obj.data, 'discovery document .data');

  const feeds = new Map<string, string>();
  if (Number.isFinite(major) && major >= 3) {
    collectFeeds(data.feeds, feeds, 'discovery document (v3+) .data.feeds');
  } else {
    const langKeys = Object.keys(data);
    const lang = langKeys.includes('en') ? 'en' : langKeys[0];
    if (lang === undefined) {
      throw new GbfsSchemaError('discovery document: .data has no language keys');
    }
    const langObj = asRecord(data[lang], `discovery document .data.${lang}`);
    collectFeeds(langObj.feeds, feeds, `discovery document .data.${lang}.feeds`);
  }

  if (!feeds.has('station_information')) {
    throw new GbfsSchemaError('discovery document is missing the required station_information feed');
  }
  if (!feeds.has('station_status')) {
    throw new GbfsSchemaError('discovery document is missing the required station_status feed');
  }

  return { version, feeds };
}

export interface DiscoverOptions {
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
  /** Injectable clock; defaults to `new Date()`. */
  now?: Date;
}

interface DiscoveryCacheEntry {
  fetchedAt: number;
  feedMap: FeedMap;
}

const DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000;
const discoveryCache = new Map<string, DiscoveryCacheEntry>();

/**
 * `fetchJson(gbfsUrl)` + `normaliseDiscovery`, cached per `gbfsUrl` for 1 h.
 * A failed discovery leaves the previous cache entry in place; if there is no
 * cached entry, the failure propagates (collector-spec.md §2.1.4).
 */
export async function discover(gbfsUrl: string, opts: DiscoverOptions = {}): Promise<FeedMap> {
  const nowMs = (opts.now ?? new Date()).getTime();
  const cached = discoveryCache.get(gbfsUrl);
  if (cached && nowMs - cached.fetchedAt < DISCOVERY_CACHE_TTL_MS) {
    return cached.feedMap;
  }
  try {
    const json = await fetchJson(gbfsUrl, opts);
    const feedMap = normaliseDiscovery(json);
    discoveryCache.set(gbfsUrl, { fetchedAt: nowMs, feedMap });
    return feedMap;
  } catch (err) {
    if (cached) return cached.feedMap;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// §2.2 station_information -> NormalizedStationInfo
// ---------------------------------------------------------------------------

function toFiniteNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function toCapacity(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0 ? v : null;
}

/**
 * 3.0: `[{text, language}]`, prefer `language === 'en'`, else first entry. 1.x/2.x: string/number.
 * Leading/trailing whitespace is trimmed (Toronto's feed has 59 names like " Grafton Ave /
 * Roncesvalles Ave", which otherwise sort to the top of every list); internal spacing is kept
 * exactly. A name that is only whitespace counts as missing.
 */
function extractName(raw: unknown): string | undefined {
  let text: string | undefined;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return undefined;
    const en = raw.find((entry) => isRecord(entry) && entry.language === 'en');
    const chosen = en ?? raw[0];
    if (isRecord(chosen) && typeof chosen.text === 'string') text = chosen.text;
  } else if (typeof raw === 'string') {
    text = raw;
  } else if (typeof raw === 'number') {
    text = String(raw);
  }
  const trimmed = text?.trim();
  return trimmed ? trimmed : undefined;
}

export interface NormaliseStationInformationResult {
  stations: NormalizedStationInfo[];
  n_skipped: number;
}

/** Pure: parsed `station_information` document → rows (collector-spec.md §2.2). */
export function normaliseStationInformation(json: unknown): NormaliseStationInformationResult {
  const obj = asRecord(json, 'station_information document');
  const data = asRecord(obj.data, 'station_information document .data');
  const stationsRaw = data.stations;
  if (!Array.isArray(stationsRaw)) {
    throw new GbfsSchemaError('station_information document: data.stations is not an array');
  }

  const stations: NormalizedStationInfo[] = [];
  let n_skipped = 0;

  for (const raw of stationsRaw) {
    const rec = asRecord(raw, 'station_information station entry');

    const station_id = idOf(rec.station_id);
    if (station_id === '') {
      n_skipped++;
      continue;
    }

    const lat = toFiniteNumber(rec.lat);
    const lon = toFiniteNumber(rec.lon);
    if (lat === undefined || lon === undefined) {
      n_skipped++;
      continue;
    }

    const name = extractName(rec.name) ?? station_id;
    const capacity = toCapacity(rec.capacity);

    stations.push({ station_id, name, lat, lon, capacity });
  }

  return { stations, n_skipped };
}

export interface AdapterFetchOptions {
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
}

/** Network + normalise for the `station_information` feed. Not cached (info sync is already interval-gated). */
export async function fetchStationInformation(
  url: string,
  opts: AdapterFetchOptions = {},
): Promise<NormaliseStationInformationResult> {
  const json = await fetchJson(url, opts);
  return normaliseStationInformation(json);
}

// ---------------------------------------------------------------------------
// §2.3 station_status -> NormalizedStationStatus
// ---------------------------------------------------------------------------

export interface CountResult {
  value: number;
  clamped: boolean;
}

/**
 * `typeof v === 'number' && finite` → `max(0, trunc(v))`; numeric string →
 * same after `Number(v)`; anything else → `undefined` (caller decides
 * skip/null). Negative values clamp to 0 and set `clamped`.
 */
export function toCount(v: unknown): CountResult | undefined {
  let n: number | undefined;
  if (typeof v === 'number' && Number.isFinite(v)) {
    n = v;
  } else if (typeof v === 'string' && v.trim() !== '') {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) n = parsed;
  }
  if (n === undefined) return undefined;
  const truncated = Math.trunc(n);
  const clamped = truncated < 0;
  return { value: clamped ? 0 : truncated, clamped };
}

/** `true`, `1`, `'1'`, `'true'` → `true`; everything else (including missing) → `false`. */
export function toBool(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 'true';
}

const MIN_VALID_LAST_REPORTED_MS = Date.UTC(2000, 0, 1);

/** Unix seconds → `Date`; RFC3339 string → `Date`; missing/invalid/`< 2000-01-01` → `now`. */
function parseLastReported(v: unknown, now: Date): Date {
  let candidate: Date | undefined;
  if (typeof v === 'number' && Number.isFinite(v)) {
    candidate = new Date(v * 1000);
  } else if (typeof v === 'string') {
    const parsed = new Date(v);
    if (!Number.isNaN(parsed.getTime())) candidate = parsed;
  }
  if (
    candidate === undefined ||
    Number.isNaN(candidate.getTime()) ||
    candidate.getTime() < MIN_VALID_LAST_REPORTED_MS
  ) {
    return now;
  }
  return candidate;
}

interface EbikesResult {
  value: number | null;
  clamped: number;
}

/** §2.3.1: first applicable rule wins. */
function computeEbikes(rec: Record<string, unknown>, vehicleTypes: VehicleTypeMap | null): EbikesResult {
  // Rule 1: num_ebikes_available (Citi Bike 2.3).
  if (rec.num_ebikes_available !== undefined) {
    const r = toCount(rec.num_ebikes_available);
    return r ? { value: r.value, clamped: r.clamped ? 1 : 0 } : { value: null, clamped: 0 };
  }

  // Rule 2: num_bikes_available_types.ebike (Toronto 1.x/2.x).
  const typesAvail = rec.num_bikes_available_types;
  if (isRecord(typesAvail) && typesAvail.ebike !== undefined) {
    const r = toCount(typesAvail.ebike);
    return r ? { value: r.value, clamped: r.clamped ? 1 : 0 } : { value: null, clamped: 0 };
  }

  // Rule 3: vehicle_types_available summed via a VehicleTypeMap (Toronto 3.0).
  const vtAvail = rec.vehicle_types_available;
  if (Array.isArray(vtAvail) && vehicleTypes) {
    let sum = 0;
    let clamped = 0;
    for (const entry of vtAvail) {
      if (!isRecord(entry)) continue;
      const vtid = entry.vehicle_type_id;
      if (typeof vtid !== 'string') continue;
      const propulsion = vehicleTypes.get(vtid);
      if (propulsion !== 'electric' && propulsion !== 'electric_assist') continue;
      const r = toCount(entry.count);
      if (r) {
        sum += r.value;
        if (r.clamped) clamped++;
      }
    }
    return { value: sum, clamped };
  }

  // Rule 4: no applicable source.
  return { value: null, clamped: 0 };
}

export interface NormaliseStationStatusResult {
  rows: NormalizedStationStatus[];
  n_clamped: number;
  n_skipped: number;
}

/** Pure: parsed `station_status` document → rows (collector-spec.md §2.3). */
export function normaliseStationStatus(
  json: unknown,
  vehicleTypes: VehicleTypeMap | null,
  now: Date,
): NormaliseStationStatusResult {
  const obj = asRecord(json, 'station_status document');
  const data = asRecord(obj.data, 'station_status document .data');
  const stationsRaw = data.stations;
  if (!Array.isArray(stationsRaw)) {
    throw new GbfsSchemaError('station_status document: data.stations is not an array');
  }

  const rows: NormalizedStationStatus[] = [];
  let n_clamped = 0;
  let n_skipped = 0;

  for (const raw of stationsRaw) {
    const rec = asRecord(raw, 'station_status station entry');

    const station_id = idOf(rec.station_id);
    if (station_id === '') {
      n_skipped++;
      continue;
    }

    const bikesResult = toCount(rec.num_vehicles_available ?? rec.num_bikes_available);
    if (!bikesResult) {
      n_skipped++;
      continue;
    }
    const docksResult = toCount(rec.num_docks_available);
    if (!docksResult) {
      n_skipped++;
      continue;
    }

    const bikesDisabledResult = toCount(rec.num_vehicles_disabled ?? rec.num_bikes_disabled);
    const docksDisabledResult = toCount(rec.num_docks_disabled);
    const ebikesResult = computeEbikes(rec, vehicleTypes);

    if (bikesResult.clamped) n_clamped++;
    if (docksResult.clamped) n_clamped++;
    if (bikesDisabledResult?.clamped) n_clamped++;
    if (docksDisabledResult?.clamped) n_clamped++;
    n_clamped += ebikesResult.clamped;

    rows.push({
      station_id,
      bikes: bikesResult.value,
      docks: docksResult.value,
      ebikes: ebikesResult.value,
      bikes_disabled: bikesDisabledResult ? bikesDisabledResult.value : null,
      docks_disabled: docksDisabledResult ? docksDisabledResult.value : null,
      is_installed: toBool(rec.is_installed),
      is_renting: toBool(rec.is_renting),
      is_returning: toBool(rec.is_returning),
      last_reported: parseLastReported(rec.last_reported, now),
    });
  }

  return { rows, n_clamped, n_skipped };
}

/** Network + normalise for the `station_status` feed. */
export async function fetchStationStatus(
  url: string,
  vehicleTypes: VehicleTypeMap | null,
  now: Date,
  opts: AdapterFetchOptions = {},
): Promise<NormaliseStationStatusResult> {
  const json = await fetchJson(url, opts);
  return normaliseStationStatus(json, vehicleTypes, now);
}

// ---------------------------------------------------------------------------
// §2.3.1 vehicle_types -> VehicleTypeMap
// ---------------------------------------------------------------------------

/** Pure: parsed `vehicle_types` document → `vehicle_type_id -> propulsion_type`. */
export function normaliseVehicleTypes(json: unknown): VehicleTypeMap {
  const obj = asRecord(json, 'vehicle_types document');
  const data = asRecord(obj.data, 'vehicle_types document .data');
  const list = data.vehicle_types;
  if (!Array.isArray(list)) {
    throw new GbfsSchemaError('vehicle_types document: data.vehicle_types is not an array');
  }
  const map: VehicleTypeMap = new Map();
  for (const raw of list) {
    if (!isRecord(raw)) continue;
    const id = raw.vehicle_type_id;
    const propulsion = raw.propulsion_type;
    if (typeof id === 'string' && typeof propulsion === 'string') {
      map.set(id, propulsion);
    }
  }
  return map;
}

/** Network + normalise for the `vehicle_types` feed. Not cached here (see `information.ts`). */
export async function fetchVehicleTypes(
  url: string,
  opts: AdapterFetchOptions = {},
): Promise<VehicleTypeMap> {
  const json = await fetchJson(url, opts);
  return normaliseVehicleTypes(json);
}
