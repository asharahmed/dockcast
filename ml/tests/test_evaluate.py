"""T15 (docs/ml-spec.md §8): perfect predictions -> Brier 0, ECE 0; constant 0.5 on
balanced synthetic -> Brier 0.25. Plus sanity checks on `metric_rows`'s shape.
"""

from __future__ import annotations

import numpy as np

from dockcast_ml.evaluate import Preds, brier, ece, metric_rows, reliability


def test_perfect_and_constant() -> None:
    y = np.array([0, 1, 0, 1, 1, 0, 1, 0, 1, 1], dtype=float)
    p_perfect = y.copy()
    assert brier(p_perfect, y) == 0.0
    assert ece(p_perfect, y) == 0.0

    y_balanced = np.array([0, 1] * 2000, dtype=float)
    p_const = np.full(len(y_balanced), 0.5)
    assert abs(brier(p_const, y_balanced) - 0.25) < 1e-9


def test_reliability_bins_sum_to_n() -> None:
    rng = np.random.default_rng(0)
    p = rng.uniform(0, 1, 500)
    y = (rng.uniform(0, 1, 500) < p).astype(float)
    bins = reliability(p, y)
    assert sum(n for _, n, _, _ in bins) == 500
    for b, _n, mean_pred, _frac_pos in bins:
        assert 0 <= b <= 9
        assert 0.0 <= mean_pred <= 1.0


def test_metric_rows_shape_and_rel_bins_only_at_horizon_zero() -> None:
    rng = np.random.default_rng(1)
    n = 400
    horizons = rng.choice([15, 30], size=n)
    p_bike = rng.uniform(0, 1, n)
    p_dock = rng.uniform(0, 1, n)
    y_bike = (rng.uniform(0, 1, n) < p_bike).astype(int)
    y_dock = (rng.uniform(0, 1, n) < p_dock).astype(int)
    y_cnt = rng.integers(0, 10, n).astype(float)
    bikes0 = rng.integers(0, 10, n).astype(float)
    docks0 = rng.integers(0, 10, n).astype(float)
    y_cnt_hat = y_cnt + rng.normal(0, 1, n)

    preds = Preds(p_bike=p_bike, p_dock=p_dock, y_cnt_hat=y_cnt_hat)
    rows = metric_rows("gbm_cand", preds, y_bike, y_dock, y_cnt, bikes0, docks0, horizons)

    by_horizon_metric = {(r["target"], r["horizon"], r["slice"], r["metric"]) for r in rows}
    # pooled (horizon 0) + both real horizons, both slices, core metrics present for bike
    for h in (0, 15, 30):
        for slice_name in ("all", "at_risk"):
            assert ("bike", h, slice_name, "brier") in by_horizon_metric
            assert ("cnt", h, slice_name, "mae") in by_horizon_metric

    rel_at_zero = [r for r in rows if r["metric"].startswith("rel_bin_") and r["horizon"] == 0]
    rel_at_nonzero = [r for r in rows if r["metric"].startswith("rel_bin_") and r["horizon"] != 0]
    assert rel_at_zero
    assert not rel_at_nonzero
