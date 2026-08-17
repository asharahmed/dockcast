# DockCast — Infrastructure & Deployment (v1)

Status: PLANNING DRAFT for approval. Normative once approved. Single VPS,
Docker Compose, Caddy TLS, GitHub Actions CI/CD, GHCR images. Everything below is
written to be copied verbatim; `<owner>` = GitHub owner (lowercase), `DOMAIN`
e.g. `dockcast.aahmed.ca`.

Files this doc defines (all under the repo):
```
infra/docker-compose.yml          infra/docker-compose.dev.yml     infra/Caddyfile
infra/supercronic/crontab         infra/scripts/deploy.sh          infra/scripts/backup.sh
infra/scripts/restore.sh          apps/api/Dockerfile              apps/collector/Dockerfile
ml/Dockerfile                     .env.example                     .github/workflows/ci.yml
.github/workflows/deploy.yml      .dockerignore
```

---------------------------------------------------------------------------

## 1. Production compose — `infra/docker-compose.yml`

Deployed at `/opt/dockcast/` on the VPS together with `.env`, `Caddyfile`, `supercronic/crontab`.
Images come from GHCR; nothing is built on the VPS.

```yaml
name: dockcast

x-logging: &default-logging
  driver: json-file
  options: { max-size: "20m", max-file: "5" }

x-app-env: &app-env
  env_file: .env
  logging: *default-logging
  restart: unless-stopped

services:
  db:
    image: timescale/timescaledb-ha:pg16            # Postgres 16 + TimescaleDB 2.x + PostGIS 3
    logging: *default-logging
    restart: unless-stopped
    environment:
      POSTGRES_DB: dockcast
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      TZ: UTC
    command: >
      postgres
      -c shared_buffers=512MB
      -c effective_cache_size=1536MB
      -c work_mem=16MB
      -c maintenance_work_mem=128MB
      -c max_connections=60
      -c timescaledb.max_background_workers=8
      -c log_min_duration_statement=2000
    volumes:
      - dbdata:/home/postgres/pgdata/data          # NOTE: timescaledb-ha PGDATA path (not /var/lib/postgresql/data)
    shm_size: 256m
    mem_limit: 1536m
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d dockcast"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 30s
    ports: []                                       # never published; reach via `docker compose exec db psql`

  api:
    <<: *app-env
    image: ghcr.io/<owner>/dockcast-api:latest
    environment:
      NODE_ENV: production
      PORT: "3000"
      WEB_DIST_DIR: /app/web-dist
      MIGRATIONS_DIR: /app/db/migrations
    depends_on:
      db: { condition: service_healthy }
    mem_limit: 512m
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 40s

  collector:
    <<: *app-env
    image: ghcr.io/<owner>/dockcast-collector:latest
    environment:
      NODE_ENV: production
      MIGRATIONS_DIR: /app/db/migrations
    depends_on:
      db: { condition: service_healthy }
      api: { condition: service_started }           # api applies migrations on boot; collector waits (see §1.1)
    mem_limit: 256m

  worker-predict:
    <<: *app-env
    image: ghcr.io/<owner>/dockcast-worker:latest
    command: ["python", "-m", "dockcast_ml", "predict", "--loop"]
    environment:
      MIGRATIONS_DIR: /app/db/migrations
      TZ: UTC
    depends_on:
      db: { condition: service_healthy }
      api: { condition: service_started }
    mem_limit: 768m

  worker-train:
    <<: *app-env
    image: ghcr.io/<owner>/dockcast-worker:latest
    command: ["supercronic", "-passthrough-logs", "/app/crontab"]
    environment:
      MIGRATIONS_DIR: /app/db/migrations
      TZ: America/Toronto                           # supercronic schedules in the container's local time
      TRIPS_CACHE_DIR: /data/cache
    volumes:
      - ./supercronic/crontab:/app/crontab:ro
      - workercache:/data/cache                     # downloaded trip zips (bootstrap), ~250 MB
    depends_on:
      db: { condition: service_healthy }
      api: { condition: service_started }
    mem_limit: 2048m                                # LightGBM training

  caddy:
    image: caddy:2.9-alpine
    logging: *default-logging
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    environment:
      DOMAIN: ${DOMAIN}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddydata:/data
      - caddyconfig:/config
    depends_on:
      api: { condition: service_healthy }

volumes:
  dbdata: {}
  workercache: {}
  caddydata: {}
  caddyconfig: {}
```

