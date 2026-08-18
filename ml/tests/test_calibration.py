"""T16 (docs/ml-spec.md §8): isotonic calibrator output is monotone in `p` and clipped for
out-of-range inputs.
"""

from __future__ import annotations

import numpy as np

from dockcast_ml.models.calibration import apply_calibrators, fit_calibrators


def test_isotonic_monotone_clip() -> None:
    rng = np.random.default_rng(0)
    n = 5000
    p = rng.uniform(0, 1, n)
    y = (rng.uniform(0, 1, n) < p**2).astype(int)
    horizons = np.full(n, 15)

    cal = fit_calibrators(p, y, horizons, min_rows=100)
    assert 15 in cal

    grid = np.linspace(0, 1, 101)
    out = apply_calibrators(cal, grid, np.full(101, 15))
    assert np.all(np.diff(out) >= -1e-12), "calibrated output must be non-decreasing in p"
    assert out.min() >= 0.0
    assert out.max() <= 1.0

    below = apply_calibrators(cal, np.array([-0.5]), np.array([15]))
    at_zero = apply_calibrators(cal, np.array([0.0]), np.array([15]))
    above = apply_calibrators(cal, np.array([1.5]), np.array([15]))
    at_one = apply_calibrators(cal, np.array([1.0]), np.array([15]))
    assert below[0] == at_zero[0]
    assert above[0] == at_one[0]


def test_missing_horizon_falls_back_to_clipped_identity() -> None:
    rng = np.random.default_rng(1)
    n = 5000
    p = rng.uniform(0, 1, n)
    y = (rng.uniform(0, 1, n) < p).astype(int)
    horizons = np.full(n, 15)
    cal = fit_calibrators(p, y, horizons, min_rows=100)

    out = apply_calibrators(cal, np.array([-1.0, 0.3, 2.0]), np.array([30, 30, 30]))
    assert out.tolist() == [0.0, 0.3, 1.0]


def test_below_min_rows_omits_horizon() -> None:
    rng = np.random.default_rng(2)
    n = 10
    p = rng.uniform(0, 1, n)
    y = rng.integers(0, 2, n)
    horizons = np.full(n, 15)
    cal = fit_calibrators(p, y, horizons, min_rows=1000)
    assert cal == {}
