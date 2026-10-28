#!/usr/bin/env bash
# DockCast rollout on a Linux home server (Docker Engine); docs/infra.md §16.
# Bash twin of rollout-homeserver.ps1. Run by deploy.yml over ssh after every green push to main
# when the repo variable HOMESERVER_OS=linux, or by hand:
#   bash rollout-homeserver.sh --sha <commit> [--repo owner/name] [--dir /srv/dockcast]
#                              [--project dockcast] [--health-url http://localhost:8088/api/v1/health]
# Fetches the repo tarball for that commit, refreshes the directory (compose file, Caddyfile,
# crontab, scripts; infra/.env is untouched), pulls the published images and restarts the stack,
# then waits for the api container to report healthy. Named volumes are preserved.
# The directory defaults to $DOCKCAST_HOMESERVER_DIR, else /srv/dockcast, and must be writable by the
# ssh user, who must be able to run docker (docker group).
set -euo pipefail

SHA=""
REPO="asharahmed/dockcast"
DIR="${DOCKCAST_HOMESERVER_DIR:-/srv/dockcast}"
PROJECT="dockcast"
HEALTH_URL="http://localhost:8088/api/v1/health"

usage() { echo "usage: $0 --sha <commit> [--repo owner/name] [--dir path] [--project name] [--health-url url]" >&2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --sha) SHA="${2:?--sha needs a value}"; shift 2 ;;
    --repo) REPO="${2:?--repo needs a value}"; shift 2 ;;
    --dir) DIR="${2:?--dir needs a value}"; shift 2 ;;
    --project) PROJECT="${2:?--project needs a value}"; shift 2 ;;
    --health-url) HEALTH_URL="${2:?--health-url needs a value}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done
if [ -z "$SHA" ]; then usage; exit 2; fi

# Run a command, print only its last $TAIL lines on success and the last 20 on failure.
run() {
  local label="$1" tail_n="$2"; shift 2
  local out rc=0
  echo "== $label"
  out=$("$@" 2>&1) || rc=$?
  if [ "$rc" -ne 0 ]; then
    printf '%s\n' "$out" | tail -n 20
    echo "$label failed (exit $rc)" >&2
    exit 1
  fi
  printf '%s\n' "$out" | tail -n "$tail_n"
}

tgz="$(mktemp "${TMPDIR:-/tmp}/dockcast-XXXXXX.tgz")"
trap 'rm -f "$tgz"' EXIT
run "fetch $REPO@$SHA" 2 curl -fsSL -o "$tgz" "https://github.com/$REPO/archive/$SHA.tar.gz"
mkdir -p "$DIR"
run "extract to $DIR" 2 tar -xzf "$tgz" -C "$DIR" --strip-components=1
cd "$DIR"

# group_add in docker-compose.yml needs the gid that owns docker.sock (root:docker on Linux).
# An explicit DOCKER_SOCK_GID in the shell or in infra/.env wins.
if [ -z "${DOCKER_SOCK_GID:-}" ] && ! grep -qs '^DOCKER_SOCK_GID=' infra/.env; then
  DOCKER_SOCK_GID="$(stat -c %g /var/run/docker.sock 2>/dev/null || echo 0)"
  export DOCKER_SOCK_GID
  echo "DOCKER_SOCK_GID=$DOCKER_SOCK_GID (from /var/run/docker.sock)"
fi

dc=(docker compose -p "$PROJECT" -f infra/docker-compose.yml)
run "pull images" 6 "${dc[@]}" pull
run "restart stack" 8 "${dc[@]}" up -d --remove-orphans
docker image prune -f >/dev/null 2>&1 || true
run "containers" 12 "${dc[@]}" ps --format '{{.Name}} {{.Status}}'

echo "== health"
status=""
deadline=$((SECONDS + 120))
while :; do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$PROJECT-api-1" 2>&1 || true)"
  if [ "$status" = "healthy" ]; then
    body="$(curl -s -m 10 "$HEALTH_URL" 2>&1 || true)"
    echo "api healthy; $HEALTH_URL -> $body"
    exit 0
  fi
  [ "$SECONDS" -lt "$deadline" ] || break
  sleep 5
done
echo "api container not healthy within 120 s (last status: $status)" >&2
exit 1
