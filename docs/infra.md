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
      TRAIN_MEM_STEP: ${TRAIN_MEM_STEP:-2g}         # train-with-retry.sh, see §3.4
      TRAIN_MEM_MAX: ${TRAIN_MEM_MAX:-8g}
      TRAIN_MEM_STATE_FILE: /data/cache/train_mem_limit
    group_add: ["${DOCKER_SOCK_GID:-0}"]            # docker.sock group (0 on Docker Desktop, `docker` gid on Linux)
    volumes:
      - ./supercronic/crontab:/app/crontab:ro
      - workercache:/data/cache                     # downloaded trip zips (bootstrap), ~250 MB
      - /var/run/docker.sock:/var/run/docker.sock   # lets train-with-retry.sh raise its own mem_limit
    depends_on:
      db: { condition: service_healthy }
      api: { condition: service_started }
    mem_limit: ${TRAIN_MEM_LIMIT:-6g}               # start point; train-with-retry.sh raises it on OOM

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
- `collector`, `worker-predict`, `worker-train` (and every `python -m dockcast_ml <cmd>`) call `waitForSchema` (Node) / `wait_for_schema` (Python) at boot: retry every 5 s for up to 5 min until every file in `MIGRATIONS_DIR` is present in `schema_migrations`; then proceed; after 5 min → log and exit 1 (compose restarts it). Images therefore COPY `db/migrations` to `/app/db/migrations`.
- Manual: `docker compose run --rm api node dist/migrate.js` (api image ships a `migrate.js` entry that runs migrations and exits).

