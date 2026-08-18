# `docs/infra.md` §3.2 (identical to `apps/api/Dockerfile` minus the web bundle
# and the api-only `pnpm-workspace.yaml` workaround — collector's config.ts
# does not walk up looking for the repo root). Build context = repo root:
#   docker build -f apps/collector/Dockerfile .
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
RUN pnpm -r --filter @dockcast/shared --filter @dockcast/db --filter @dockcast/collector build
RUN pnpm --filter @dockcast/collector --prod deploy /out/collector

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN groupadd -r app && useradd -r -g app -d /app app
WORKDIR /app
COPY --from=build --chown=app:app /out/collector ./
COPY --from=build --chown=app:app /repo/db/migrations ./db/migrations
USER app
CMD ["node", "dist/index.js"]