### 1.1 Migrations & the wait loop
- `api` runs `@dockcast/db` migrator on boot (`db/migrations/*.sql` in filename order, each file in one transaction, recorded in `schema_migrations(version, name, applied_at)`; already-applied versions are skipped; a version whose file content hash changed after being applied → fatal error at boot).
- `collector`, `worker-predict`, `worker-train` (and every `python -m dockcast_ml <cmd>`) call `assertMigrationsCurrent`/`wait_for_schema` at boot: retry every 5 s for up to 5 min until every file in `MIGRATIONS_DIR` is present in `schema_migrations`; then proceed; after 5 min → log and exit 1 (compose restarts it). Images therefore COPY `db/migrations` to `/app/db/migrations`.
- Manual: `docker compose run --rm api node dist/migrate.js` (api image ships a `migrate.js` entry that runs migrations and exits).

### 1.2 Sizing (Hetzner CX22: 2 vCPU / 4 GB / 40 GB)
db 1.5 GB, worker-train ≤ 2 GB (only during the nightly run; otherwise idle at ~60 MB under supercronic), api 0.5 GB, collector 0.25 GB, worker-predict 0.75 GB, caddy tiny. Peak overlap (nightly) fits in 4 GB with the given `mem_limit`s; add a 2 GB swapfile as safety (runbook §7).
Disk: images ~1.5 GB, DB ~3–8 GB after compression at 120-day retention, cache 0.3 GB.

---------------------------------------------------------------------------

## 2. Dev compose — `infra/docker-compose.dev.yml`

```yaml
name: dockcast-dev
services:
  db:
    image: timescale/timescaledb-ha:pg16
    environment: { POSTGRES_DB: dockcast, POSTGRES_USER: postgres, POSTGRES_PASSWORD: dockcast, TZ: UTC }
    ports: ["5432:5432"]
    volumes: [devdb:/home/postgres/pgdata/data]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U postgres"], interval: 5s, timeout: 3s, retries: 20 }
  db-test:
    image: timescale/timescaledb-ha:pg16
    environment: { POSTGRES_DB: dockcast_test, POSTGRES_USER: postgres, POSTGRES_PASSWORD: dockcast, TZ: UTC }
    ports: ["5433:5432"]
    # no volume: data lives in the container layer and is discarded with the container (a tmpfs mount is
    # created root-owned and the image's non-root entrypoint cannot chown it — see WP-0 report)
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U postgres"], interval: 5s, timeout: 3s, retries: 20 }
volumes:
  devdb: {}
```

Local workflow (root `package.json` scripts):
- `pnpm db:up` → `docker compose -f infra/docker-compose.dev.yml up -d db db-test`
- `pnpm db:migrate` → `tsx packages/db/src/cli.ts migrate` (uses `DATABASE_URL`)
- `pnpm dev` → `concurrently -n api,collector,web "pnpm --filter @dockcast/api dev" "pnpm --filter @dockcast/collector dev" "pnpm --filter @dockcast/web dev"`; api on `:3000` (`tsx watch src/index.ts`), web on `:5173` with Vite `server.proxy: { '/api': 'http://localhost:3000' }`.
- Python: `cd ml && uv sync && uv run python -m dockcast_ml predict --once` (reads `DATABASE_URL` from `../.env` via `--env-file` or exported).
- `.env` for dev: `DATABASE_URL=postgres://postgres:dockcast@localhost:5432/dockcast`, `DATABASE_URL_TEST=postgres://postgres:dockcast@localhost:5433/dockcast_test`.

---------------------------------------------------------------------------

## 3. Dockerfiles

