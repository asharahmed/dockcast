# DockCast — Implementation Plan & Work Packages (v1)

Status: PLANNING DRAFT for approval. Implementation is executed by Sonnet
subagents, one work package (WP) per agent run, orchestrated by the planning
model (Fable). No WP starts before this plan and all referenced specs are approved.

Specs (normative, read in this order for any WP): `architecture.md` → the WP's
own spec (`collector-spec.md` / `worker-spec.md` / `api.md` / `ui-spec.md` /
`infra.md`) → `ml-spec.md` (Python WPs) → `db/migrations/0001_init.sql`.

## 1. Global implementation rules (apply to every WP)

R1. Implement exactly what the spec says. If the spec is ambiguous or seems wrong, **stop and report** the exact question in the final message — do not guess, do not "improve".
R2. No `any`, no `// TODO`, no placeholder/mock data in production code, no commented-out code, no console.log (use the logger).
R3. Only touch files inside the WP's listed directories (plus root files explicitly listed). Never edit `docs/` or `db/migrations/0001_init.sql`.
R4. Every WP ships tests listed in its spec; `pnpm -w lint && pnpm -w typecheck && pnpm -w test` (or `uv run ruff check && uv run pytest` for Python) must pass **and the output must be pasted in the final report**. A WP with failing/skipped tests is not done.
R5. Names (tables, columns, DTO fields, env vars, routes, file paths, function names given in specs) are exact. Constants come from `@dockcast/shared` / `dockcast_ml.timeutil`, never re-declared.
R6. Commit at the end of the WP on the current branch: `git add -A && git commit -m "WP-<n>: <title>"`. Do not push.
R7. Final report format (mandatory): (a) files created/changed, (b) full test command output, (c) any deviations (should be "none") or open questions, (d) anything the next WP needs to know.
R8. Node: ESM only, `import` extensions `.js` in relative imports of compiled output (`moduleResolution: NodeNext`), strict TS. Python: type hints on all public functions, `ruff` clean, no bare `except`.
R9. Time: never use `Date.now()`-dependent logic without an injectable clock (`now: Date` parameter / `clock` dependency) so tests are deterministic.
R10. Secrets and URLs from env only; `.env.example` is the single list.

## 2. Work packages

Legend: **Deps** = must be complete first. **Lane** = agents in different lanes may run concurrently (disjoint directories).

### WP-0 — Repository scaffold (Lane: root, Deps: —)
Dirs: root files, `packages/*` & `apps/*` & `ml/` skeletons, `.github/workflows/`.
- `git init` (branch `main`), `.gitignore` (node, python, .env, dist, uv venv, `ml/.cache`), `.nvmrc` = `22`, `package.json` (private, `packageManager: pnpm@9`, scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `db:migrate`, `format`), `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `tsconfig.base.json` (strict, ES2022, NodeNext, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` off), root ESLint flat config + Prettier config, `README.md` (title, one-paragraph description, layout, dev quickstart pointing to `infra.md`), `.env.example` (verbatim from `infra.md`), `.github/workflows/ci.yml` (verbatim from `infra.md`), empty package folders each with `package.json` names `@dockcast/{shared,db,api,collector,web}` and `tsconfig.json` extending base (composite refs), `ml/pyproject.toml` + `ml/dockcast_ml/__init__.py` + `ml/tests/conftest.py` per `worker-spec.md` §1, `infra/docker-compose.dev.yml` (from `infra.md`).
- Acceptance: `pnpm install` succeeds; `pnpm -w typecheck` passes on empty packages; `cd ml && uv sync` succeeds; `docker compose -f infra/docker-compose.dev.yml up -d` brings up db + db-test.

