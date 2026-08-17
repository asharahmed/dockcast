# DockCast

DockCast is a web app that forecasts bike-share station availability at the
time you will actually be there. Users pick a city, save commutes (origin
station → destination station, departure time), and get calibrated
probabilities like "82% chance of a bike at Home at 8:15, 41% chance of a
dock at Work at 8:40 — nearest ≥90% dock: Station X (2 min walk)", a live map
with a forecast time-slider, per-station pages, web-push alerts before
departure, and a public model-quality page.

## Repo layout

```
dockcast/
├── docs/                          # these specs — normative, read before changing anything
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
│   ├── docker-compose.dev.yml     # local: db only (apps run on host) — see docs/infra.md §2
│   ├── Caddyfile
│   ├── supercronic/crontab        # worker-train schedule
│   └── scripts/{deploy.sh,backup.sh,restore.sh}
├── .github/workflows/{ci.yml,deploy.yml}
├── package.json, pnpm-workspace.yaml, tsconfig.base.json, .nvmrc (22), .env.example
└── README.md
```

## Dev quickstart

Full details (including the `.env` values and Python workflow) are in
[`docs/infra.md` §2](docs/infra.md#2-dev-compose--infradocker-composedevyml).
Short version:

```sh
# 1. Node side
pnpm install
docker compose -f infra/docker-compose.dev.yml up -d db db-test
cp .env.example .env               # fill in DATABASE_URL etc. — see docs/infra.md §5
pnpm db:migrate
pnpm dev                           # runs api, collector, and web dev servers

# 2. Python side
cd ml
uv sync
uv run python -m dockcast_ml predict --once
```

## Documentation

Everything under [`docs/`](docs/) is normative — `architecture.md`,
`ml-spec.md`, `api.md`, `ui-spec.md`, `collector-spec.md`, `worker-spec.md`,
`infra.md`, and `plan.md`, plus the schema in `db/migrations/0001_init.sql`.
When code and docs disagree, the docs are treated as the specification and
the code is fixed to match — never the reverse.
