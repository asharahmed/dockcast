#!/usr/bin/env bash
# DockCast proving-period status: health, containers, data growth, forecasts, models, metrics.
# Usage: infra/scripts/status.sh [compose project] [env file]   (defaults: dockcast-smoke, infra/.env.local-smoke)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
PROJECT="${1:-dockcast-smoke}"; ENVF="${2:-.env.local-smoke}"
DC=(docker compose -p "$PROJECT" -f docker-compose.yml --env-file "$ENVF")
BASE="${PUBLIC_BASE_URL:-http://localhost}"
psql() { "${DC[@]}" exec -T db psql -U postgres -d dockcast -Atc "$1"; }

echo "== $(date '+%Y-%m-%d %H:%M %Z')  project=$PROJECT"
echo "-- health:"; curl -s "$BASE/api/v1/health" || echo "(api unreachable)"; echo
echo "-- containers:"; "${DC[@]}" ps --format '  {{.Name}}  {{.Status}}'
echo "-- collection:"
psql "select '  first snapshot: '||min(ts)||'   snapshots: '||count(*) from station_snapshots"
psql "select '  station_status polls last 24h: ok='||count(*) filter (where ok)||' fail='||count(*) filter (where not ok) from poll_log where feed='station_status' and polled_at > now()-interval '24 hours'"
psql "select '  last ok poll: '||max(last_ok_at) from feed_state where feed='station_status'"
echo "-- forecasting:"
psql "select '  forecasts_latest: '||string_agg(tier||'='||n, ', ') from (select tier, count(*) n from forecasts_latest group by tier order by tier) t"
psql "select '  forecast_history rows: '||count(*)||'   origins: '||count(distinct t0)||'   first: '||coalesce(min(t0)::text,'-') from forecast_history"
psql "select '  forecast_labels rows: '||count(*) from forecast_labels"
psql "select '  last predict run: '||coalesce(max(finished_at)::text,'-')||'  ok='||coalesce(bool_and(ok)::text,'-') from (select * from worker_runs where kind='predict' order by id desc limit 5) r"
echo "-- models:"
psql "select '  '||id||' '||tier||' '||status||' for '||trained_for_date||' created '||to_char(created_at,'MM-DD HH24:MI') from model_versions order by id"
psql "select '  last train run: '||coalesce(max(finished_at)::text,'-')||'  ok='||coalesce(bool_and(ok)::text,'-') from (select * from worker_runs where kind='train' order by id desc limit 1) r"
echo "-- online metrics (latest day, 7d window, pooled horizon, slice=all, brier):"
psql "select '  '||day||' '||tier||' '||target||' brier='||round(value::numeric,4)||' n='||n from model_metrics_daily where window_days=7 and horizon=0 and slice='all' and metric='brier' and day=(select max(day) from model_metrics_daily) order by target, tier" | sed 's/^$/  (none yet)/'
psql "select count(*) from model_metrics_daily" | awk '$1==0{print "  (none yet)"}'
