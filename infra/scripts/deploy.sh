#!/usr/bin/env bash
# `docs/infra.md` §6.2 — the same steps `.github/workflows/deploy.yml`'s
# `rollout` job runs over SSH, for manual rollouts from the VPS itself.
set -e
cd "$(dirname "${BASH_SOURCE[0]}")/.."
docker compose pull
docker compose up -d --remove-orphans
docker image prune -f
docker compose ps
