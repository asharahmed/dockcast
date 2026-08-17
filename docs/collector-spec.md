# DockCast — Collector Specification (v1)

Status: PLANNING DRAFT for approval. Normative once approved. Companion docs:
`architecture.md`, `ml-spec.md` §1, `api.md`, `infra.md`, schema `db/migrations/0001_init.sql`.

The collector is the single long-running Node process that turns public GBFS
feeds and Open-Meteo forecasts into rows in Postgres. It never computes
forecasts. Everything downstream (predictor, trainer, API) assumes the
guarantees in §3–§5; if the collector is wrong, labels and features are wrong.

---------------------------------------------------------------------------

## 1. Package layout — `apps/collector` (`@dockcast/collector`)

```
apps/collector/
├── package.json            # "type": "module"; deps: @dockcast/db, @dockcast/shared, pino, zod; dev: vitest, tsx, typescript
├── tsconfig.json           # extends ../../tsconfig.base.json; outDir dist
├── Dockerfile              # see infra.md
├── src/
│   ├── index.ts            # boot: load config, assert migrations current, build id maps, start schedulers, signal handling
│   ├── config.ts           # zod-validated env (see §7)
│   ├── db.ts               # createPool() from @dockcast/db + typed helpers used only by the collector
│   ├── http.ts             # fetchJson(url, {timeoutMs}) with AbortController + User-Agent (see §2.4)
│   ├── gbfs/
│   │   ├── types.ts        # NormalizedStationInfo, NormalizedStationStatus, FeedMap, GbfsVersion, VehicleTypeMap
│   │   └── adapter.ts      # discover(), fetchStationInformation(), fetchStationStatus(), fetchVehicleTypes(), pure normalise*() fns
│   ├── status.ts           # runStatusCycle(city) — §3
│   ├── information.ts      # runInformationSync(city) — §4
│   ├── weather.ts          # runWeatherFetch(city) — §5
│   ├── heartbeat.ts        # pingHealthchecks(url) — §3.6
│   ├── scheduler.ts        # non-overlapping interval runner (see §6)
│   └── log.ts              # pino instance (JSON lines)
└── test/
    ├── adapter.test.ts     # normalisation vs every fixture (§8.1)
    ├── change.test.ts      # change-detection (§8.2)
    ├── weather.test.ts     # Open-Meteo parsing vs fixture (§8.3)
    └── cycle.db.test.ts    # DB integration (§8.4), only runs when DATABASE_URL_TEST is set
```

Fixtures used by tests live in `/fixtures/gbfs/*.json` and `/fixtures/weather/*.json`
(repo root). Tests read them by path relative to the repo root (`new URL('../../../fixtures/…', import.meta.url)`).

`@dockcast/db` contract this package relies on (implemented in `packages/db`):
- `createPool(databaseUrl: string): pg.Pool` — sets type parsers (`int8`→number, `numeric`→number, `timestamptz`→`Date`), `application_name='dockcast-collector'`, `max: 5`.
- `waitForSchema(pool, migrationsDir?, { timeoutMs = 300_000, intervalMs = 2_000 }): Promise<void>` — resolves once every file in `db/migrations/*.sql` is present in `schema_migrations(version int PK, name text, checksum text, applied_at timestamptz)`; throws after the timeout (the collector then exits 1 and compose restarts it). The migrator (run by `api` on boot and by `pnpm db:migrate`) creates `schema_migrations` itself; migration file version = leading integer of the filename (`0001_init.sql` → 1).
- Docker images for the collector and workers COPY `db/migrations` so the check can run (see infra.md).

---------------------------------------------------------------------------

## 2. GBFS adapter (`src/gbfs/adapter.ts`) — normative

One code path handles GBFS 1.x, 2.x and 3.0. Everything version-specific is
isolated in the pure functions `normaliseDiscovery`, `normaliseStationInformation`,
`normaliseStationStatus`, `normaliseVehicleTypes` (each takes parsed JSON, returns
typed data, throws `GbfsSchemaError` on missing required structure). Network I/O
lives only in `discover()/fetch*()` wrappers.

