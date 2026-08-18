#!/usr/bin/env bash
# `docs/infra.md` §8. Usage: infra/scripts/restore.sh <file.dump.gz>
# TimescaleDB requires the pre/post restore hooks.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
docker compose stop api collector worker-predict worker-train
docker compose exec -T db psql -U postgres -c "DROP DATABASE IF EXISTS dockcast" -c "CREATE DATABASE dockcast"
docker compose exec -T db psql -U postgres -d dockcast -c "CREATE EXTENSION IF NOT EXISTS timescaledb; SELECT timescaledb_pre_restore();"
gunzip -c "$1" | docker compose exec -T db pg_restore -U postgres -d dockcast --no-owner
docker compose exec -T db psql -U postgres -d dockcast -c "SELECT timescaledb_post_restore();"
docker compose start api collector worker-predict worker-train