`.dockerignore` (repo root): `node_modules`, `**/node_modules`, `**/dist`, `.git`, `ml/.venv`, `**/*.log`, `.env`, `.env.*`, `!.env.example`.

### 3.1 `apps/api/Dockerfile` (build context = repo root)
```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch

FROM deps AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install -r --frozen-lockfile --offline
RUN pnpm -r --filter @dockcast/shared --filter @dockcast/db --filter @dockcast/api --filter @dockcast/web build
RUN pnpm --filter @dockcast/api --prod deploy /out/api

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN groupadd -r app && useradd -r -g app -d /app app
WORKDIR /app
COPY --from=build --chown=app:app /out/api ./
COPY --from=build --chown=app:app /repo/apps/web/dist ./web-dist
COPY --from=build --chown=app:app /repo/db/migrations ./db/migrations
USER app
EXPOSE 3000
CMD ["node", "dist/index.js"]
```
Requirements on the api package: `dist/index.js` (server) and `dist/migrate.js` (migrate-and-exit) exist after `build`; `WEB_DIST_DIR` and `MIGRATIONS_DIR` env are honoured; `pnpm deploy` works because workspace deps (`@dockcast/shared`, `@dockcast/db`) declare `"main": "dist/index.js"` and have been built first.

### 3.2 `apps/collector/Dockerfile`
Identical to 3.1 with `@dockcast/api`→`@dockcast/collector`, no `web-dist` copy, no `EXPOSE`, `CMD ["node","dist/index.js"]`.

### 3.3 `ml/Dockerfile` (build context = repo root)
```dockerfile
# syntax=docker/dockerfile:1.7
FROM python:3.12-slim-bookworm AS base
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 tzdata ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
# supercronic (cron for containers)
ARG SUPERCRONIC_VERSION=v0.2.33
RUN curl -fsSL -o /usr/local/bin/supercronic \
      https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-amd64 \
 && chmod +x /usr/local/bin/supercronic
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /uvx /bin/
RUN groupadd -r app && useradd -r -g app -d /app app
WORKDIR /app
COPY ml/pyproject.toml ml/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project
COPY ml/ ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev
COPY db/migrations ./db/migrations
RUN mkdir -p /data/cache && chown -R app:app /app /data
ARG GIT_SHA=unknown
ENV PATH="/app/.venv/bin:$PATH" MIGRATIONS_DIR=/app/db/migrations TRIPS_CACHE_DIR=/data/cache GIT_SHA=$GIT_SHA
USER app
CMD ["python", "-m", "dockcast_ml", "predict", "--loop"]
```
(`ml/` must contain `pyproject.toml`, `uv.lock`, `dockcast_ml/`, `tests/`.) On arm64 hosts change the supercronic asset to `-linux-arm64`; the VPS is amd64.

### 3.4 `infra/supercronic/crontab`
```
# TZ=America/Toronto set on the container. Nightly train/eval (ml-spec §7).
30 3 * * * python -m dockcast_ml train --city toronto
# Optional: rebuild tod profile only (cheap) at 12:30 to keep "typical" fresh (train also does it)
30 12 * * * python -m dockcast_ml profile --city toronto
```
DST: because supercronic uses the container's local time, `03:30 America/Toronto` is correct year-round; on the spring-forward night (no 02:xx) 03:30 still exists, on fall-back it runs once.

---------------------------------------------------------------------------

## 4. `infra/Caddyfile`
```
{$DOMAIN} {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		Permissions-Policy "geolocation=(self), camera=(), microphone=()"
		-Server
	}
	@assets path /assets/*
	header @assets Cache-Control "public, max-age=31536000, immutable"
	reverse_proxy api:3000 {
		header_up X-Request-Start {time.now.unix_ms}
	}
	log {
		output file /data/access.log { roll_size 20mb roll_keep 5 }
		format json
	}
}
```
Caddy obtains/renews Let's Encrypt certs automatically (HTTP-01 on :80 → DNS must point at the VPS before first start). `api` trusts `X-Forwarded-*` from the proxy (`app.set('trust proxy', 1)`) so `Secure` cookies and rate-limit IPs work.