### WP-1 — `@dockcast/db` (Lane A, Deps: WP-0)
Dir: `packages/db`.
- `src/pool.ts`: `createPool(databaseUrl, {max=10, application_name})`; `pg` type parsers: int8→number, numeric→number, timestamptz→Date (default), `float4/float8`→number.
- `src/migrate.ts`: `migrate(pool, dir = <repo>/db/migrations)`: creates `schema_migrations(version int PK, name text, applied_at timestamptz)` if absent; applies `NNNN_*.sql` files in ascending order not yet applied, each in its own transaction (`BEGIN … COMMIT`, on error `ROLLBACK` and throw); uses a `pg_advisory_lock(727272)` so two processes can't race. `schema_migrations` also stores `checksum text` (sha256 of file contents); on every run, an already-applied file whose checksum differs is **fatal** (throw with both hashes). `latestVersion(dir)`, `currentVersion(pool)`, `waitForSchema(pool, dir, {timeoutMs = 300_000})` (polls every 2 s until `current ≥ latest`, then resolves; throws after timeout — collector/workers call this at boot and exit 1 on throw).
- `src/sql.ts`: tiny helpers `one<T>`, `many<T>`, `none`, and `unnestParams(rows, columns)` builder for batched inserts.
- `bin/migrate.ts` (`pnpm db:migrate`).
- Tests (vitest, `DATABASE_URL_TEST`): applies 0001 to a fresh database created by the test (`CREATE DATABASE` via maintenance connection), asserts tables and hypertables exist, second run is a no-op, advisory lock prevents concurrent apply (two parallel `migrate()` calls both resolve, migration applied once).

### WP-2 — `@dockcast/shared` (Lane C, Deps: WP-0)
Dir: `packages/shared`.
- `src/constants.ts`: `HORIZONS`, `MIN_LEAD`, `MAX_LEAD`, `WALK_M_PER_MIN`, `RIDE_KMH`, `RIDE_OVERHEAD_MIN`, `ALT_RADIUS_M`, `ALT_GOOD_P`, `VERDICT_GOOD=0.8`, `VERDICT_RISKY=0.5`, `DAY_TYPE`, `FEATURE_SCHEMA_VERSION=1`.
- `src/api/*.ts`: one file per section of `api.md` with zod schemas + inferred types for every request/response (`HealthResponse`, `CityListResponse`, `StationListResponse`, `MapResponse`, `StationDetailResponse`, `StationHistoryResponse`, `TripResponse`, `TripLeg`, `ModelResponse`, `ModelVersionSummary`, `ModelVersionDetailResponse`, `RegisterRequest`, `LoginRequest`, `UserResponse`, `Commute`, `CommuteOutlook`, `CommuteCreateRequest`, `CommuteUpdateRequest`, `PushSubscribeRequest`, `ErrorResponse`). ISO datetime strings validated with `z.string().datetime({offset:true})`.
- `src/geo.ts`: `haversineKm`, `rideMinutesDefault`.
- `src/forecast.ts`: `interpolate(horizons, values, lead) → number|null` (§0.1 rule 3), `verdict(pOrigin, pDest, kinds)`, `clampLead`.
- `src/time.ts`: `localParts(date, tz)` (y/m/d/dow(0=Mon)/minuteOfDay via `Intl.DateTimeFormat`), `zonedTimeToUtc(localDate, 'HH:MM', tz)` (via `@date-fns/tz`), `nextOccurrence(now, tz, 'HH:MM', daysOfWeek) → Date|null`, `bucketOf(minuteOfDay)`.
- Tests: interpolation (T18: on-grid exact, midpoint mean, below 15 clamps, above 120 null), verdict truth table, `nextOccurrence` across a DST change (America/Toronto 2026-03-08 and 2026-11-01), haversine known distance (Toronto Union → CN Tower ≈ 0.6 km), every zod schema parses a fixture object.

### WP-3 — `@dockcast/collector` (Lane A, Deps: WP-1, WP-2)
Dir: `apps/collector`. Spec: `collector-spec.md` in full. Acceptance: its DoD checklist + tests green.

### WP-4 — `dockcast_ml` core & bootstrap (Lane B, Deps: WP-0)
Dir: `ml/`. Spec: `worker-spec.md` modules: `config.py`, `db.py`, `timeutil.py`, `horizons.py`, `logging_setup.py`, `gbfs_ids.py`, `segments.py`, `bootstrap/{run,trips,weather_history}.py`, `rates.py`, `weather_glm.py`, `bd.py`, `neighbors.py`, `__main__.py` wiring for `bootstrap`, `neighbors`. Tests: T1–T8, `test_trips_parse.py`, `test_weather_history.py`, bootstrap DB integration on fixtures (using `fixtures/trips/*.csv` as the "downloaded" files via an injected loader).

