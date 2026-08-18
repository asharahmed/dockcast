# `docs/infra.md` §3.3. Build context = repo root:
#   docker build -f ml/Dockerfile .
# syntax=docker/dockerfile:1.7
FROM python:3.12-slim-bookworm AS base
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 tzdata ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
# supercronic (cron for containers)
ARG SUPERCRONIC_VERSION=v0.2.33
# upstream publishes no checksum file for this release; computed by hand from
# the actual v0.2.33 asset and pinned here (see WP-11 final report).
ARG SUPERCRONIC_SHA256=feefa310da569c81b99e1027b86b27b51e6ee9ab647747b49099645120cfc671
RUN curl -fsSL -o /usr/local/bin/supercronic \
      https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-amd64 \
 && echo "${SUPERCRONIC_SHA256}  /usr/local/bin/supercronic" | sha256sum -c - \
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