---------------------------------------------------------------------------

## 5. `.env.example` (exhaustive; copy to `.env`)
```
# --- database ---
POSTGRES_PASSWORD=change-me                     # used by the db container
DATABASE_URL=postgres://postgres:change-me@db:5432/dockcast    # dev: postgres://postgres:dockcast@localhost:5432/dockcast
DATABASE_URL_TEST=                              # dev/CI only: postgres://postgres:dockcast@localhost:5433/dockcast_test

# --- web / api ---
DOMAIN=dockcast.aahmed.ca                       # Caddy site address (no scheme)
PUBLIC_BASE_URL=https://dockcast.aahmed.ca      # used in push URLs / emails
PORT=3000
SESSION_SECRET=                                 # openssl rand -base64 48   (>= 32 bytes)
VAPID_PUBLIC_KEY=                               # npx web-push generate-vapid-keys
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:ashar@aahmed.ca
LOG_LEVEL=info

# --- collector ---
POLL_INTERVAL_MS=60000
INFO_INTERVAL_MS=3600000
WEATHER_INTERVAL_MS=1800000
CITIES=                                          # optional comma-separated slug filter
HEALTHCHECKS_COLLECTOR_URL=                      # https://hc-ping.com/<uuid>  (optional)

# --- workers ---
HEALTHCHECKS_TRAINER_URL=                        # optional
PREDICT_INTERVAL_SEC=300
TRIPS_CACHE_DIR=/data/cache
GIT_SHA=                                         # injected by deploy (image label); optional
TZ=UTC                                           # worker-train overrides to America/Toronto in compose

# --- misc ---
NODE_ENV=production
TRUST_PROXY=1                                    # api: express 'trust proxy' hops (Caddy)
VITE_REPO_URL=https://github.com/<owner>/dockcast # web build-time: link to repo/docs from the UI
```
Never commit `.env`. All variables are validated at boot by each service (zod / Python checks); unknown variables are ignored.

---------------------------------------------------------------------------

## 6. GitHub Actions

### 6.1 `.github/workflows/ci.yml`
```yaml
name: ci
on:
  pull_request:
  push: { branches: [main] }
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }
jobs:
  node:
    runs-on: ubuntu-24.04
    services:
      db:
        image: timescale/timescaledb-ha:pg16
        env: { POSTGRES_DB: dockcast_test, POSTGRES_USER: postgres, POSTGRES_PASSWORD: dockcast }
        ports: ["5433:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres" --health-interval 5s --health-timeout 3s --health-retries 20
    env:
      DATABASE_URL_TEST: postgres://postgres:dockcast@localhost:5433/dockcast_test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r lint
      - run: pnpm -r typecheck
      - run: pnpm -r build
      - run: pnpm -r test            # vitest; DB tests run because DATABASE_URL_TEST is set
  python:
    runs-on: ubuntu-24.04
    services:
      db:
        image: timescale/timescaledb-ha:pg16
        env: { POSTGRES_DB: dockcast_test, POSTGRES_USER: postgres, POSTGRES_PASSWORD: dockcast }
        ports: ["5433:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres" --health-interval 5s --health-timeout 3s --health-retries 20
    env:
      DATABASE_URL_TEST: postgres://postgres:dockcast@localhost:5433/dockcast_test
    defaults: { run: { working-directory: ml } }
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
        with: { enable-cache: true }
      - run: uv python install 3.12
      - run: uv sync --frozen
      - run: uv run ruff check .
      - run: uv run pytest -q
```
Python DB tests apply `db/migrations/*.sql` themselves via a pytest fixture (psycopg, in order) against `DATABASE_URL_TEST`.