### WP-5 — `dockcast_ml` grid/features/predict (Lane B, Deps: WP-4)
Dir: `ml/`. Modules: `grid.py`, `weather_asof.py`, `features.py`, `profile.py` (`RollingProfile`), `models/artifact.py` (load only), `models/calibration.py` (apply), `predict.py`, `__main__.py` commands `predict`, `profile`. Tests: T9–T14, `test_features_golden.py`, predict-once DB integration (seeded from GBFS fixture + synthetic rates) asserting `forecasts_latest` rows for all stations × 6 horizons with `tier='bd_raw'` and probabilities in [0,1], `reason` set for a deliberately stale station, and `forecast_history` written iff `t0.minute % 15 == 0`.

### WP-6 — `dockcast_ml` train/eval/gate/online metrics (Lane B, Deps: WP-5)
Dir: `ml/`. Modules: `models/gbm.py`, `models/calibration.py` (fit), `evaluate.py`, `gate.py`, `labels.py`, `metrics_online.py`, `train.py`, `__main__.py` commands `train`, `labels`, `metrics`. Tests: T15–T17, synthetic end-to-end (worker-spec §7) proving: gate JSON shape, `model_versions` state transitions (active→superseded), `model_eval` rows present for every (target,horizon∈{0,15..120},slice), `model_metrics_daily` rows for windows 1 and 7 including `persistence`, and that `gbm` Brier < persistence Brier on the synthetic data.

### WP-7 — `@dockcast/api` public read side (Lane C, Deps: WP-1, WP-2)
Dir: `apps/api`. Layout:
```
src/index.ts            boot: config → migrate → app → listen → alerts scheduler (WP-8)
src/config.ts           zod env (PORT=3000, DATABASE_URL, SESSION_SECRET, VAPID_*, PUBLIC_BASE_URL, LOG_LEVEL, NODE_ENV, WEB_DIST_DIR)
src/app.ts              createApp(deps): helmet, pino-http (req id), json, cookie/session (WP-8), routers, static (§9), error handler
src/middleware/{requestId,errors,rateLimit,requireFetchHeader,requireAuth}.ts
src/routes/{health,cities,stations,trip,model}.ts        (WP-7)
src/routes/{auth,commutes,push}.ts                       (WP-8)
src/forecast/{lookup.ts,alternatives.ts,verdict.ts}      api.md §0.1 (uses @dockcast/shared)
src/services/*.queries.ts                                one file per table group; parameterised SQL only
src/static.ts
test/                                                    supertest against DATABASE_URL_TEST seeded via test/seed.ts (fixtures/gbfs → cities/stations/station_current, synthetic forecasts_latest, tod profile, model_versions/model_metrics_daily rows)
```
- Implements api.md §1–4 exactly (incl. cache headers, error envelope, rate limits, `X-Request-Id`), `lookup`, `alternatives`, `verdict` (§0.1) with injectable `now`.
- Tests: every endpoint happy path + 404s + validation; `lookup` interpolation cases; `/trip` beyond-120 → typical; alternatives radius/ordering; map payload shape; static SPA fallback.

### WP-8 — `@dockcast/api` auth, commutes, push, alert scheduler (Lane C, Deps: WP-7)
Dir: `apps/api`. Implements api.md §5–8. Session store `connect-pg-simple` on the `session` table (created by migration; `createTableIfMissing:false`). Argon2id. `web-push` sender wrapped in `alerts/sender.ts` with an injectable transport for tests. Scheduler tick per §8 with injectable clock; the tick function is exported and unit-tested directly (no timers in tests).
- Tests: register/login/logout/me flow, wrong password → 401 same message, rate limit 429, commute CRUD + ownership 403 + max 20, outlook computation, push subscribe idempotency, scheduler: given seeded commute at 08:15 lead 20 and clock 07:55 local with low forecast → one alert_events row and one transport call; second tick same minute → no duplicate; 410 from transport → subscription deleted.