### 2.1 Version detection & discovery

`discover(gbfsUrl)`:
1. `fetchJson(gbfsUrl)`; `version = String(json.version ?? '2.0')`; `major = parseInt(version)`.
2. Feeds:
   - `major >= 3`: `json.data.feeds[]` → `{name, url}`.
   - else: `json.data` is a map keyed by language. Choose key `'en'` if present, else the first key in object order. Feeds = `json.data[lang].feeds[]`.
3. Result `FeedMap = { version, feeds: Map<name, url> }`. Required: `station_information`, `station_status`. Optional: `vehicle_types`. Missing required → `GbfsSchemaError`.
4. Cache per city for **1 h** (in-memory `{fetchedAt, feedMap}`); a failed discovery leaves the previous cache in place; if no cache exists the cycle fails.

Fixture cases: `toronto_v3_gbfs.json` (version "3.0", `data.feeds`), `citibike_v23_gbfs.json` (version "2.3", `data.en/fr/es`), and a synthetic v1 object with no `version` and `data.en.feeds` (construct in test).

### 2.2 station_information → `NormalizedStationInfo`

```
{ station_id: string; name: string; lat: number; lon: number; capacity: number | null }
```
| field | 1.x / 2.x | 3.0 | rule |
|---|---|---|---|
| `station_id` | string (some feeds emit numbers) | string | `String(x.station_id)`; skip station if empty |
| `name` | string | `[{text, language}]` | 3.0: entry with `language === 'en'` else first entry's `text`; 2.x: `String(name)`; if missing → `station_id` |
| `lat`,`lon` | number | number | must be finite numbers; otherwise **skip station** and count in `n_skipped` |
| `capacity` | number? | number? | finite integer ≥ 0 → value; else `null` |

Fixtures: `toronto_v3_station_information.json` (1058 stations, name arrays, `capacity` present for all), `toronto_v2_station_information.json` (string names). Assert station `7000` → name `"Fort York  Blvd / Capreol Ct"` (note two spaces — do not trim internal whitespace; only `.trim()` ends), lat `43.63970679931218`, lon `-79.39614309573555`, capacity `47` in **both**.

### 2.3 station_status → `NormalizedStationStatus`

```
{ station_id: string; bikes: number; docks: number; ebikes: number | null;
  bikes_disabled: number | null; docks_disabled: number | null;
  is_installed: boolean; is_renting: boolean; is_returning: boolean; last_reported: Date }
```
| target | 1.x / 2.x source | 3.0 source | coercion |
|---|---|---|---|
| `bikes` | `num_bikes_available` | `num_vehicles_available` | `toCount()` (below); missing → **skip station** (required) |
| `docks` | `num_docks_available` | `num_docks_available` | `toCount()`; missing → skip station |
| `bikes_disabled` | `num_bikes_disabled` | `num_vehicles_disabled` | `toCount()` or `null` if missing |
| `docks_disabled` | `num_docks_disabled` | `num_docks_disabled` | `toCount()` or `null` |
| `ebikes` | see §2.3.1 | see §2.3.1 | number or `null` |
| `is_installed/renting/returning` | `0/1`, `true/false`, `"0"/"1"` | boolean | `toBool()` (below); missing → `false` |
| `last_reported` | unix **seconds** (number) | RFC3339 string | number → `new Date(n*1000)`; string → `new Date(s)`; missing/invalid (`NaN`) or `< 2000-01-01` → poll instant (`now`) |

- `toCount(v)`: `typeof v === 'number' && Number.isFinite(v)` → `Math.max(0, Math.trunc(v))`; numeric string → same after `Number(v)`; anything else → `undefined` (caller decides skip/null). Negative values are clamped to 0 **and** counted in `n_clamped`; log one warning per cycle with `n_clamped` if > 0.
- `toBool(v)`: `v === true || v === 1 || v === '1' || v === 'true'` → `true`; otherwise `false`.
- Stations in status but not in the id map (§3.2) are dropped from the write and counted as `n_unknown`.

