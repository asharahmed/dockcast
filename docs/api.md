# DockCast — HTTP API Contract (v1)

Base path `/api/v1`. JSON only (`Content-Type: application/json; charset=utf-8`).
All timestamps ISO-8601 UTC with `Z`. IDs in URLs are `stations.id` (int) /
`commutes.id` (uuid). Every request/response body has a zod schema in
`packages/shared/src/api/*.ts`; the schema names are given per endpoint and are
the source of truth for field types. Express handlers must `parse()` inputs and
outputs with them (outputs in dev/test only).

## 0. Conventions

Error envelope (always):
```json
{ "error": { "code": "validation_error", "message": "human readable", "details": {...optional} } }
```
| HTTP | code | when |
|---|---|---|
| 400 | `validation_error` | zod failure; `details` = zod `flatten()` |
| 401 | `unauthorized` | no/expired session |
| 403 | `forbidden` | resource belongs to another user |
| 404 | `not_found` | unknown city/station/commute |
| 409 | `conflict` | email already registered; duplicate push endpoint |
| 429 | `rate_limited` | auth endpoints: 10 req / 15 min / IP; trip: 60 req / min / IP; status: 120 req / min / IP |
| 503 | `service_unavailable` | health failing / DB down |
| 500 | `internal_error` | anything else (logged with request id) |

Headers: every response has `X-Request-Id`. Public read endpoints set
`Cache-Control: public, max-age=<n>` as noted; authenticated ones `no-store`.
Sessions: cookie `dockcast.sid` (httpOnly, Secure in prod, SameSite=Lax, 30 d rolling).
CSRF: state-changing routes (POST/PATCH/DELETE) require header `X-Requested-With: fetch` (checked by middleware; ignored on GET/HEAD; SameSite=Lax + this header is sufficient for a same-origin SPA). The web client sends it on every request.

Constants (shared): `HORIZONS = [15,30,45,60,90,120]`; `MAX_LEAD = 120`; `MIN_LEAD = 15`;
`WALK_M_PER_MIN = 80`; `RIDE_KMH = 12`; `RIDE_OVERHEAD_MIN = 3`; `ALT_RADIUS_M = 600`;
`ALT_GOOD_P = 0.9`; verdict thresholds `GOOD ≥ 0.8`, `RISKY ≥ 0.5`, else `BAD`.

### 0.1 Forecast lookup semantics (used by /trip, /commutes, alerts) — normative

