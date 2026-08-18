-- model_eval: add `tier` to the key. Baseline tiers (persistence, bd_raw, bd_cal) are evaluated on the
-- same validation rows as a candidate and are stored against the run's `bd` model version, so a
-- version can hold several tiers' rows for the same (split, target, horizon, slice, metric).
-- tier values: 'gbm' (a gbm version's own rows), 'bd_raw', 'bd_cal', 'persistence'.
ALTER TABLE model_eval ADD COLUMN tier text NOT NULL DEFAULT 'gbm';
ALTER TABLE model_eval DROP CONSTRAINT model_eval_pkey;
ALTER TABLE model_eval ADD PRIMARY KEY (model_version_id, tier, split, target, horizon, slice, metric);