Note: Citi Bike emits placeholder rows with `last_reported: 86400` (1970-01-02) and all flags 0 — the `< 2000-01-01` rule maps `last_reported` to `now`, but the flags keep the station non-fresh; that is the desired outcome.

#### 2.3.1 e-bikes
Evaluate in order; first applicable wins:
1. `num_ebikes_available` present → `toCount()` (Citi Bike 2.3).
2. `num_bikes_available_types.ebike` present → `toCount()` (Toronto 1.x/2.x).
3. `vehicle_types_available: [{vehicle_type_id, count}]` present **and** a `VehicleTypeMap` is available → sum of `toCount(count)` over entries whose `vehicle_type_id` maps to `propulsion_type ∈ {'electric','electric_assist'}` (Toronto 3.0).
4. else `null`.

`VehicleTypeMap = Map<vehicle_type_id, propulsion_type>` from the `vehicle_types` feed (`data.vehicle_types[]`, same shape in 2.3 and 3.0). Cached 1 h per city; if the feed is missing or fails, keep the last map; if none, rule 3 is unavailable → `null`.

Fixture assertions (all three status fixtures were captured within seconds of each other; assert per fixture, not across):
- `toronto_v3_station_status.json` + `toronto_v3_vehicle_types.json`: station `7000` → `bikes 3, docks 44, ebikes 0, bikes_disabled 0, docks_disabled 0, flags true, last_reported = 2026-08-17T17:29:47.637Z`; station `7001` → `ebikes 10, bikes 11, docks 7`.
- `toronto_v2_station_status.json`: `7000` → `bikes 3, docks 44, ebikes 0, last_reported = new Date(1786987534*1000)`; `7001` → `ebikes 11, bikes 12`.
- `citibike_v23_station_status_sample.json` (20 rows): first station `2235288981858690806` → `bikes 0, docks 0, ebikes 0, flags false`, `last_reported` equals the injected `now` (86400 rule).
- Field-name matrix: v3 `num_vehicles_available` vs v2 `num_bikes_available` handled by the same function (`toronto_v3` vs `toronto_v2` fixtures give equal `bikes/docks` for station 7000).

### 2.4 HTTP (`src/http.ts`)
- `fetchJson(url, { timeoutMs = 8000, now })`: global `fetch`, `AbortController` timeout, headers `User-Agent: DockCast/1.0 (+https://dockcast.aahmed.ca)`, `Accept: application/json`. Non-2xx → `HttpError(status)`; body not JSON → `HttpError('invalid_json')`.
- **No retries within a cycle.** The next scheduled cycle is the retry.
- Every fetch function accepts an injectable `fetchImpl` (defaults to global `fetch`) so tests can serve fixtures without the network.

---------------------------------------------------------------------------

## 3. Station status cycle (`src/status.ts`) — every 60 s per active city

### 3.1 Scheduling
- On boot (after §4 initial sync): run immediately for every active city, then every `POLL_INTERVAL_MS` (default 60 000). One timer per city; cities run concurrently.
- **Never overlap**: if the previous cycle for that city is still running, skip this tick and log `{event:'cycle_skipped', city}`.

### 3.2 Id map
`Map<gbfs station_id, stations.id>` per city, built by §4 and kept in memory. Status rows whose `station_id` is not in the map are dropped this cycle (`n_unknown`), and if `n_unknown > 0` an information sync is requested for that city before its next status tick (flag consumed by the scheduler).

### 3.3 Steps (per city)
1. `t_start = Date.now()`; `feeds = discover(city.gbfs_url)` (cached).
2. `raw = fetchJson(feeds.station_status)`; `vt = vehicleTypes(city)` (cached; may be null); `rows = normaliseStationStatus(raw, vt, now)`. `now` = the poll instant `new Date()` captured **before** the fetch; it is the `ts` written for every row this cycle.
3. Map ids; drop unknown; drop nothing else.
4. Change detection (in memory, `Map<station_pk, LastState>`; `LastState` = the 10 non-ts fields with `last_reported` as epoch ms):
   `changed = rows.filter(r => !equal(last.get(pk), r))` where `equal` compares all of `bikes, docks, ebikes, bikes_disabled, docks_disabled, is_installed, is_renting, is_returning, last_reported` with `null === null` true.
   On cold start (empty map) load `LastState` for the city from `station_current` (`SELECT … FROM station_current sc JOIN stations s ON s.id=sc.station_pk WHERE s.city_id=$1`); stations with no row are treated as changed.
