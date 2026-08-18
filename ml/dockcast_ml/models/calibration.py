"""Isotonic calibration (docs/ml-spec.md §5.1, docs/worker-spec.md §7.1).

Both the fit side (used by WP-6's `train.py` to calibrate `bd` and `gbm`) and
the apply side (used by `predict.py` every cycle) live in this one module per
the worker-spec package layout.
"""

from __future__ import annotations

import numpy as np
from sklearn.isotonic import IsotonicRegression


def fit_calibrators(
    p: np.ndarray, y: np.ndarray, horizons: np.ndarray, min_rows: int = 1000
) -> dict[int, IsotonicRegression]:
    """Per unique horizon present in `horizons`: fit an isotonic regression on `(p, y)`
    restricted to that horizon, if it has `>= min_rows` rows (ml-spec §5.1: `y_min=0, y_max=1,
    out_of_bounds='clip', increasing=True`). Horizons with too few rows are omitted (identity
    at apply time).
    """
    out: dict[int, IsotonicRegression] = {}
    horizons = np.asarray(horizons)
    p = np.asarray(p, dtype=np.float64)
    y = np.asarray(y)
    for h in sorted({int(x) for x in horizons}):
        mask = horizons == h
        if int(mask.sum()) < min_rows:
            continue
        reg = IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip", increasing=True)
        reg.fit(p[mask], y[mask])
        out[h] = reg
    return out


def apply_calibrators(cal: dict[int, IsotonicRegression], p: np.ndarray, horizons: np.ndarray) -> np.ndarray:
    """Apply per-horizon calibrators to `p`; identity (still clipped to `[0,1]`) for horizons
    without a fitted calibrator.
    """
    p = np.asarray(p, dtype=np.float64)
    horizons = np.asarray(horizons)
    out = np.clip(p, 0.0, 1.0).copy()
    for h, reg in cal.items():
        mask = horizons == h
        if mask.any():
            out[mask] = reg.predict(p[mask])
    return out


__all__ = ["fit_calibrators", "apply_calibrators"]
