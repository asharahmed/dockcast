# DockCast — System Architecture (v1)

Status: PLANNING DRAFT for approval. Companion docs: `ml-spec.md` (approved),
`api.md`, `ui-spec.md`, `collector-spec.md`, `worker-spec.md`, `infra.md`,
`plan.md`, and the schema in `db/migrations/0001_init.sql`.

## 1. What DockCast is

A web app that forecasts bike-share station availability at the time you will
actually be there. Users pick a city, save commutes (origin station → destination
station, departure time), and get calibrated probabilities like "82 % chance of a
bike at Home at 8:15, 41 % chance of a dock at Work at 8:40 — nearest ≥90 % dock:
Station X (2 min walk)", a live map with a forecast time-slider, per-station
pages, web-push alerts before departure, and a public model-quality page.

Design principles:
- **No LLM / no external inference in the load-bearing path.** All forecasting is
  in-house (`ml-spec.md`).
- **Cost flat in users.** Forecasts are computed once per 5 min per city and read
  by everyone; Postgres is the contract between the Node side and the Python side.
- **Any GBFS city can be ingested; forecasting requires trip-history rates**
  (v1: Toronto only has rates; other cities → live map + collection only).

## 2. Components

```
                ┌───────────────────────────── VPS (docker compose) ─────────────────────────────┐
                │                                                                                │
 GBFS feeds ──▶ │  collector (Node/TS)  ──writes──▶  ┌────────────────────────────┐              │
 Open-Meteo ──▶ │   60 s station_status              │  db: TimescaleDB + PostGIS │ ◀── reads ── │ ◀── browser
                │   30 min weather forecast          │  (Postgres 16)             │              │      (React SPA)
                │   1 h station_information          └────────────────────────────┘              │
                │                                         ▲          ▲        ▲                  │
                │  worker-predict (Python) ──writes forecasts_latest / forecast_history           │
                │   every 5 min                            │          │        │                  │
                │  worker-train (Python, nightly 03:30 local) ─ trains, gates, writes models     │
                │                                                                │                │
                │  api (Node/TS Express 5) ──reads/writes───────────────────────┘                │
                │   REST /api/v1, auth, commutes, alert scheduler, serves web build              │
                │                                                                                │
                │  caddy ── TLS, reverse proxy :443 → api:3000                                   │
                └────────────────────────────────────────────────────────────────────────────────┘
```

| Component | Language / runtime | Responsibilities | Replicas |
|---|---|---|---|
| `db` | `timescale/timescaledb-ha:pg16` (Postgres 16 + TimescaleDB 2.x + PostGIS 3) | all state; hypertables for snapshots/forecast history/labels; compression + retention policies | 1 |
| `collector` | Node 22, TypeScript, ESM | GBFS adapter (2.x & 3.0), 60 s `station_status` poll with change-only writes + `poll_log`, hourly `station_information` sync (upsert stations, mark inactive), 30 min Open-Meteo forecast fetch, dead-man ping | 1 per deployment (single process handles all active cities) |
| `worker` | Python 3.12 (`uv`), pandas/numpy/scipy/lightgbm/sklearn/statsmodels/psycopg | `bootstrap` (trip CSVs → rates, weather GLM), `predict` loop, `train` nightly (calibrate `bd`, train `gbm`, gate, labels, online metrics), `profile` (tod profile) — see `ml-spec.md`, `worker-spec.md` | `worker-predict` (loop) + `worker-train` (cron in-container via `supercronic`) |
| `api` | Node 22, TypeScript, Express 5 | REST API (`api.md`), session auth (argon2 + Postgres sessions), commutes, trip check, web-push alert scheduler (1-min tick), migrations on boot, serves `apps/web/dist` | 1 (alert scheduler assumes single replica; documented) |
| `web` | React 19 + Vite 6 + TypeScript, MapLibre GL, TanStack Query, Recharts, Tailwind v4 | SPA (`ui-spec.md`) | static, served by `api` behind Caddy |
| `caddy` | Caddy 2 | automatic HTTPS, reverse proxy, gzip/zstd, static caching headers | 1 |

Data flows and timings are normative in `collector-spec.md` / `worker-spec.md`.

## 3. Repository layout (pnpm workspace + uv project)

```
dockcast/
├── docs/                          # these specs
├── fixtures/                      # real sample data used by tests (gbfs/, trips/, weather/)
├── db/
│   └── migrations/0001_init.sql   # THE schema; applied by packages/db migrator (api on boot, or `pnpm db:migrate`)
├── packages/
│   ├── shared/                    # @dockcast/shared — zod schemas + TS types for every API DTO, time helpers, interpolation
│   └── db/                        # @dockcast/db — pg Pool factory, SQL migrator, typed query helpers used by api+collector
├── apps/
│   ├── api/                       # @dockcast/api — Express 5
│   ├── collector/                 # @dockcast/collector — poller
│   └── web/                       # @dockcast/web — React SPA
├── ml/                            # Python package `dockcast_ml` (uv, pyproject.toml, tests/)
├── infra/
│   ├── docker-compose.yml         # prod
│   ├── docker-compose.dev.yml     # local: db only (apps run on host) — see infra.md
│   ├── Caddyfile
│   ├── supercronic/crontab        # worker-train schedule
│   └── scripts/{deploy.sh,backup.sh,restore.sh}
├── .github/workflows/{ci.yml,deploy.yml}
├── package.json, pnpm-workspace.yaml, tsconfig.base.json, .nvmrc (22), .env.example
└── README.md
```