5. **One transaction** (`BEGIN … COMMIT`, rollback on any error):
   a. `INSERT INTO station_current (station_pk, ts, bikes, docks, ebikes, bikes_disabled, docks_disabled, is_installed, is_renting, is_returning, last_reported) SELECT * FROM unnest($1::int[], $2::timestamptz[], $3::smallint[], $4::smallint[], $5::smallint[], $6::smallint[], $7::smallint[], $8::boolean[], $9::boolean[], $10::boolean[], $11::timestamptz[]) ON CONFLICT (station_pk) DO UPDATE SET ts=EXCLUDED.ts, bikes=EXCLUDED.bikes, docks=EXCLUDED.docks, ebikes=EXCLUDED.ebikes, bikes_disabled=EXCLUDED.bikes_disabled, docks_disabled=EXCLUDED.docks_disabled, is_installed=EXCLUDED.is_installed, is_renting=EXCLUDED.is_renting, is_returning=EXCLUDED.is_returning, last_reported=EXCLUDED.last_reported` — **all** rows, every cycle.
   b. `INSERT INTO station_snapshots (same columns) SELECT * FROM unnest(...)` — **changed rows only**; `ON CONFLICT (station_pk, ts) DO NOTHING`.
   c. `INSERT INTO poll_log (city_id, polled_at, feed, ok, n_items, latency_ms, error) VALUES ($1, $2, 'station_status', true, $3, $4, NULL)` with `polled_at = now`, `n_items = rows.length` (after unknown-drop).
   d. `INSERT INTO feed_state (city_id, feed, last_attempt_at, last_ok_at, last_error) VALUES ($1,'station_status',$2,$2,NULL) ON CONFLICT (city_id, feed) DO UPDATE SET last_attempt_at=EXCLUDED.last_attempt_at, last_ok_at=EXCLUDED.last_ok_at, last_error=NULL`.
6. After commit: update the in-memory `LastState` map for changed rows (only after commit — never before).
7. Log `{event:'status_cycle', city, ok:true, n: rows.length, n_changed, n_unknown, n_clamped, latency_ms}`.

### 3.4 Failure path
Any thrown error (fetch, schema, DB) → rollback; then, in a separate short transaction: `poll_log(ok=false, n_items=null, latency_ms, error=<message ≤ 500 chars>)` and `feed_state` upsert with `last_attempt_at=now, last_error=<message>` (do **not** touch `last_ok_at`). Log the same event with `ok:false, error`. Never rethrow out of the cycle; never exit the process for a per-cycle failure. If the DB itself is down and even the failure write fails, log at `error` level and continue.

### 3.5 Guarantees the rest of the system relies on
- `poll_log(ok=true)` for `(city, station_status, polled_at)` ⇒ `station_current.ts = polled_at` for every station present in the feed **and** every state change up to that instant is in `station_snapshots`.
- `station_snapshots` is change-only; consecutive rows for a station always differ in at least one non-ts field.
- `ts` values are the poll instant (not `last_reported`).

### 3.6 Heartbeat
After a tick in which **every** active city's status cycle succeeded, `pingHealthchecks(HEALTHCHECKS_COLLECTOR_URL)` (`GET`, 5 s timeout, errors logged at `warn`, never thrown). If the env var is unset, no-op.

---------------------------------------------------------------------------

## 4. Station information sync (`src/information.ts`) — on boot, then every `INFO_INTERVAL_MS` (default 3 600 000)

