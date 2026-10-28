/**
 * Server-only. The trainer's internal phase markers (`ml/dockcast_ml/train.py`, `log_memory`) and the
 * mapping onto the four generic stage labels the public page shows. This file must not be imported
 * by `@dockcast/shared` or the web app: the phase names stay out of the client bundle.
 */
import type { StatusStage } from '@dockcast/shared';

/** Internal phases in execution order; each marker means "this phase just finished". */
export const TRAIN_PHASES = [
  'labels',
  'serving_profile',
  'bd_calibration',
  'train_profile',
  'row_counts',
  'feature_build',
  'feature_matrices',
  'calibration',
  'val_scoring',
  'release',
  'metrics_online',
] as const;
export type TrainPhase = (typeof TRAIN_PHASES)[number];

/** Stage label for the phase being worked on. */
export const STAGE_OF_PHASE: Record<TrainPhase, StatusStage> = {
  labels: 'preparing data',
  serving_profile: 'preparing data',
  bd_calibration: 'preparing data',
  train_profile: 'preparing data',
  row_counts: 'preparing data',
  feature_build: 'preparing data',
  feature_matrices: 'training',
  calibration: 'training',
  val_scoring: 'evaluating',
  release: 'evaluating',
  metrics_online: 'publishing',
};

/** After the last marker the trainer is wrapping up. */
export const FINAL_STAGE: StatusStage = 'publishing';
