#!/usr/bin/env bash
# `docs/infra.md` §8. Host cron (`deploy` user):
#   30 4 * * * /opt/dockcast/scripts/backup.sh >> /opt/dockcast/backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# Host cron runs with a minimal environment, so pull HEALTHCHECKS_BACKUP_URL
# (not read by any compose service, only by this script) from `.env`
# alongside the other secrets already deployed there. Adaptation over
# `docs/infra.md` §8's literal script, which references the var without
# saying where it comes from (see WP-11 final report); .env.example
# documents it.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT=backups/dockcast-$STAMP.dump.gz
docker compose exec -T db pg_dump -U postgres -Fc dockcast | gzip -1 > "$OUT"
rclone copy "$OUT" "b2:dockcast-backups/"          # rclone remote configured once: `rclone config` (B2 or R2, S3-compatible)
rclone delete --min-age 14d "b2:dockcast-backups/"
find backups -name '*.dump.gz' -mtime +2 -delete    # keep 2 local
curl -fsS -m 10 --retry 3 "${HEALTHCHECKS_BACKUP_URL:-}" >/dev/null 2>&1 || true
echo "$STAMP ok $(du -h "$OUT" | cut -f1)"