1. `feeds = discover(city.gbfs_url)`; `infos = normaliseStationInformation(fetchJson(feeds.station_information))`.
2. In one transaction:
   a. Upsert: `INSERT INTO stations (city_id, station_id, name, lat, lon, capacity, is_active, first_seen_at, last_seen_at) SELECT $1, * , true, now(), now() FROM unnest($2::text[], $3::text[], $4::float8[], $5::float8[], $6::int[]) ON CONFLICT (city_id, station_id) DO UPDATE SET name=EXCLUDED.name, lat=EXCLUDED.lat, lon=EXCLUDED.lon, capacity=EXCLUDED.capacity, is_active=true, last_seen_at=now()`.
   b. Deactivate: `UPDATE stations SET is_active=false WHERE city_id=$1 AND is_active AND NOT (station_id = ANY($2::text[]))`.
   c. `poll_log(feed='station_information', ok=true, n_items=infos.length)`, `feed_state` upsert.
3. Rebuild the id map from `SELECT id, station_id FROM stations WHERE city_id=$1` (include inactive; status rows for inactive stations still get written — freshness handles it).
4. Also refresh the `VehicleTypeMap` here (fetch `vehicle_types` if present; failure is non-fatal, logged).
5. Failure → `poll_log(ok=false)`, `feed_state.last_error`, keep the old id map. If the very first sync on boot fails for a city, the status scheduler for that city still starts (it will drop all rows as unknown and keep requesting syncs).

---------------------------------------------------------------------------

## 5. Weather (`src/weather.ts`) — on boot, then every `WEATHER_INTERVAL_MS` (default 1 800 000)

URL: `https://api.open-meteo.com/v1/forecast?latitude=<lat>&longitude=<lon>&hourly=temperature_2m,precipitation,precipitation_probability,wind_speed_10m,weather_code&forecast_days=3&timezone=UTC` (city `lat/lon` with 4 decimals).

Parse (`fixtures/weather/openmeteo_forecast_sample.json`): `hourly.time[]` (`"YYYY-MM-DDTHH:MM"` in UTC → `new Date(time + ':00Z')`), parallel arrays `temperature_2m, precipitation, precipitation_probability, wind_speed_10m, weather_code` (elements may be `null`). Arrays must have equal length else schema error.

Write: `fetched_at = new Date(Math.floor(Date.now()/1000)*1000)`; one `INSERT INTO weather_forecasts (city_id, fetched_at, valid_hour, temp_c, precip_mm, precip_prob, wind_kmh, weather_code) SELECT $1, $2, * FROM unnest($3::timestamptz[], $4::real[], $5::real[], $6::smallint[], $7::real[], $8::smallint[]) ON CONFLICT DO NOTHING`; then `poll_log(feed='weather', ok, n_items=72)` and `feed_state('weather')`. Failure path as §3.4.

Volume: 2 req/h/city — far under Open-Meteo's free non-commercial limit (10 000/day).

---------------------------------------------------------------------------

## 6. Scheduler (`src/scheduler.ts`)

`startInterval(name, intervalMs, fn)`: runs `fn()` immediately, then on `setInterval`; keeps a `running` flag so a slow run causes the next tick to be skipped (logged); returns `{ stop(): Promise<void> }` which clears the timer and awaits an in-flight run. Boot order: config → pool → `waitForSchema` → load cities (`SELECT … FROM cities WHERE is_active [AND slug = ANY($1)]`) → for each city: information sync (await) → start status + weather intervals. `SIGTERM/SIGINT` → stop all intervals (await in-flight cycles, max 30 s) → `pool.end()` → exit 0. Uncaught errors in a cycle never escape the scheduler.

---------------------------------------------------------------------------

## 7. Config (`src/config.ts`, zod)

| var | type | default | notes |
|---|---|---|---|
| `DATABASE_URL` | url | — | required |
| `LOG_LEVEL` | `fatal|error|warn|info|debug` | `info` | |
| `HEALTHCHECKS_COLLECTOR_URL` | url | unset | optional |
| `POLL_INTERVAL_MS` | int ≥ 10 000 | 60 000 | |
| `INFO_INTERVAL_MS` | int ≥ 60 000 | 3 600 000 | |
| `WEATHER_INTERVAL_MS` | int ≥ 300 000 | 1 800 000 | |
| `CITIES` | comma-separated slugs | unset | filter; unset = all active |
| `MIGRATIONS_DIR` | path | `../../db/migrations` resolved from `dist/` (Docker copies to `/app/db/migrations`) | |
| `HTTP_TIMEOUT_MS` | int | 8 000 | |

