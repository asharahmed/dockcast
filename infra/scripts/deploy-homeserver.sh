#!/usr/bin/env bash
# Sync the current git HEAD to a home server (Windows 11 + Docker Desktop with PowerShell over SSH,
# or Linux + Docker Engine when DOCKCAST_HOMESERVER_OS=linux), rebuild the images there and restart
# the stack. Data (named volumes) is preserved.
# Usage: infra/scripts/deploy-homeserver.sh [user@host] [remote dir]
#   Defaults: DOCKCAST_HOMESERVER (user@host, required) and DOCKCAST_HOMESERVER_DIR (default C:\dockcast,
#   or /srv/dockcast with DOCKCAST_HOMESERVER_OS=linux).
#   DOCKCAST_HOMESERVER_PORT (default 8088) is the published Caddy HTTP port used for the health check.
# shellcheck disable=SC2029  # the remote command is meant to expand dir/user on this side
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
HOSTOS="${DOCKCAST_HOMESERVER_OS:-windows}"
if [[ "$HOSTOS" == linux ]]; then DEFDIR=/srv/dockcast; else DEFDIR='C:\dockcast'; fi
HOST="${1:-${DOCKCAST_HOMESERVER:-}}"; RDIR="${2:-${DOCKCAST_HOMESERVER_DIR:-$DEFDIR}}"
if [[ -z "$HOST" ]]; then
  echo "usage: $0 user@host [remote dir]   (or export DOCKCAST_HOMESERVER=user@host)" >&2
  exit 2
fi
RUSER="${HOST%%@*}"; RHOST="${HOST#*@}"; RPORT="${DOCKCAST_HOMESERVER_PORT:-8088}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git archive --format=tar.gz -o "$TMP/dockcast.tgz" HEAD
if [[ "$HOSTOS" == linux ]]; then
  scp -q "$TMP/dockcast.tgz" "$HOST:dockcast.tgz"
  ssh "$HOST" "set -e; mkdir -p '$RDIR'; tar -xzf dockcast.tgz -C '$RDIR'; rm dockcast.tgz; cd '$RDIR'
    if [ -z \"\${DOCKER_SOCK_GID:-}\" ] && ! grep -qs '^DOCKER_SOCK_GID=' infra/.env; then
      export DOCKER_SOCK_GID=\$(stat -c %g /var/run/docker.sock)
    fi
    dc='docker compose -p dockcast -f infra/docker-compose.yml'
    \$dc build 2>&1 | grep -E 'Built|ERROR|error:' | tail -n 6 || true
    \$dc up -d 2>&1 | tail -n 3
    \$dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile 2>&1 | tail -n 1
    \$dc ps --format '{{.Name}} {{.Status}}'"
else
  scp -q "$TMP/dockcast.tgz" "$HOST:C:/Users/$RUSER/dockcast.tgz"
  ssh "$HOST" "tar -xzf C:\\Users\\$RUSER\\dockcast.tgz -C $RDIR; cd $RDIR; docker compose -p dockcast -f infra/docker-compose.yml build 2>&1 | Select-String -Pattern 'Built|ERROR|error:' | Select-Object -Last 6; docker compose -p dockcast -f infra/docker-compose.yml up -d 2>&1 | Select-Object -Last 3; docker compose -p dockcast -f infra/docker-compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile 2>&1 | Select-Object -Last 1; docker compose -p dockcast -f infra/docker-compose.yml ps --format '{{.Name}} {{.Status}}'"
fi
echo "health: $(curl -s -m 10 "http://$RHOST:$RPORT/api/v1/health")"
