#!/usr/bin/env bash
# Sync the current git HEAD to the home server (Windows 11 + Docker Desktop, PowerShell over SSH),
# rebuild the images there and restart the stack. Data (named volumes) is preserved.
# Usage: infra/scripts/deploy-homeserver.sh [user@host] [remote dir]   (defaults: rdpadmin@100.69.154.58, C:\dockcast)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
HOST="${1:-rdpadmin@100.69.154.58}"; RDIR="${2:-C:\\dockcast}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git archive --format=tar.gz -o "$TMP/dockcast.tgz" HEAD
scp -q "$TMP/dockcast.tgz" "$HOST:C:/Users/rdpadmin/dockcast.tgz"
ssh "$HOST" "tar -xzf C:\\Users\\rdpadmin\\dockcast.tgz -C $RDIR; cd $RDIR; docker compose -p dockcast -f infra/docker-compose.yml build 2>&1 | Select-String -Pattern 'Built|ERROR|error:' | Select-Object -Last 6; docker compose -p dockcast -f infra/docker-compose.yml up -d 2>&1 | Select-Object -Last 3; docker compose -p dockcast -f infra/docker-compose.yml ps --format '{{.Name}} {{.Status}}'"
echo "health: $(curl -s -m 10 http://100.69.154.58:8088/api/v1/health)"