### WP-9 — `@dockcast/web` foundation, map, station page (Lane D, Deps: WP-2; can start before WP-7 using MSW handlers built from api.md fixtures)
Dir: `apps/web`. Spec: `ui-spec.md` sections for tooling, design system, layout, `/`, `/station/:id`, `/login`, `/register`, `/about`, 404, API client, service worker registration.

### WP-10 — `@dockcast/web` trip, commutes, push, model page (Lane D, Deps: WP-9)
Dir: `apps/web`. Spec: `ui-spec.md` sections for `/trip`, `/commutes`, push flow, `/model`, `sw.js`. Tests per ui-spec §8.

### WP-11 — Infra & deploy (Lane E, Deps: WP-3, WP-6, WP-8, WP-10)
Dirs: `infra/`, `apps/*/Dockerfile`, `ml/Dockerfile`, `.github/workflows/deploy.yml`, `infra/scripts/*`. Spec: `infra.md`. Acceptance: `docker compose -f infra/docker-compose.yml build` succeeds locally; `docker compose up` locally with a `.env` (DOMAIN=localhost, Caddy internal TLS or http) → `/api/v1/health` 200, collector completes a real cycle against Toronto's live feed, `worker-predict` runs once (bd tier) after `bootstrap` (bootstrap may be run with `--from 2026-03 --to 2026-03` to keep it short in the smoke test).

### WP-12 — Integration, end-to-end verification, README (Lane: root, Deps: WP-11)
- Run the full stack locally for ≥ 20 minutes against the live Toronto feed; verify: snapshots accumulate, `forecasts_latest` populated, map shows forecasts, station page chart renders, `/trip` works, register → commute → push test works in Chrome, `/model` renders with `bd_raw` metrics absent (expected: no labels yet) and versions list showing bd.
- Finalise `README.md` (screenshots placeholders, architecture diagram from architecture.md, "How the model works" summary linking ml-spec, honest limitations, run/deploy instructions).
- Orchestrator runs `/code-review` (medium) over the repo and dispatches fix-up WPs for any confirmed findings.

## 3. Lanes & schedule (agents run concurrently within a wave)

| Wave | Concurrent WPs |
|---|---|
| 1 | WP-0 |
| 2 | WP-1, WP-2, WP-4 |
| 3 | WP-3, WP-7, WP-5, WP-9 |
| 4 | WP-8, WP-6, WP-10 |
| 5 | WP-11 |
| 6 | WP-12 |

Each WP is one Sonnet agent run (`model: sonnet`), in the repo working tree (lanes touch disjoint directories; root files only in WP-0/WP-12). Orchestrator reviews each WP's report, runs the tests itself, and either accepts (next wave) or dispatches a fix-up run to the same agent with the concrete failure.

## 4. Sonnet task prompt template (verbatim skeleton the orchestrator fills)

```
You are implementing WP-<n> "<title>" of the DockCast project at /Users/ashar/proj/dockcast.
Read, in order and completely: docs/architecture.md, <WP spec docs>, docs/plan.md §1 (global rules) and §2 WP-<n>.
Reference data: fixtures/... ; schema: db/migrations/0001_init.sql (read-only).
Scope: create/modify ONLY: <dirs/files>. Do not modify docs/ or migrations.
Deliverables: <file list from spec>. Tests: <list>. Commands that must pass: <commands>.
Environment: Postgres for tests at DATABASE_URL_TEST=<url> (already running); Node 22 + pnpm; Python via uv.
Rules: docs/plan.md §1 R1–R10 are mandatory. If anything is ambiguous, STOP and ask in your final message rather than guessing.
When done: commit "WP-<n>: <title>" and produce the final report in the R7 format with full test output.
```

## 5. Definition of done for v1

- All WPs merged on `main` with green CI.
- Deployed at `https://<DOMAIN>` with Toronto collecting; `bootstrap` run; predictor serving `bd_raw`.
- After 14 days: first `train` run has produced a `bd` calibrated version; after ≥ 14 days with data the `gbm` gate has been evaluated at least once and `/model` shows online metrics for persistence vs bd vs gbm.
- README + docs published; no secrets in repo.