## 4. Technology decisions (pinned)

Node side (all ESM, `"type": "module"`, TypeScript `strict`, target ES2022):
- pnpm 9 workspaces; Node 22 LTS; TypeScript 5.6+; `tsx` for dev, `tsc` for build; `vitest` + `supertest` for tests; ESLint (typescript-eslint recommended) + Prettier (defaults, 100 cols).
- `express@5`, `pg@8`, `zod@3`, `pino` + `pino-http`, `helmet`, `express-rate-limit`, `express-session` + `connect-pg-simple`, `argon2`, `web-push`, `cookie-parser` (not needed with express-session), `undici` fetch (built-in `fetch`).
- No ORM. Hand-written parameterised SQL in `*.queries.ts` modules; `pg` types mapped explicitly (`types.setTypeParser` for `int8`→number, `numeric`→number, timestamptz→Date).
- Web: `react@19`, `react-dom@19`, `react-router@7` (declarative `BrowserRouter`), `@tanstack/react-query@5`, `maplibre-gl@5`, `recharts@3`, `tailwindcss@4` (+ `@tailwindcss/vite`), `date-fns@4` + `@date-fns/tz`, `zod` (shared). Basemap: OpenFreeMap vector style `https://tiles.openfreemap.org/styles/positron` (no API key). Charts follow the `dataviz` guidance captured in `ui-spec.md`.
- Auth: email + password (argon2id), server-side sessions in Postgres (`connect-pg-simple` default `session` table), `httpOnly; Secure; SameSite=Lax` cookie `dockcast.sid`, 30-day rolling.
- Push: Web Push with VAPID keys from env; service worker in `apps/web/public/sw.js`.

Python side:
- Python 3.12; `uv` with `pyproject.toml` + `uv.lock`; `pandas>=2.2,<3`, `numpy>=2,<3`, `scipy>=1.14`, `lightgbm>=4.5,<5`, `scikit-learn>=1.5,<2`, `statsmodels>=0.14`, `psycopg[binary]>=3.2`, `holidays>=0.5x`, `httpx`, `pytest`, `ruff`. CLI: `python -m dockcast_ml <command>` (argparse).
- Model artifacts are pickled bundles stored in `model_versions.artifact` (bytea). Workers are stateless.

Database:
- Postgres 16, TimescaleDB 2.x, PostGIS 3.x (verified 2026-08-17: `timescale/timescaledb-ha:pg16` = PostgreSQL 16.14 + TimescaleDB 2.29.1 + PostGIS 3.6.4; `0001_init.sql` applies cleanly: 4 hypertables, 2 compression + 4 retention policies). Hypertables: `station_snapshots`, `poll_log`, `forecast_history`, `forecast_labels`. Compression after 7 days (segment by station), retention: snapshots 120 d, poll_log 120 d, forecast_history 180 d, forecast_labels 180 d. Everything else is a plain table.
- All timestamps `timestamptz` (UTC). Local-time logic uses `cities.tz` in application code (`Intl`/`@date-fns/tz` in Node, `zoneinfo` in Python), never `SET timezone`.
- Internal integer surrogate keys (`stations.id`) everywhere in hot tables; GBFS string ids only in `stations.station_id` and the trip aggregate tables.

Infra:
- Single VPS (Hetzner CX22 / DO 2 GB+), Docker Compose, Caddy TLS. GitHub Actions: `ci.yml` (lint, typecheck, unit + DB tests against a `timescaledb-ha` service container, python tests), `deploy.yml` (build → GHCR → SSH `docker compose pull && up -d`). Nightly `pg_dump` to S3-compatible bucket (B2/R2). healthchecks.io pings from collector (every successful cycle) and trainer.

## 5. Cross-cutting rules

- **IDs in URLs are `stations.id` (int)**, never GBFS ids.
- **Horizons** `H = [15,30,45,60,90,120]` and interpolation rules live in `@dockcast/shared/time.ts` and `dockcast_ml/horizons.py`; both must be identical (a test asserts the constant list).
- **Freshness** as defined in `ml-spec.md §1.2` is computed in SQL by one view `station_state_fresh` (used by api and predictor) — single definition, see `0001_init.sql`.
- **Errors**: API returns `{ "error": { "code": string, "message": string, "details"?: unknown } }` (see `api.md`).
- **Logging**: JSON lines (`pino` / Python `logging` JSON formatter); one line per collector cycle, predictor cycle, trainer run.
- **Config**: env vars only, validated at boot (`zod` in Node, explicit checks in Python); `.env.example` is exhaustive (see `infra.md`).
- **Tests are part of the deliverable** for every work package (`plan.md`); the ML tests T1–T18 in `ml-spec.md §8` are mandatory.

## 6. Non-goals for v1

Native apps; email alerts (v1.1: Resend); user-adjustable models; multi-language; forecasting for cities without trip-history rates (v1.1: rates from observed snapshot deltas); station-level quantile display on the map (station page only).