`lookup(station_pk, target ∈ {bike,dock}, at: Date, now: Date)`:
1. `lead = (at − now)` in minutes (fractional ok).
2. If `lead > MAX_LEAD` → `{kind:'typical', p: station_tod_profile.p_<target> for (day_type of `at`'s local date in the city tz — not of `now` — and the 15-min bucket of `at`), tier:null}`; if no profile row → `{kind:'unavailable'}`.
3. Else `lead' = clamp(lead, MIN_LEAD, MAX_LEAD)`; take `forecasts_latest` rows for the station; if `p_<target>` is null → `{kind:'unavailable', reason}`. If `lead'` equals a horizon → that row's `p`. Otherwise linear interpolation in `p` between the two bracketing horizons `h_lo < lead' < h_hi`: `p = p_lo + (p_hi − p_lo)·(lead' − h_lo)/(h_hi − h_lo)`; same for `exp_bikes`. `kind:'forecast'`, `tier` from the row.
4. Also return `current = {bikes, docks, as_of, is_fresh}` from `station_state_fresh`.
Implemented once in `apps/api/src/forecast/lookup.ts`, unit-tested (T18 in ml-spec).

`ride_minutes_default(origin, dest) = max(5, round(haversine_km(origin,dest) / RIDE_KMH · 60 + RIDE_OVERHEAD_MIN))`.

`alternatives(station_pk, target, at, now)`: active stations within `ALT_RADIUS_M` (PostGIS `ST_DWithin` on `stations.geom`), excluding the station itself, each with `lookup(...)`; keep `kind='forecast'`; sort by `p` desc; return top 3 with `{station, distance_m, walk_minutes = ceil(distance_m / WALK_M_PER_MIN), p, exp_bikes}`. (No "≥ 0.9" filter server-side; the UI highlights `p ≥ ALT_GOOD_P`.)

`verdict(p_origin, p_dest)`: if either `kind ≠ 'forecast'` → `'unknown'`; `m = min(p_o, p_d)`; `m ≥ 0.8 → 'good'`, `m ≥ 0.5 → 'risky'`, else `'bad'`.

## 1. System

### GET /health  — no cache
200 `{ ok: true, db: true, collector_last_ok_at: string|null, predictor_last_run_at: string|null }`
503 with `ok:false` if DB unreachable. (Does **not** fail on stale collector; that is surfaced on `/model`.)
Schema: `HealthResponse`.

### GET /status  — `public, max-age=10`, rate-limited per IP, public
Feeds the `/status` page (ui-spec §4.10): the status of the whole app, including the current production instance. Schema: `StatusResponse` (`packages/shared/src/api/status.ts`); every object is `.strict()` and the response is an allowlist, so a new field must be added to the schema on purpose.
```
{ overall: 'operational'|'degraded'|'down',
  website:   { state, latency: 'fast'|'slow'|null },
  stations:  { state, updated_min_ago: int|null },
  forecasts: { state, updated_min_ago: int|null },
  models:    { state, last_update_date: 'YYYY-MM-DD'|null,
               running: { percent: int|null, stage: 'preparing data'|'training'|'evaluating'|'publishing', eta_min: int|null } | null },
  database:  { state: 'operational'|'down' },
  release:   { deployed_ago: { value: int, unit: 'minutes'|'hours'|'days' }, uptime_7d: number|null, uptime_30d: number|null },
  history:   { days: string[14], website: Cell[14], stations: Cell[14], forecasts: Cell[14], database: Cell[14] },  // Cell = 'ok'|'down'|'none'
  model_updates: [{ date, ok, duration_min: int|null }]  // newest first, <= 14, one per UTC date
}
```
**Snapshot and caching.** The server builds one snapshot at most every 15 s (in-process cache, single-flight: concurrent misses share one set of queries) and serves the same body to everyone. Traffic does not change database load. A per-IP rate limiter (120/min) stays in front; `429` has a fixed body and neither it nor any other response carries `RateLimit-*` or `Retry-After` headers. 503 (same shape, `database.state:'down'`, nothing about the cause) when the queries fail; the failure is cached for the same 15 s.

**Component thresholds.**
| Component | Source | operational | degraded | down |
|---|---|---|---|---|
| website | 75th percentile of API request durations over 5 min, plus the sampler's DB probe | p75 < 1 s (`fast`) | p75 >= 1 s (`slow`) | not reported by the server itself; the page shows "cannot reach the service" when the request fails |
| stations | collector `feed_state.last_ok_at` | <= 5 min | <= 15 min | older, or never |
| forecasts | last finished predict run | <= 30 min and the run succeeded | <= 90 min, or the last run failed | older, or never |
| models | last successful train run | <= 36 h, nothing stalled or failed since | <= 96 h, a stalled run, or the last finished run failed after the last success | older than 96 h |
| database | the snapshot queries | answered | n/a | failed |
`overall` is `down` when the database is down, `degraded` when anything else is not operational, else `operational`.

**Model update progress.** `running` is set when the newest train row is unfinished, started under 12 h ago, and has written progress within 10 minutes (a quieter run counts as stalled: `running` is `null` and `models.state` is `degraded`). `percent`/`eta_min` come from the most recent successful run's phase offsets: the current run is anchored at its latest finished phase the reference also has and interpolated by wall time up to the reference's next boundary. `percent` is a whole number capped at 97, `eta_min` is whole minutes; both are `null` with no reference. The internal phases map onto the four public stages in `apps/api/src/status/stage.ts` (the map and the phase names stay server-side and are not in `@dockcast/shared`): `labels`..`feature_build` -> preparing data; `feature_matrices`, `calibration` -> training; `val_scoring`, `release` -> evaluating; `metrics_online` and the wrap-up after it -> publishing.

**Release.** `deployed_ago` is the age of the running release, coarsened on the server (minutes under 2 h, hours under 2 days, else days). The start time is the `DEPLOYED_AT` env var (ISO 8601) if set and valid, else API process start (a redeploy recreates the container). No git sha or version string is exposed anywhere.

**Uptime and history.** Computed from `status_samples` (migration 0007): one row per component per minute, `ts` truncated to the minute, primary key `(component, ts)`. Components: `website`, `stations`, `forecasts`, `database`; `ok` means the state was not `down` (website and database are `ok` whenever the sampler could read the database). Uptime is `ok samples / minutes that should have a sample` for the `website` component over 7 and 30 days, counted from the first sample if it is newer than the window, floored to one decimal, `null` under 10 minutes of history. A minute without a sample counts as down. A history cell is `ok` when at least 99% of that UTC day's minutes (since the first sample) have an ok sample, `down` otherwise, `none` before any data. Days are UTC dates. Retention: hypertable with `add_retention_policy('status_samples', INTERVAL '90 days')`.

**Sampler.** `apps/api/src/status/sampler.ts`, started from `index.ts` next to the alert scheduler. It lives in the API process because the API is what `website` means, and it observes the database as users do; the collector can only vouch for itself. Multiple API instances are safe without leader election: each may sample, and the primary key plus `ON CONFLICT DO NOTHING` keeps one row per component per minute.

**Model updates list.** One row per UTC date of the run's start: a date is `ok` if any run that day succeeded (its duration), else the newest failure. Unfinished rows (crashed attempts; a retry is a separate row) are not listed, so retries cannot be counted from the page. Durations are whole minutes.

### Public status page threat model
Anyone can read `/status`, including someone preparing an attack, so the page shows what a user would want to know and withholds what only helps reconnaissance.

Shown: up/degraded/down for each part of the app, how fresh the data is in whole minutes, a fast/slow latency bucket, the UTC date of the last model update and the dates/results/durations (whole minutes) of the last 14, progress of a running update (whole percent, one of four generic stage names, ETA in minutes), the age of the running release, 7 and 30 day uptime, and a 14-day up/down strip per component. Each is something a user notices or would otherwise report as "is it down?".

Withheld, with the reason:
- Memory use, limits, peaks, retry or attempt counts: they reveal capacity, how close the trainer runs to its limit, and when it is fragile (a window to cause or exploit an OOM).
- Exact git sha, version or build id: lets an attacker look up known vulnerabilities for the exact build; the release is shown only as a coarse age.
- Internal phase names and the phase list: they describe the training pipeline and its libraries. The page gets four generic stages.
- Exact schedules and clock times: the nightly run time tells an attacker when the box is busy and when nobody is watching. The page says nothing about when; dates carry no time of day and `generated_at` is not sent.
- Host, container and OS names, database engine or version, proxy or tunnel details: stack fingerprinting. Component names are product terms ("station data", not a service or container name).
- Error text, stack traces, `worker_runs.error`: the route never selects it; the progress JSON is cut down in SQL to phase names and timestamps, and re-validated against an allowlist in code.
- Rate-limit numbers: the limiter sends no `RateLimit-*`/`Retry-After` headers and the 429 body is fixed.
- Per-request cost: one cached snapshot every 15 s serves every caller, so the endpoint cannot be used to hammer the database.

Controls: strict zod schema (unknown keys fail validation in dev/test and in the API tests); a test scans the serialized body and the headers for banned patterns (`apps/api/test/helpers/bannedContent.ts`); hostile strings seeded into `error`, `summary` and phase names must not appear; `X-Powered-By` is disabled app-wide and no `Server` header is set (the Caddy `-Server` also strips the proxy's); `/health` no longer reports a version; malformed bodies get a fixed 400/413 and unhandled errors a fixed 500 with no stack in any mode. Not covered: what an attacker can infer from uptime gaps (a restart shows as a missing minute) and from the existence of the nightly update itself.

## 2. Cities & stations (public)

### GET /cities  — max-age=300
`CityListResponse`: `{ cities: [{ slug, name, tz, lat, lon, forecasting_enabled, station_count, last_status_ok_at: string|null }] }`

### GET /cities/:slug/stations  — max-age=3600
`StationListResponse`: `{ stations: [{ id, station_id, name, lat, lon, capacity: number|null }] }` (active only)

### GET /cities/:slug/map  — max-age=30
Everything the map needs for the time slider, compact:
```
MapResponse: {
  t0: string|null,          // predictor origin of forecasts_latest (max t0); null before the first predictor run
  as_of: string,            // latest station_status ok poll
  horizons: number[],       // HORIZONS
  stations: [{ id, b: number, d: number, c: number, fresh: boolean,
               f: (null | [p_bike: number, p_dock: number, exp_bikes: number])[] }]  // one entry per horizon, null when no forecast
}
```
Stations without a `station_current` row are omitted.

### GET /stations/:id  — max-age=30
```
StationDetailResponse: {
  station: { id, station_id, name, lat, lon, capacity, city: { slug, name, tz } },
  current: null | { bikes, docks, ebikes: number|null, cap_eff, is_fresh, as_of, last_reported },
  forecasts: [{ horizon, valid_at, p_bike: number|null, p_dock: number|null, exp_bikes: number|null, q10: number|null, q90: number|null, tier, reason: string|null }],  // 6 rows
  history: [{ ts, bikes, docks }],          // last 24 h, 5-min grid (as-of/ffill), gaps as missing entries
  typical: [{ bucket, mean_fill, p_bike, p_dock }],   // 96 rows for today's day_type; [] if none
  neighbors: [{ id, name, distance_m, bikes: number|null, docks: number|null }]  // 3
}
```

### GET /stations/:id/history?hours=24  — max-age=60
`hours ∈ [1, 168]`. `StationHistoryResponse: { points: [{ ts, bikes, docks }] }` (5-min grid).

## 3. Trip check (public)

### GET /trip?origin=<id>&dest=<id>&depart_at=<ISO>&ride_minutes=<n>  — no-store, rate-limited
- `depart_at` optional (default `now`); if in the past → treated as `now` (the response's `depart_at` reflects the value actually used; clients compare it with what they sent).
- `ride_minutes` optional (default `ride_minutes_default`), 1..180.
- 400 if stations are in different cities or equal.
```
TripResponse: {
  computed_at, forecast_t0: string|null, depart_at, arrive_at, ride_minutes,
  origin: TripLeg, dest: TripLeg, verdict: 'good'|'risky'|'bad'|'unknown'
}
TripLeg: {
  station: { id, name, lat, lon },
  lead_minutes: number,
  kind: 'forecast'|'typical'|'unavailable', reason: string|null, tier: string|null,
  p: number|null,               // p_bike for origin, p_dock for dest
  exp_bikes: number|null,
  current: null | { bikes, docks, cap_eff, as_of, is_fresh },
  alternatives: [{ station: { id, name, lat, lon }, distance_m, walk_minutes, p, exp_bikes }]
}
```

## 4. Model transparency (public)

Two views of the same endpoints, decided server-side from the session: the **operator view**
for a signed-in user whose email is in `ADMIN_EMAILS` (§9), and the **public view** for everyone
else, signed in or not. The public view is what the detailed data is hidden behind, so the
trimming happens in the api, never only in the client.

### GET /model?city=toronto  — operator: `private, no-store`; public: `max-age=300`; both `Vary: Cookie`
Public view differences: `metrics` keeps only the rows of the serving tier (`gbm` → `gbm_active`,
`bd_cal`, `bd_raw`; nothing when `none`) plus `persistence`; `versions` is `[]`; `active.gbm` /
`active.bd` keep their identity fields but `metrics_val` and `gate` are `null`. `viewer.is_admin`
tells the client which view it received. `Vary: Cookie` keeps a shared cache from handing the
operator body to the public and a browser from reusing a public body after signing in.
```
ModelResponse: {
  city: { slug, name, tz },
  data_since: string|null,                     // min(station_snapshots.ts) — computed nightly into worker_runs summary; fallback query
  n_stations_active: number,
  collector: { last_ok_at: string|null, uptime_7d_pct: number|null },   // percent 0-100 (1 decimal): ok polls / expected polls (one per minute) over the last 7 d, or since the first poll if younger than 7 d; capped at 100
  predictor: { last_run_at: string|null, serving_tier: 'gbm'|'bd_cal'|'bd_raw'|'none' },
  active: { gbm: ModelVersionSummary|null, bd: ModelVersionSummary|null },
  metrics: [{ day, window_days, tier, target, horizon, slice, metric, value, n }],  // all rows for the latest `day` present *per* `window_days` (the nightly job can leave a newest day with 1-day rows only); metric names: brier, logloss, auc, ece, mae, rmse, n, and reliability bins rel_bin_<0..9>_{mean_pred,frac_pos,n} (horizon 0 = pooled)
  versions: ModelVersionSummary[],             // last 30, newest first; [] in the public view
  viewer: { is_admin: boolean }                // which view this is
}
ModelVersionSummary: { id, tier, status, trained_for_date, created_at, activated_at, feature_schema_version, train_window: [string,string]|null, metrics_val: MetricsVal|null, gate: Gate|null }
MetricsVal: { n_val: number, brier: { bike: number, dock: number }, logloss: { bike, dock }, auc: { bike: number|null, dock: number|null }, ece: { bike, dock }, mae: number, rmse: number,
              brier_at_risk: { bike, dock }, ref: { tier: 'bd_cal'|'bd_raw'|null, brier: { bike, dock }|null, mae: number|null } }   // pooled over horizons, val split; `ref` = the baseline it was compared to (gbm only)
Gate: { passed: boolean, checks: [{ name: string, value: number|null, threshold: number|null, ok: boolean }] }   // names: brier_bike_vs_ref, brier_dock_vs_ref, ece_bike, ece_dock, mae_vs_ref, brier_bike_vs_active, brier_dock_vs_active
```
### GET /model/versions/:id  — operator only; `private, no-store`, `Vary: Cookie`
404 `not_found` for anyone who is not an operator, the same as for an unknown id, so the public view has nothing to probe.
`ModelVersionDetailResponse: { version: ModelVersionSummary, eval: [{ tier, split, target, horizon, slice, metric, value }] }` — `tier` ∈ `gbm` (a gbm version's own rows) | `bd_raw` | `bd_cal` | `persistence` (baseline rows stored on the run's bd version).

## 5. Auth

Body schemas: `RegisterRequest { email: string(email, ≤254), password: string(10..200) }`, `LoginRequest` same.
`UserResponse { user: { id, email, created_at, is_admin } }` — `is_admin`: the email is in `ADMIN_EMAILS` (§9), case-insensitively.
- `POST /auth/register` → 201 `UserResponse` (also logs in). 409 if email exists (case-insensitive).
- `POST /auth/login` → 200 `UserResponse`; 401 `unauthorized` on bad credentials (same message for unknown email / wrong password).
- `POST /auth/logout` → 204.
- `GET /auth/me` → 200 `UserResponse` | 401.
- `DELETE /auth/account` (auth required) → 204, clears the session cookie. Deletes the user row; commutes (with their `alert_events`), push subscriptions, linked identities and pending link handshakes go with it (`ON DELETE CASCADE`), and every `session` row whose `sess.userId` is this user is deleted, signing out other devices. The `/privacy` page promises this.
Passwords: argon2id (`argon2` defaults). Sessions regenerate on login. Rate limit per §0. Request logs redact `Cookie`, `Authorization` and `Set-Cookie`.

### OAuth sign-in (Google; provider-generic schema)

`users.password_hash` is nullable (OAuth-provisioned accounts have no password; password login on
them 401s with the same message as bad credentials). `auth_identities (provider, subject) → user_id`
records provider links (`db/migrations/0003_auth_identities.sql`).

- `GET /auth/providers` → 200 `AuthProvidersResponse { google: bool, apple: bool }` (no-store: config-derived; a cached `false` would hide the button right after enabling a provider).
  A provider is `true` iff its credentials are configured (`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`).
- `GET /auth/google?next=<path>` → 302 to Google's OIDC authorization endpoint (scope `openid email`,
  PKCE S256, `state` + `nonce` held in the session). `next` must be a same-origin path (`/...`,
  not `//...`); anything else falls back to `/commutes`. 404 when not configured.
- `GET /auth/google/callback?code&state` → browser-facing: every failure (state mismatch, missing
  handshake, exchange/claim error) redirects to `/login?oauth=failed`, never a JSON envelope.
  Success: id_token claims validated (iss/aud/exp/nonce, `email_verified` must be true), then
  identity lookup → existing link, else link to the user with the same (case-insensitive) email,
  else provision a passwordless user; session regenerates; 302 to `next`.
- Redirect URI is `PUBLIC_BASE_URL + /api/v1/auth/google/callback` — register it in the Google
  console. Google requires https for non-localhost redirect URIs, so this is unusable on the
  plain-http Tailscale deployment; localhost dev and the eventual TLS deploy both work.
- Rate limit: separate bucket, 30 req / 15 min / IP across the OAuth routes (one sign-in costs
  two requests, and users retry).
- Handshake state (state/nonce/PKCE verifier/next) lives in `oauth_handshakes` keyed by the
  single-use 256-bit `state` (15 min TTL, deleted on consume) — NOT the session, because Apple's
  callback is a cross-site POST that carries no SameSite=Lax cookie.
- `GET /auth/apple?next=<path>` → 302 to Apple's authorization endpoint (scope `email`,
  `response_mode=form_post`; no PKCE — Apple ignores it). 404 when not configured
  (`APPLE_SERVICES_ID` + `APPLE_TEAM_ID` + `APPLE_KEY_ID` + `APPLE_PRIVATE_KEY`).
- `POST /auth/apple/callback` — urlencoded form POST from appleid.apple.com; exempt from the
  `X-Requested-With` CSRF check (the server-side single-use `state` is the CSRF protection).
  Client secret is a 5-min ES256 JWT built per exchange from the .p8 key. `email_verified`
  may be boolean or the string "true"; private-relay emails provision fresh users (no linking
  by relay address to an existing account is expected). Failures → 303 `/login?oauth=failed`.

### Account linking (docs/ui-spec.md §4.8)

- OAuth starts accept `?link=1`: made while signed in, the session user rides in the handshake
  (`oauth_handshakes.link_user_id`) and the callback ATTACHES the identity to that user instead
  of signing in — session untouched (works for Apple's cookie-less POST). Outcomes: 303
  `/account?link=ok` | `/account?link=conflict` (the provider account already signs into a
  different user) | `/login?oauth=failed` (exchange error). `link=1` without a session degrades
  to normal sign-in.
- `GET /auth/identities` (auth, no-store) → `AuthIdentitiesResponse { has_password,
  identities: [{provider, email, created_at}] }`.
- `DELETE /auth/identities/:provider` (auth) → 204; 400 `validation_error` when it would remove
  the account's only sign-in method; 404 for unknown/unconnected provider.

## 6. Commutes (auth required)

```
Commute: { id, name, city: { slug, tz }, origin: StationRef, dest: StationRef,
           depart_local_time: 'HH:MM', ride_minutes, days_of_week: number[],   // 0=Mon..6=Sun
           alert_enabled, alert_lead_minutes, threshold, created_at, updated_at }
StationRef: { id, name, lat, lon }
CommuteOutlook: { next_depart_at: string|null, next_arrive_at: string|null,
                  origin: { kind, p: number|null }, dest: { kind, p: number|null }, verdict }
```
- `GET /commutes` → `{ commutes: (Commute & { outlook: CommuteOutlook })[] }`. `next_depart_at` = next instant ≥ now (city tz) whose local time = `depart_local_time` on a day in `days_of_week`; outlook via §0.1 with `now`.
- `POST /commutes` body `CommuteCreateRequest { name: string(1..60), origin_station_id: int, dest_station_id: int, depart_local_time: 'HH:MM', ride_minutes?: int, days_of_week: int[] (1..7 unique, 0..6), alert_enabled?: bool=true, alert_lead_minutes?: int=20 (5..120), threshold?: number=0.7 (0.05..0.95) }` → 201 `{ commute }`. `city` derived from stations (must match; else 400). Max 20 commutes per user (400 `validation_error`).
- `PATCH /commutes/:id` body `CommuteUpdateRequest` (all fields optional) → 200 `{ commute }`. (There is deliberately no `GET /commutes/:id`; clients use the list.)
- `DELETE /commutes/:id` → 204.
- 403 if commute belongs to another user; 404 if unknown.

## 7. Push (auth required)

- `GET /push/vapid-public-key` → `{ publicKey }` (public; max-age=86400).
- `POST /push/subscriptions` body `PushSubscribeRequest { endpoint: string(url), keys: { p256dh: string, auth: string }, user_agent?: string }` → 201 `{ id }`. If endpoint exists for the same user → 200 (idempotent); for another user → re-assign to current user (200).
- `DELETE /push/subscriptions` body `{ endpoint }` → 204.
- `POST /push/test` → 202 `{ sent: number }` — sends a test notification to all of the user's subscriptions.

Push payload (JSON, `web-push`, TTL 3600, urgency `high`):
`{ title: string, body: string, url: string, tag: string }` — service worker shows it and opens `url` on click.

## 8. Alert scheduler (in `api`, not an endpoint) — normative

Tick every 60 s aligned to the minute (`setTimeout` to next `:00`, then `setInterval`).
For each active city with `forecasting_enabled`:
1. `now_local` (city tz), `today_dow` (0=Mon), `today_date`.
2. Select commutes where `alert_enabled` and `today_dow = ANY(days_of_week)` and
   `depart_local_time − alert_lead_minutes` (as minute-of-day) `== minute_of_day(now_local)`
   and no `alert_events` row for `(commute_id, today_date)`.
3. For each: `depart_at = today_date + depart_local_time` (city tz → UTC); run the trip logic (§0.1) with `now`.
4. If `origin.kind='forecast' AND origin.p < threshold` → `origin_low`; same for `dest_low`; both → `both_low`. If neither condition holds, nothing is sent and nothing is written (the unique `(commute_id, local_date)` constraint only guards duplicate sends; the same minute cannot match again on a later tick). Legs with `kind ≠ 'forecast'` never trigger.
5. Compose body, e.g. `"Only 41% chance of a dock at Bay / Wellesley at 8:40. Best nearby: Yonge / Wellesley (2 min walk, 93%)."`; `url = /trip?from=<origin id>&to=<dest id>&at=<depart_at ISO>&ride=<ride_minutes>` (the SPA route's params, ui-spec §4.3 — not the API's `origin/dest/depart_at` query names); `tag = commute.id`.
6. Send to every subscription of the user; on 404/410 delete the subscription; on other errors `failed_count += 1` and delete when `≥ 5`. Insert `alert_events` with `delivered` count.
7. Log one line per tick with counts.

## 9. Process & config (api)

Env (validated with zod at boot; see `infra.md` `.env.example`): `PORT` (3000), `DATABASE_URL`,
`SESSION_SECRET` (≥32 chars), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`,
`PUBLIC_BASE_URL`, `WEB_DIST_DIR` (default `<repo>/apps/web/dist`), `MIGRATIONS_DIR`
(default `<repo>/db/migrations`), `LOG_LEVEL`, `NODE_ENV`, `TRUST_PROXY` (default `1`),
`ADMIN_EMAILS` (comma-separated, compared lower-cased; empty = nobody has the operator view, §4).
Boot order: load config → `migrate()` (from `@dockcast/db`) → build app → listen → start
alert scheduler. `app.set('trust proxy', TRUST_PROXY)` (Caddy in front). A second entry
`dist/migrate.js` runs migrations and exits 0/1 (used by compose one-shots and CI).

## 10. Static assets

Anything not under `/api/` serves `apps/web/dist` with SPA fallback to `index.html`, except that a missing path ending in a file extension (`/favicon.ico`, `/x.png`) is a plain 404, never the HTML shell
(`Cache-Control: no-cache` for `index.html`, `immutable, max-age=31536000` for hashed `/assets/*`, `max-age=3600` for un-hashed public files like the favicon/icons/manifest). `/sw.js` served with `Service-Worker-Allowed: /` and `no-cache`. Static files carry `Cross-Origin-Resource-Policy: cross-origin` (WebKit fetches touch icons outside the page context and drops them under `same-origin`); the HTML shell and `/api` keep helmet's `same-origin`.