### 1.2 Sizing (Hetzner CX22: 2 vCPU / 4 GB / 40 GB)
db 1.5 GB, worker-train 6 GB start / 8 GB cap (only during the nightly run; otherwise idle at ~60 MB under supercronic; the 2 GB budget in the original plan was OOM-killed once real history accumulated -- see §3.4), api 0.5 GB, collector 0.25 GB, worker-predict 0.75 GB, caddy tiny. On a 4 GB VPS set `TRAIN_MEM_LIMIT`/`TRAIN_MEM_MAX` lower and expect the trainer to need swap (runbook §7's 2 GB swapfile).
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
30 3 * * * /app/scripts/train-with-retry.sh train --city toronto
# Optional: rebuild tod profile only (cheap) at 12:30 to keep "typical" fresh (train also does it)
30 12 * * * python -m dockcast_ml profile --city toronto
```
DST: because supercronic uses the container's local time, `03:30 America/Toronto` is correct year-round; on the spring-forward night (no 02:xx) 03:30 still exists, on fall-back it runs once.

**OOM self-healing** (`ml/scripts/train-with-retry.sh`, added 2026-09-01 after four of five nightly runs on
the home server died with exit 137 at the old 2 GiB limit). The wrapper runs `python -m dockcast_ml train`
and:
- on exit 137 with a new `oom_kill` in the container's `memory.events`, raises the container's own memory
  limit by `TRAIN_MEM_STEP` (default 2g, never above `TRAIN_MEM_MAX`, default 8g) with
  `POST /containers/<self>/update` on the mounted docker socket, then re-runs (the trainer is idempotent
  per local date). Exit 137 without an OOM event (e.g. `docker kill`) and any other non-zero exit are not
  retried;
- persists the raised limit to `/data/cache/train_mem_limit` (workercache volume) and re-applies it at
  the start of every run, so `compose up -d` recreating the container at the compose `mem_limit` does not
  undo it;
- after a successful run, if the peak anonymous memory (`anon` in `memory.stat`, sampled every 2 s;
  `memory.peak` is not used for this because it includes reclaimable page cache and sits at the limit
  after any file I/O) was >= `TRAIN_MEM_HEADROOM_PCT` (default 80) of the limit, raises the limit now so
  the next night has headroom;
- logs one line per attempt with the limit and the peaks, e.g. `ok: peak anon 2874 MiB = 46% of the
  6144 MiB limit (cgroup peak incl. cache 6144 MiB)`.

First real exercise (2026-09-01, one-off `compose run` pinned to `TRAIN_MEM_LIMIT=2g`): attempt 1 was
OOM-killed after 4m50s, the wrapper raised the limit to 4 GiB, attempt 2 completed in 3m12s.

Pick `TRAIN_MEM_MAX` so that it fits next to everything else on the host: on the home server the Docker VM
has 13.65 GiB and the other containers use ~7 GiB, hence 8g. If the trainer ever needs more, give the VM
more memory (`.wslconfig`) rather than raising the cap. The socket mount hands the container control of
the Docker daemon; it is only needed for this one call, so on a shared host route it through a
socket proxy that allows `POST /containers/*/update` only. Tests: `ml/tests/test_train_with_retry.py`
(fake cgroup dir + fake Engine API on a unix socket).

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
CLOUDFLARE_API_TOKEN=                           # Zone->DNS->Edit token for the domain's zone; enables
                                                # ACME DNS-01 in Caddy (works on hosts nothing external
                                                # can reach, e.g. Tailscale-only). Empty = http-only.
GOOGLE_CLIENT_ID=                               # optional; both set -> "Continue with Google" appears.
APPLE_SERVICES_ID=                              # optional; all four set -> "Continue with Apple".
APPLE_TEAM_ID=                                  # developer.apple.com (paid account): Services ID with
APPLE_KEY_ID=                                   # Sign in with Apple, domain verified, return URL
APPLE_PRIVATE_KEY=                              # ${PUBLIC_BASE_URL}/api/v1/auth/apple/callback; .p8 key
                                                # contents with literal \n for newlines
GOOGLE_CLIENT_SECRET=                           # Google Cloud console -> APIs & Services -> Credentials ->
                                                # OAuth client (Web application); authorized redirect URI:
                                                # ${PUBLIC_BASE_URL}/api/v1/auth/google/callback
                                                # (https required except localhost -> unusable on the
                                                # Tailscale-IP proving deploy; works on localhost + prod TLS)

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

---------------------------------------------------------------------------

## 12. Reconciliation notes (post-WP-11, 2026-08-18)

The committed files under `infra/`, `apps/*/Dockerfile`, `ml/Dockerfile`, `.github/workflows/deploy.yml`
and `.env.example` are canonical where they differ from the listings above. Differences found by
building and smoke-testing the real stack:
- `Caddyfile`: the `log { output file … }` sub-block must be multi-line (one option per line).
- `deploy.yml`: `${{ … }}` expressions inside flow mappings must be quoted.
- `worker-train`: `supercronic -no-reap -passthrough-logs …` (PID-1 reaping crash-loop seen on the OrbStack/arm64 build host).
- `worker-predict`/`worker-train`: `depends_on: api: condition: service_healthy` (the Python workers rely on the
  api having run migrations; the collector keeps `service_started` because it has its own `waitForSchema` loop).
- New env keys: `SITE_ADDRESS` (Caddy site address; `http://localhost` for local smoke, defaults to `DOMAIN`),
  `GHCR_OWNER`, `IMAGE_TAG`, `ENV_FILE`, `HEALTHCHECKS_BACKUP_URL`; images are
  `ghcr.io/${GHCR_OWNER:-local}/dockcast-{api,collector,worker}:${IMAGE_TAG:-latest}` and compose services
  carry `build:` contexts so `docker compose -f infra/docker-compose.yml build` works locally.
- Image sizes (arm64 local build): api 407 MB, collector 385 MB, worker 1.52 GB (§10's estimate was low).
- Local full-stack smoke: `docker compose -p dockcast-smoke -f infra/docker-compose.yml --env-file infra/.env.local-smoke up -d`
  (env file gitignored; `down -v` to clean up). Never run it against the `dockcast-dev` compose project's ports.
- Code follow-ups made after WP-11: `apps/api/src/config.ts` only resolves the repo root when a path needs
  defaulting; `dockcast_ml/logging_setup.py` upper-cases `LOG_LEVEL` (pending WP-6 commit).

## 13. Home-server deployment (proving period, from 2026-08-19)

The stack runs on the user's Windows 11 home server (12 cores / 32 GB, Docker Desktop with the Linux
engine, reachable over Tailscale at `<tailscale-ip>`), compose project `dockcast`, repo at `C:\dockcast`,
env at `C:\dockcast\infra\.env`. Because the host already runs a homelab Caddy on 80/443, DockCast's Caddy
publishes on **8088** (`CADDY_HTTP_PORT=8088`, `SITE_ADDRESS=:80`, `PUBLIC_BASE_URL=http://<tailscale-ip>:8088`).
URL: http://<tailscale-ip>:8088 (Tailscale only, plain HTTP).
- Redeploy after commits: `infra/scripts/deploy-homeserver.sh` (git archive → scp → build on the server → up -d).
- Status: `ssh <user>@<tailscale-ip> "cd C:\dockcast; docker compose -p dockcast -f infra/docker-compose.yml ps"`
  and the API/`/model` page; the bash `status.sh` needs a POSIX shell (run its psql lines via `docker compose exec` manually).
- Caveat: Docker Desktop (WSL2) only starts after a Windows sign-in; enable auto sign-in for unattended reboots.
- Trip-history bootstrap on the server used the full window 2025-04 → 2026-03 (8.36M trips).
- 2026-09-01 incident: every 15-min `forecast_history` write had failed since 2026-08-27 (`model_version_id`
  upcast to float by pandas once bd_cal rows existed; fixed in `predict.py`), and the nightly trainer was
  OOM-killed at 2 GiB on 4 of 5 nights. Trainer now starts at 6 GiB with the §3.4 self-healing wrapper.
  Trainer logs: `docker logs --since 48h dockcast-worker-train-1` (from PowerShell wrap in `cmd /c "... 2>&1"`).

## 14. Public access through Cloudflare Tunnel (home server)

The home server sits behind NAT on a residential connection whose IP changes, and the domain's
A record pointed at its Tailscale address, so `https://dockcast.aahmed.ca` only worked from inside
the tailnet. A Cloudflare Tunnel makes the site public with nothing to maintain: the `cloudflared`
container (compose profile `tunnel`) opens an outbound connection to Cloudflare's edge and simply
reconnects after an IP change, there is no router port-forward and no DDNS, and the public DNS
record is a CNAME to the tunnel, so the home IP never appears anywhere.

One script does the whole setup from a laptop. First create an API token at
dash.cloudflare.com/profile/api-tokens ("Create Custom Token") with three permissions:
**Account · Cloudflare Tunnel · Edit**, **Zone · Zone · Read**, **Zone · DNS · Edit** (zone
resources: the domain's zone). Then:

```sh
CLOUDFLARE_API_TOKEN=<that token> DOCKCAST_HOMESERVER=<user>@<tailscale-ip> \
  infra/scripts/tunnel-setup.sh dockcast.aahmed.ca
```

It creates (or reuses) a remotely managed tunnel named `dockcast`, sets its ingress to
`dockcast.aahmed.ca → http://api:3000`, replaces the hostname's A record with a proxied CNAME to
`<tunnel-id>.cfargotunnel.com`, writes `COMPOSE_PROFILES=tunnel` and `CLOUDFLARE_TUNNEL_TOKEN`
into `C:\dockcast\infra\.env` over ssh (rewriting the file LF-only), and runs
`deploy-homeserver.sh`. Every step is idempotent, so re-running after a failure is fine. Without
`DOCKCAST_HOMESERVER` it stops after the Cloudflare side and prints the two lines to add by hand.
The API token is used only by the script; the tunnel's own run token is what lands in `.env`.

Why `api:3000` and not `caddy:80`: it keeps `cloudflared` as the api's only proxy hop, so
`TRUST_PROXY=1` still yields real client IPs for rate limiting, and `req.secure` follows the
`X-Forwarded-Proto: https` the edge sends (secure session cookies, HSTS). `PUBLIC_BASE_URL`
stays `https://dockcast.aahmed.ca`, so OAuth callbacks are unchanged. The Caddy DNS-01
certificate and the plain-http Tailscale path on 8088 keep working for ops; public traffic no
longer touches Caddy.

Verify from a network that is **not** on the tailnet: `curl -s https://dockcast.aahmed.ca/api/v1/health`,
and `dig +short dockcast.aahmed.ca` returns Cloudflare addresses (104.x / 172.67.x), never the home IP.
`docker compose ps` shows `cloudflared` up with "Registered tunnel connection" in its logs.

Optional edge settings under SSL/TLS: **Always Use HTTPS** and **HSTS**. The SSL mode is
irrelevant for tunnelled hostnames. Outbound from the host: UDP 7844 (QUIC) or TCP 443 to Cloudflare.

## 15. One-shot install on a VPS (the easy path)

The whole of §7 collapses to one script. On any fresh Ubuntu 24.04 host with 8 GB RAM
(Hetzner CX33-class, about €8/month), as root:

```sh
DOMAIN=dockcast.example.com CLOUDFLARE_API_TOKEN=... VAPID_SUBJECT=mailto:you@example.com \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/asharahmed/dockcast/main/infra/scripts/install.sh)"
```

Or skip logging in entirely: paste `infra/cloud-init.yaml` (with its three values edited) as the
server's user data when creating it. Either way the host ends up with the repo cloned at
`/opt/dockcast`, a generated `infra/.env` (random Postgres password and session secret, fresh
VAPID keys, `GHCR_OWNER=asharahmed` so every image, caddy included, is pulled rather than built),
the stack running, and the Toronto bootstrap running in the background with its log at
`/opt/dockcast/bootstrap.log`. Point an A record for `DOMAIN` at the host, DNS-only (grey cloud):
the Caddyfile issues the certificate through Cloudflare DNS-01, so no inbound port is needed for
issuance, and a proxied record would put Cloudflare's addresses in front of the api's single
trusted proxy hop. Re-running the script is safe; it fast-forwards the checkout and keeps `.env`.

Afterwards, `infra/scripts/deploy.sh` on the host (git pull, pull images, restart) is the manual
update, and adding `VPS_HOST`, `VPS_USER` and `VPS_SSH_KEY` as repository secrets makes
`deploy.yml` do the same on every green push to `main`. The trainer starts at 4 GB and self-heals
up to 6 GB on this size of host (`TRAIN_MEM_*` in the generated `.env`).

Untested on a live VPS as of 2026-10-12: the script's env generation and idempotence were
exercised in a dry run; the Docker install, pull, `up --wait` and bootstrap steps were not.

## 16. Push-to-deploy for the home server (GitHub Actions over Tailscale)

`deploy.yml` builds and pushes the four images on every green `main` build, then runs a rollout
job chosen by the repository variable `DEPLOY_TARGET`: `vps` (ssh to `/opt/dockcast`, §15) or
`homeserver`. With the variable unset both rollout jobs are skipped and the workflow still passes.

The `homeserver` rollout joins the tailnet as an ephemeral `tag:ci` node, copies
`infra/scripts/rollout-homeserver.ps1` to the server and runs it: the script downloads that
commit's tarball from GitHub, refreshes `C:\dockcast` (compose file, Caddyfile, crontab, scripts;
`infra\.env` is untouched), `docker compose pull`s the images just pushed and restarts the stack,
then waits for the api to report healthy. Data volumes are preserved. The server's `.env` has
`GHCR_OWNER=asharahmed` so pulls resolve to the published images; `deploy-homeserver.sh` (build
on the server) still works for ad-hoc deploys.

In place since 2026-10-13 (first automated rollout: deploy run 38340838153, attempt 2):

- Server: a dedicated ed25519 deploy key (comment `dockcast-deploy@github-actions`) in
  `C:\ProgramData\ssh\administrators_authorized_keys` (admins' keys are read from there, not
  from `~/.ssh`), and `GHCR_OWNER=asharahmed` in `infra\.env`.
- Tailscale: tag `tag:ci` (owner `autogroup:admin`) and the grant
  `{"src": ["tag:ci"], "dst": ["asharpc"], "ip": ["tcp:22"]}` in the policy's `grants` (the policy is
  default-deny; the runner is an ephemeral Linux node, so no posture condition). An OAuth client
  under Settings → **Trust credentials** (the page formerly called OAuth clients) with scope
  Auth Keys · Write and tag `tag:ci`.
- Repository: secrets `HOMESERVER_SSH_KEY`, `HOMESERVER_HOST`, `HOMESERVER_USER`,
  `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`; variable `DEPLOY_TARGET=homeserver`.

To recreate any of it:

```sh
ssh-keygen -t ed25519 -N '' -C dockcast-deploy@github-actions -f ~/.ssh/dockcast-deploy
ssh <user>@<server> "Add-Content -Path C:\ProgramData\ssh\administrators_authorized_keys -Value '$(cat ~/.ssh/dockcast-deploy.pub)'"
gh secret set HOMESERVER_SSH_KEY < ~/.ssh/dockcast-deploy
gh secret set HOMESERVER_HOST --body <server tailscale ip>
gh secret set HOMESERVER_USER --body <user>
gh secret set TS_OAUTH_CLIENT_ID   # from the trust credential
gh secret set TS_OAUTH_SECRET
gh variable set DEPLOY_TARGET --body homeserver
```

From then on every green push to `main` is live on the home server a few minutes later. The
ephemeral runner node is removed from the tailnet when the job ends.
