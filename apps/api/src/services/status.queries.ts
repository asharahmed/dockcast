/** Reads behind `GET /status` (`docs/api.md` §1). Returns raw rows; `status/compute.ts` sanitizes. */
import type { Pool } from '@dockcast/db';
import { many, maybeOne } from '@dockcast/db';
import type { TrainRunRow } from '../status/compute.js';

export const HISTORY_RUNS = 14;

interface RawRunRow {
  started_at: Date;
  finished_at: Date | null;
  ok: boolean | null;
  progress: unknown;
  gate_passed: boolean | null;
  val_brier_bike: string | number | null;
  val_brier_dock: string | number | null;
  gbm_status: TrainRunRow['gbm_status'];
}

const num = (v: string | number | null): number | null => {
  if (v === null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Newest first. The gbm `model_versions` row is joined on the run's `trained_for_date`. */
export async function getRecentTrainRuns(pool: Pool, limit = HISTORY_RUNS): Promise<TrainRunRow[]> {
  const rows = await many<RawRunRow>(
    pool,
    `SELECT wr.started_at, wr.finished_at, wr.ok, wr.summary->'progress' AS progress,
            (mv.gate->>'passed')::boolean AS gate_passed,
            mv.metrics_val->'brier'->>'bike' AS val_brier_bike,
            mv.metrics_val->'brier'->>'dock' AS val_brier_dock,
            mv.status AS gbm_status
     FROM worker_runs wr
     LEFT JOIN model_versions mv
       ON mv.city_id = wr.city_id AND mv.tier = 'gbm'
      AND mv.trained_for_date = CASE WHEN wr.summary->>'trained_for_date' ~ '^\\d{4}-\\d{2}-\\d{2}$'
                                     THEN (wr.summary->>'trained_for_date')::date END
     WHERE wr.kind = 'train'
     ORDER BY wr.started_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    ...r,
    val_brier_bike: num(r.val_brier_bike),
    val_brier_dock: num(r.val_brier_dock),
  }));
}

/** The most recent successful train run that recorded phase timestamps (percent/ETA reference). */
export async function getReferenceTrainRun(
  pool: Pool,
): Promise<{ started_at: Date; finished_at: Date | null; progress: unknown } | null> {
  return maybeOne(
    pool,
    `SELECT started_at, finished_at, summary->'progress' AS progress
     FROM worker_runs
     WHERE kind = 'train' AND ok AND finished_at IS NOT NULL AND summary->'progress'->'phases' IS NOT NULL
     ORDER BY started_at DESC LIMIT 1`,
  );
}

export async function getLastPredictRun(
  pool: Pool,
): Promise<{ finished_at: Date; ok: boolean | null } | null> {
  return maybeOne(
    pool,
    `SELECT finished_at, ok FROM worker_runs
     WHERE kind = 'predict' AND finished_at IS NOT NULL
     ORDER BY finished_at DESC LIMIT 1`,
  );
}