Invalid config → print zod issues, exit 1.

---------------------------------------------------------------------------

## 8. Tests (vitest)

### 8.1 `adapter.test.ts` (pure, no DB)
- Discovery for v3 fixture, v2.3 fixture, synthetic v1 (`{data:{en:{feeds:[…]}}}`, no `version`) → correct feed URLs; missing `station_status` → `GbfsSchemaError`.
- Every assertion listed in §2.2 and §2.3 (both Toronto info fixtures; three status fixtures; ebike rules 1–4 incl. a synthetic case with `vehicle_types_available` but no VehicleTypeMap → `null`).
- `toCount(-3)` → 0 with clamp counter; `toCount('7')` → 7; `toBool` truth table (`1,'1',true,'true'` → true; `0,'0',false,undefined,null` → false).
- `last_reported` cases: unix number, RFC3339 string, `86400`, missing → `now`.

### 8.2 `change.test.ts`
`equal(prev, next)` and `diffChanged(lastMap, rows)`: identical → 0 changed; `bikes` change → 1; `last_reported` change only → 1; `ebikes null` vs `null` → unchanged; station absent from map → changed.

### 8.3 `weather.test.ts`
Fixture parses to 72 rows; `valid_hour[0] = 2026-08-17T00:00:00Z`; nulls preserved; unequal array lengths → error.

### 8.4 `cycle.db.test.ts` (skipped unless `DATABASE_URL_TEST`)
Setup: run migrator against `DATABASE_URL_TEST`, `TRUNCATE` collector tables, ensure city `toronto` exists (seeded by migration).
1. Inject `fetchImpl` serving `toronto_v3_gbfs.json`, `toronto_v3_station_information.json`, `toronto_v3_station_status.json`, `toronto_v3_vehicle_types.json` by URL.
2. `runInformationSync(city)` → `stations` count 1058, all `is_active`; id map size 1058.
3. `runStatusCycle(city, now1)` → `station_current` 1058 rows with `ts = now1`; `station_snapshots` 1058 rows; `poll_log` 1 row (`ok`, `n_items 1058`); `feed_state.last_ok_at = now1`. Station 7000 → bikes 3, docks 44, ebikes 0.
4. `runStatusCycle(city, now2)` with the identical fixture → `station_current.ts = now2` for all; `station_snapshots` still 1058; `poll_log` 2 rows.
5. Mutate one station's `num_vehicles_available` in the injected JSON, run again → `station_snapshots` 1059; the new row has the new value and `ts = now3`.
6. Inject a fetch that returns 500 → `poll_log` row with `ok=false, error`, `feed_state.last_error` set, `last_ok_at` unchanged, `station_current` unchanged.
7. Information sync with one station removed from the fixture → that station `is_active=false`, others unchanged.
8. Weather: inject fixture → 72 `weather_forecasts` rows; run again with same `fetched_at` → still 72 (ON CONFLICT).

CI runs 8.4 against the `timescale/timescaledb-ha:pg16` service container (infra.md §6).

---------------------------------------------------------------------------

## 9. Definition of done
- [ ] `pnpm --filter @dockcast/collector build && test` green; DB test green in CI.
- [ ] Running locally against `docker compose -f infra/docker-compose.dev.yml up db` for 5 minutes yields: ≥5 `poll_log` ok rows for `station_status`, `station_current` = active station count, `station_snapshots` growing only on change, 1 `weather` poll, 1 `station_information` poll.
- [ ] `station_state_fresh` view returns `is_fresh = true` for the majority of Toronto stations within 2 minutes of start.
- [ ] Killing with SIGTERM mid-cycle leaves no half-written cycle (transaction) and exits 0 within 30 s.
- [ ] Log lines are single-line JSON; exactly one per cycle per city.
- [ ] Healthchecks ping observed (when configured).