### 6.2 `.github/workflows/deploy.yml`
```yaml
name: deploy
on:
  workflow_run:
    workflows: [ci]
    branches: [main]
    types: [completed]
permissions: { contents: read, packages: write }
jobs:
  images:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-24.04
    strategy:
      matrix:
        include:
          - { name: api,       file: apps/api/Dockerfile }
          - { name: collector, file: apps/collector/Dockerfile }
          - { name: worker,    file: ml/Dockerfile }
    steps:
      - uses: actions/checkout@v4
        with: { ref: ${{ github.event.workflow_run.head_sha }} }
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with: { registry: ghcr.io, username: ${{ github.actor }}, password: ${{ secrets.GITHUB_TOKEN }} }
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: ${{ matrix.file }}
          push: true
          tags: |
            ghcr.io/${{ github.repository_owner }}/dockcast-${{ matrix.name }}:latest
            ghcr.io/${{ github.repository_owner }}/dockcast-${{ matrix.name }}:${{ github.event.workflow_run.head_sha }}
          cache-from: type=gha,scope=${{ matrix.name }}
          cache-to: type=gha,scope=${{ matrix.name }},mode=max
  rollout:
    needs: images
    runs-on: ubuntu-24.04
    steps:
      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            set -e
            cd /opt/dockcast
            docker compose pull
            docker compose up -d --remove-orphans
            docker image prune -f
            docker compose ps
```
Secrets: `VPS_HOST`, `VPS_USER` (`deploy`), `VPS_SSH_KEY` (ed25519 private key whose public key is in `/home/deploy/.ssh/authorized_keys`). GHCR packages should be set to **public** (portfolio; also lets the VPS pull without a token). If kept private: on the VPS run `docker login ghcr.io -u <owner> -p <PAT with read:packages>` once.

`infra/scripts/deploy.sh` = the same 5 lines as the `script:` block, for manual rollouts.

---------------------------------------------------------------------------

## 7. VPS bootstrap runbook (Ubuntu 24.04, Hetzner CX22 amd64 or DO 2 GB+)

1. Create the server (Ashburn/Toronto region), add your SSH key. DNS: `A DOMAIN → <VPS IP>` (proxy off if using Cloudflare until certs are issued; can enable after).
2. As root:
   ```bash
   apt-get update && apt-get -y upgrade
   adduser --disabled-password --gecos "" deploy && usermod -aG sudo deploy
   mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/ && chown -R deploy:deploy /home/deploy/.ssh
   ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable
   curl -fsSL https://get.docker.com | sh && usermod -aG docker deploy
   fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
   mkdir -p /opt/dockcast/supercronic /opt/dockcast/backups && chown -R deploy:deploy /opt/dockcast
   ```
   Disable password SSH login (`/etc/ssh/sshd_config.d/hardening.conf`: `PasswordAuthentication no`), `systemctl reload ssh`.
3. As `deploy`: copy `infra/docker-compose.yml`, `infra/Caddyfile`, `infra/supercronic/crontab`, `infra/scripts/*.sh` to `/opt/dockcast/` (keep the same relative layout: compose file at root, `Caddyfile`, `supercronic/crontab`, `scripts/`). Create `/opt/dockcast/.env` from `.env.example` with real values (`SESSION_SECRET`, VAPID keys, `POSTGRES_PASSWORD`, `DOMAIN`, healthchecks URLs). Replace `<owner>` in the compose file.
4. `cd /opt/dockcast && docker compose pull && docker compose up -d`. Watch: `docker compose logs -f api collector` until api logs `migrations applied` and collector logs its first `status_cycle` line.
5. Verify: `curl -s https://$DOMAIN/api/v1/health` → `{"ok":true,...}`; `docker compose exec db psql -U postgres -d dockcast -c "select count(*) from station_current"` → ~1058 after 2 min.
6. **Bootstrap Toronto rates** (once; ~10–20 min on CX22; downloads ~250 MB into the `workercache` volume, streams ~10 M trips, fetches Open-Meteo archive for the window, fits rates + weather GLM, builds neighbours):
   `docker compose run --rm worker-train python -m dockcast_ml bootstrap --city toronto`
   Then confirm: `select count(*) from station_flow_rates;` (≈ 1058 × 3 × 96) and `select * from weather_multipliers;` (20 rows). `worker-predict` will start writing `forecasts_latest` on its next 5-min tick.
