# `docs/infra.md` §3.1. Build context = repo root:
#   docker build -f apps/api/Dockerfile .
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
# `apps/api/src/config.ts` calls its `repoRoot()` helper unconditionally (even
# when WEB_DIST_DIR and MIGRATIONS_DIR are both set via env, which the prod
# compose always does) — it walks up from the running file looking for
# `pnpm-workspace.yaml` and throws if it's never found. `pnpm deploy --prod`
# does not carry that file into the pruned output, so without this line the
# container would crash at boot in production. See the WP-11 final report.
COPY --from=build --chown=app:app /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
USER app
EXPOSE 3000
CMD ["node", "dist/index.js"]
