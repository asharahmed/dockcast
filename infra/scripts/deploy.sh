#!/usr/bin/env bash
# `docs/infra.md` §6.2 — the same steps `.github/workflows/deploy.yml`'s
# `rollout` job runs over SSH, for manual rollouts from the host itself.
# Layout: the repo is cloned at /opt/dockcast and compose runs from its infra/ directory.
set -e
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if git -C .. rev-parse --git-dir >/dev/null 2>&1; then git -C .. pull --ff-only; fi
docker compose pull
docker compose up -d --remove-orphans
docker image prune -f
docker compose ps