7. Install the backup cron (§8) and create the healthchecks.io checks (§9).
8. Re-run `deploy.yml` (or `scripts/deploy.sh`) on every push to `main` thereafter.

---------------------------------------------------------------------------

## 8. Backups & restore

`infra/scripts/backup.sh` (host cron, `deploy` user, `30 4 * * * /opt/dockcast/scripts/backup.sh >> /opt/dockcast/backups/backup.log 2>&1`):
```bash
#!/usr/bin/env bash
set -euo pipefail
cd /opt/dockcast
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT=backups/dockcast-$STAMP.dump.gz
docker compose exec -T db pg_dump -U postgres -Fc dockcast | gzip -1 > "$OUT"
rclone copy "$OUT" "b2:dockcast-backups/"          # rclone remote configured once: `rclone config` (B2 or R2, S3-compatible)
rclone delete --min-age 14d "b2:dockcast-backups/"
find backups -name '*.dump.gz' -mtime +2 -delete    # keep 2 local
curl -fsS -m 10 --retry 3 "${HEALTHCHECKS_BACKUP_URL:-}" >/dev/null 2>&1 || true
echo "$STAMP ok $(du -h "$OUT" | cut -f1)"
```
`infra/scripts/restore.sh <file.dump.gz>` (TimescaleDB requires the pre/post restore hooks):
```bash
#!/usr/bin/env bash
set -euo pipefail
cd /opt/dockcast
docker compose stop api collector worker-predict worker-train
docker compose exec -T db psql -U postgres -c "DROP DATABASE IF EXISTS dockcast" -c "CREATE DATABASE dockcast"
docker compose exec -T db psql -U postgres -d dockcast -c "CREATE EXTENSION IF NOT EXISTS timescaledb; SELECT timescaledb_pre_restore();"
gunzip -c "$1" | docker compose exec -T db pg_restore -U postgres -d dockcast --no-owner
docker compose exec -T db psql -U postgres -d dockcast -c "SELECT timescaledb_post_restore();"
docker compose start api collector worker-predict worker-train
```
Log rotation: handled by the json-file driver options in compose (20 MB × 5 per container). Caddy access log rolls itself (§4).

---------------------------------------------------------------------------

## 9. Monitoring (minimal)
- healthchecks.io (free): `dockcast-collector` (period 1 min, grace 5 min; pinged after every all-cities-ok cycle), `dockcast-trainer` (period 1 day, grace 6 h; pinged at end of successful `train`), `dockcast-backup` (period 1 day, grace 3 h). Alerts to email.
- `GET /api/v1/health` (Caddy → api) can be added to any external uptime pinger.
- Ops commands: `docker compose ps`, `docker compose logs -f --tail 200 <svc>`, `docker compose exec db psql -U postgres -d dockcast`, `docker system df`.
- Public `/model` page shows collector uptime and last predictor/trainer runs — that's the product-facing monitor.

---------------------------------------------------------------------------

## 10. Cost & sizing
Hetzner CX22 ≈ €3.79/mo (+ €0.60 IPv4) or DO Basic 4 GB $24/mo; domain already owned; Let's Encrypt free; B2/R2 backups < $0.10/mo; healthchecks.io free; GHCR free for public images; GitHub Actions free tier sufficient (~10 min/CI run). Cost is flat in users; adding a city adds O(stations) rows/min and a few MB/day.

## 11. Definition of done
- [ ] `docker compose -f infra/docker-compose.yml config` validates; `docker compose -f infra/docker-compose.dev.yml up -d` gives a migratable db on 5432 and a test db on 5433.
- [ ] All three images build from a clean checkout in CI (`deploy.yml` images job) and run as non-root.
- [ ] Fresh VPS following §7 serves `https://DOMAIN/api/v1/health` with `ok:true` within 15 min of step 4.
- [ ] `ci.yml` green with DB tests executed (not skipped) in both jobs.
- [ ] `backup.sh` produces a restorable dump (test `restore.sh` once on the dev compose).
- [ ] healthchecks.io shows collector pings every minute.
