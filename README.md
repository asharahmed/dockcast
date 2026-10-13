# DockCast

Bike-share availability forecasts for the moment you actually arrive, not just right now.

[![ci](https://github.com/asharahmed/dockcast/actions/workflows/ci.yml/badge.svg)](https://github.com/asharahmed/dockcast/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node 22](https://img.shields.io/badge/node-22-339933?logo=node.js&logoColor=white)
![Python 3.12](https://img.shields.io/badge/python-3.12-3776AB?logo=python&logoColor=white)

![Live map with the forecast horizon slider](docs/screenshots/map.jpg)

DockCast polls a city's GBFS feed every minute, learns each station's arrival and departure rates from a year of public trip history, and publishes calibrated probabilities such as "82 % chance of a bike at Home at 8:15, 41 % chance of a dock at Work at 8:40". A nightly LightGBM challenger is trained on DockCast's own forecast history and only serves traffic once it beats the baseline on held-out days. Every forecast is later scored against what really happened, and those scores are public on the `/model` page.

No LLM or external inference service sits anywhere in the forecasting path. The models are described [below](#how-the-forecast-works) and in full in [`docs/ml-spec.md`](docs/ml-spec.md).

**Live at [dockcast.aahmed.ca](https://dockcast.aahmed.ca)** for Bike Share Toronto. Any city with a GBFS feed can be added with one command; see [Adding a city](#adding-a-city).

## Features

- **Live map** of every station, coloured by the probability of finding a bike (or an empty dock) at a horizon you drag from now to +2 h.
- **Trip check**: pick origin, destination and departure time, and get a verdict ("Looks good", "Risky", "Don't count on it") plus nearby alternatives when the odds are poor.
- **Station pages**: current state, a forecast table at six horizons, a 24 h history and forecast chart with an uncertainty band, and a typical-day profile.
- **Saved commutes** with a live outlook chip and optional web-push alerts before you leave if the odds have dropped.
- **Model transparency**: the public `/model` page shows Brier score, calibration and MAE for every model tier over rolling 1-day and 7-day windows, with no hand-picked numbers.
- **Accounts** with email and password, Google, or Apple sign-in, and identity linking between them.

| Station page | Trip check |
|---|---|
| ![Station page](docs/screenshots/station.jpg) | ![Trip check](docs/screenshots/trip.jpg) |

| Model quality | Sign-in gate on `/commutes` |
|---|---|
| ![Model page](docs/screenshots/model.jpg) | ![Commutes auth redirect](docs/screenshots/commutes.jpg) |

## How the forecast works

Full detail in [`docs/ml-spec.md`](docs/ml-spec.md). The short version:

1. **Birth-death baseline (`bd`)**. Each station is a finite-capacity queue. Bikes arrive and leave at rates learned from a year of the city's own trip history, bucketed by station, day type (weekday, Saturday, Sunday or holiday) and 15-minute slot, then scaled by a weather multiplier fit with a Poisson GLM on temperature and precipitation. At forecast time the transient distribution of the chain over the next two hours is computed exactly with a matrix exponential (`scipy.linalg.expm`), giving `P(≥1 bike)`, `P(≥1 dock)` and an expected count at 15, 30, 45, 60, 90 and 120 minutes.
2. **Calibration (`bd_cal`)**. Once at least 14 days of forecast history exist, the baseline's probabilities pass through an isotonic regression fit on a rolling window, which corrects its over-confidence.
3. **Learned challenger (`gbm`)**. Three pooled LightGBM models (bike, dock, count) are trained nightly on DockCast's own forecast history joined to the labels that later materialised. The `bd` output is stacked as a feature alongside station state, time, weather and neighbouring-station context.
4. **Walk-forward validation and a promotion gate**. The challenger is scored on held-out days against the baseline on Brier score, calibration error and MAE. It is promoted only if it wins on every check. Otherwise it stays a shadow model: scored, but not served.
5. **Continuous online scoring**. Every forecast made at a 15-minute grid origin is scored once its label arrives. Rolling per-tier metrics feed the `/model` page, which is where a degrading champion would show up first.

For an arbitrary lead time the API interpolates linearly between the two bracketing horizons. Beyond 120 minutes it falls back to a "typical for this time of day" profile built from the last four weeks.

## Architecture

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

Postgres is the contract between the Node side and the Python side. Forecasts are computed once per city every five minutes and read by everyone, so serving cost is flat in the number of users.

| Component | Stack | Responsibilities |
|---|---|---|
| `db` | Postgres 16, TimescaleDB, PostGIS | All state. Hypertables for snapshots, poll log, forecast history and labels. |
| `collector` | Node 22, TypeScript | GBFS polling (60 s status, 1 h station info, 30 min weather) with change-only writes. |
| `worker` | Python 3.12, pandas, LightGBM, SciPy, statsmodels | `bootstrap` (trip history to rates), the `predict` loop, nightly `train` (calibrate, gate, score). |
| `api` | Node 22, Express 5 | REST API, session auth, commutes, trip check, web-push alert scheduler. Serves the SPA. |
| `web` | React 19, Vite 6, MapLibre GL, TanStack Query, Recharts, Tailwind v4 | The single-page app. |
| `caddy` | Caddy 2 | Automatic HTTPS, reverse proxy, gzip and zstd. |

### Repository layout

```
apps/
  api/          Express 5 API, auth, commutes, alert scheduler; serves the web build
  collector/    GBFS and Open-Meteo poller
  web/          React SPA
packages/
  shared/       Types, zod schemas, constants and time helpers shared by every Node package
  db/           pg pool, SQL helpers and the migration runner
db/migrations/  SQL migrations (TimescaleDB + PostGIS)
ml/             Python worker: the dockcast_ml package, its tests and Dockerfile
infra/          docker-compose (prod and dev), Caddyfile, cron, backup/restore/deploy scripts
fixtures/       GBFS, weather and trip-history samples used by the tests
docs/           Specs and runbooks (see the table at the end)
```

## Getting started

### Prerequisites

- Node 22 and pnpm 9 (`corepack enable` picks up the pinned version from `package.json`)
- Python 3.12 and [uv](https://docs.astral.sh/uv/)
- Docker with Compose v2

### Development (apps on the host, databases in Docker)

```sh
pnpm install
docker compose -f infra/docker-compose.dev.yml up -d db db-test
cp .env.example .env
```

Edit `.env` for local use. The dev scripts load it through Node's `--env-file`, so nothing needs exporting:

| Variable | Dev value |
|---|---|
| `DATABASE_URL` | `postgres://postgres:dockcast@localhost:5432/dockcast` |
| `DATABASE_URL_TEST` | `postgres://postgres:dockcast@localhost:5433/dockcast_test` |
| `PUBLIC_BASE_URL` | `http://localhost:5173` |
| `SESSION_SECRET` | output of `openssl rand -base64 48` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | output of `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | `mailto:you@example.com` |
| `NODE_ENV` | `development` |

Then:

```sh
pnpm db:migrate
pnpm dev                        # api :3000, web :5173 (proxies /api to the api), collector

cd ml && uv sync --extra dev
uv run --env-file ../.env python -m dockcast_ml bootstrap --city toronto --from 2026-03 --to 2026-03 --cache-dir .cache
uv run --env-file ../.env python -m dockcast_ml predict --once
```

Toronto is registered by the first migration, so the collector starts filling `station_snapshots` on its first poll. The map shows live availability as soon as that lands, and forecasts once `bootstrap` and `predict` have run.

### Full stack in Docker (matches the production images)

```sh
cp .env.example infra/.env.local-smoke
# In that file set SITE_ADDRESS=http://localhost, PUBLIC_BASE_URL=http://localhost, ENV_FILE=.env.local-smoke,
# SESSION_SECRET and the VAPID keys. The file is gitignored.
docker compose -p dockcast-smoke -f infra/docker-compose.yml --env-file infra/.env.local-smoke up -d --build
curl http://localhost/api/v1/health
docker compose -p dockcast-smoke -f infra/docker-compose.yml --env-file infra/.env.local-smoke \
  run --rm worker-train python -m dockcast_ml bootstrap --city toronto --from 2026-03 --to 2026-03
docker compose -p dockcast-smoke -f infra/docker-compose.yml --env-file infra/.env.local-smoke down -v
```

[`docs/infra.md`](docs/infra.md) §2 covers the dev compose file and §12 the full local smoke-test workflow. Every environment variable is listed with a comment in [`.env.example`](.env.example).

### Worker CLI

All worker entry points are subcommands of `python -m dockcast_ml`:

| Command | What it does |
|---|---|
| `bootstrap --city SLUG [--from YYYY-MM --to YYYY-MM]` | Download trip history, fit per-station rates and the weather GLM. |
| `predict [--city SLUG] (--once \| --loop) [--t0 ISO]` | Write `forecasts_latest` and `forecast_history` for every station. |
| `train [--city SLUG] [--date YYYY-MM-DD]` | Nightly job: calibrate, train the challenger, run the gate, score. |
| `labels`, `metrics`, `profile`, `neighbors` | The individual stages `train` runs, for backfills and debugging. |
| `add-city --slug ... --gbfs-url ...` | Register a new city from its GBFS feed. |

## API

The REST API lives under `/api/v1`. The public surface:

| Endpoint | Returns |
|---|---|
| `GET /health` | Liveness and database check. |
| `GET /cities`, `GET /cities/:slug/stations` | City list and station metadata. |
| `GET /cities/:slug/map` | Per-station probabilities for the map at every horizon. |
| `GET /stations/:id`, `GET /stations/:id/history` | Station state, forecast table and 24 h history. |
| `GET /trip?origin=&dest=&depart_at=&ride_minutes=` | Trip verdict with alternatives per leg. |
| `GET /model?city=`, `GET /model/versions/:id` | Model-quality metrics, active versions and gate results. |

Authenticated routes cover accounts, OAuth linking, commutes and push subscriptions. Every endpoint and DTO is specified in [`docs/api.md`](docs/api.md).

## Adding a city

DockCast is city-generic. Registering a city from its GBFS feed gives it a live map immediately. Forecasts need one `bootstrap` run on top, which requires a trip-history source (a `generic_csv` adapter is included). The walkthrough is in [`docs/add-a-city.md`](docs/add-a-city.md).

## Testing

```sh
export DATABASE_URL_TEST=postgres://postgres:dockcast@localhost:5433/dockcast_test   # the dev compose db-test service
pnpm -r lint && pnpm -r typecheck && pnpm -r test
cd ml && uv run ruff check . && uv run pytest -q
```

The `dev` extra brings in ruff and pytest. Database-backed tests skip themselves when `DATABASE_URL_TEST` is unset. The `db-test` container has no volume, so every run starts from a clean server.

CI runs lint, typecheck, build and both test suites against a TimescaleDB service on every push and pull request. Python tests marked `slow` are excluded by default.

## Deploy

One host, Docker Compose, Caddy for TLS. GitHub Actions builds the `api`, `collector` and `worker` images and pushes them to GHCR on every green `main` build, then rolls the host over SSH once the VPS secrets are configured. The runbook, secrets list and backup/restore scripts are in [`docs/infra.md`](docs/infra.md) (§1, §6, §7, §8).

## Data sources and licences

- **GBFS feed**: Bike Share Toronto (PBSC / Toronto Parking Authority), GBFS v3.0.
- **Trip history**: Toronto Open Data, "Bike Share Toronto Ridership Data" (Open Government Licence, Toronto).
- **Weather**: [Open-Meteo](https://open-meteo.com) (CC BY 4.0, non-commercial free tier). Archive API for training, forecast API for serving.
- **Basemap**: [OpenFreeMap](https://openfreemap.org) vector tiles, OpenMapTiles, © OpenStreetMap contributors.

## Limitations

- **Rebalancing by operator vans is not modelled** in the flow baseline. The learned model is expected to pick some of it up once enough data exists.
- **Trip-history rates are annual averages.** They correct for weather but not for secular ridership growth at a station.
- **Poisson over-dispersion is handled after the fact** by calibration, not by the process model itself.
- **Special events** (parades, closures, construction) will be wrong. A model with no event calendar cannot do better.
- **The learned model needs real forecast history to train** (at least 14 local days). A fresh deployment reports `insufficient_data` until then and serves the baseline only.
- **The alert scheduler assumes a single API replica.**

The full list is [`docs/ml-spec.md`](docs/ml-spec.md) §9.

## Documentation

| Doc | Contents |
|---|---|
| [`architecture.md`](docs/architecture.md) | System design, component table, cross-cutting rules |
| [`ml-spec.md`](docs/ml-spec.md) | The forecasting model in full: data, math, training, gating, metrics |
| [`api.md`](docs/api.md) | HTTP API contract, every endpoint and DTO |
| [`ui-spec.md`](docs/ui-spec.md) | Frontend spec: design system, routes, components |
| [`collector-spec.md`](docs/collector-spec.md) | GBFS polling behaviour |
| [`worker-spec.md`](docs/worker-spec.md) | Python worker module layout and CLI |
| [`infra.md`](docs/infra.md) | Docker Compose, deploy runbook, backups, monitoring |
| [`add-a-city.md`](docs/add-a-city.md) | Registering and bootstrapping another GBFS city |
| [`plan.md`](docs/plan.md) | Implementation plan and work packages (how this was built) |

## Contributing

Issues and pull requests are welcome. Please run the test commands above before opening a PR. The specs in `docs/` are normative: if a change alters behaviour they describe, update the spec in the same PR.

## License

[MIT](LICENSE)
