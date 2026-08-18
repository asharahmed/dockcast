"""Evaluation metrics (docs/ml-spec.md §5.2, docs/worker-spec.md §7.4).

Probabilistic metrics (Brier, log loss, AUC, ECE, reliability) for the
`bike`/`dock` targets and regression metrics (MAE, RMSE) for `cnt`, computed
per target, per horizon (`0` = pooled over all horizons present), and per
slice (`all`, `at_risk`). Callers (train.py, metrics_online.py) guarantee
identical row sets across tiers by computing all tiers from arrays aligned to
the same `(station_pk, t0, horizon)` row order.

**[decision]** ml-spec §5.2 lists "reliability table" alongside Brier/logloss/
AUC/ECE as one of the metrics computed "per target, per h, and pooled over h"
and, separately, "Slices: all; at_risk = ...". §5.3 then clarifies reliability
bins are written "at horizon = 0" without saying which slice. Read literally,
reliability follows the same per-slice rule as every other probabilistic
metric, just restricted to the pooled horizon; this module therefore emits
`rel_bin_*` rows for horizon 0 in *both* slices (`all` and `at_risk`), not
just `all`. This matches the WP-6 brief's DoD line asking for `model_eval`
rows "for every (target, horizon, slice) with the expected metric names".
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from sklearn.metrics import roc_auc_score

_LOGLOSS_EPS = 1e-6
_N_BINS = 10


@dataclass
class Preds:
    p_bike: np.ndarray
    p_dock: np.ndarray
    y_cnt_hat: np.ndarray | None


def brier(p: np.ndarray, y: np.ndarray) -> float:
    p = np.asarray(p, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    return float(np.mean((p - y) ** 2))


def logloss(p: np.ndarray, y: np.ndarray) -> float:
    p = np.clip(np.asarray(p, dtype=np.float64), _LOGLOSS_EPS, 1 - _LOGLOSS_EPS)
    y = np.asarray(y, dtype=np.float64)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def auc(p: np.ndarray, y: np.ndarray) -> float:
    """`roc_auc_score`; `NaN` if `y` has a single class."""
    y = np.asarray(y, dtype=np.float64)
    if len(np.unique(y)) < 2:
        return float("nan")
    return float(roc_auc_score(y, np.asarray(p, dtype=np.float64)))


def ece(p: np.ndarray, y: np.ndarray, bins: int = _N_BINS) -> float:
    p = np.asarray(p, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    n = len(p)
    if n == 0:
        return float("nan")
    b = np.minimum((p * bins).astype(int), bins - 1)
    total = 0.0
    for i in range(bins):
        mask = b == i
        n_b = int(mask.sum())
        if n_b == 0:
            continue
        total += (n_b / n) * abs(p[mask].mean() - y[mask].mean())
    return float(total)


def reliability(p: np.ndarray, y: np.ndarray, bins: int = _N_BINS) -> list[tuple[int, int, float, float]]:
    """`[(bin, n, mean_pred, frac_pos), ...]` for `bin in 0..bins-1` (only bins with `n>0`)."""
    p = np.asarray(p, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    if len(p) == 0:
        return []
    b = np.minimum((p * bins).astype(int), bins - 1)
    out: list[tuple[int, int, float, float]] = []
    for i in range(bins):
        mask = b == i
        n_b = int(mask.sum())
        if n_b == 0:
            continue
        out.append((i, n_b, float(p[mask].mean()), float(y[mask].mean())))
    return out


def mae(y_hat: np.ndarray, y: np.ndarray) -> float:
    return float(np.mean(np.abs(np.asarray(y_hat, dtype=np.float64) - np.asarray(y, dtype=np.float64))))


def rmse(y_hat: np.ndarray, y: np.ndarray) -> float:
    d = np.asarray(y_hat, dtype=np.float64) - np.asarray(y, dtype=np.float64)
    return float(np.sqrt(np.mean(d**2)))


def _bike_dock_rows(
    tier: str, target: str, p: np.ndarray, y: np.ndarray, horizon: int, slice_name: str
) -> list[dict]:
    n = len(p)
    rows = [
        {"tier": tier, "target": target, "horizon": horizon, "slice": slice_name, "metric": "brier", "value": brier(p, y), "n": n},
        {"tier": tier, "target": target, "horizon": horizon, "slice": slice_name, "metric": "logloss", "value": logloss(p, y), "n": n},
        {"tier": tier, "target": target, "horizon": horizon, "slice": slice_name, "metric": "auc", "value": auc(p, y), "n": n},
        {"tier": tier, "target": target, "horizon": horizon, "slice": slice_name, "metric": "ece", "value": ece(p, y), "n": n},
    ]
    if horizon == 0:
        for b, n_b, mean_pred, frac_pos in reliability(p, y):
            rows.extend(
                [
                    {"tier": tier, "target": target, "horizon": 0, "slice": slice_name, "metric": f"rel_bin_{b}_mean_pred", "value": mean_pred, "n": n_b},
                    {"tier": tier, "target": target, "horizon": 0, "slice": slice_name, "metric": f"rel_bin_{b}_frac_pos", "value": frac_pos, "n": n_b},
                    {"tier": tier, "target": target, "horizon": 0, "slice": slice_name, "metric": f"rel_bin_{b}_n", "value": float(n_b), "n": n_b},
                ]
            )
    return rows


def _cnt_rows(tier: str, y_hat: np.ndarray, y: np.ndarray, horizon: int, slice_name: str) -> list[dict]:
    n = len(y_hat)
    return [
        {"tier": tier, "target": "cnt", "horizon": horizon, "slice": slice_name, "metric": "mae", "value": mae(y_hat, y), "n": n},
        {"tier": tier, "target": "cnt", "horizon": horizon, "slice": slice_name, "metric": "rmse", "value": rmse(y_hat, y), "n": n},
    ]


def metric_rows(
    tier: str,
    preds: Preds,
    y_bike: np.ndarray,
    y_dock: np.ndarray,
    y_cnt: np.ndarray,
    bikes0: np.ndarray,
    docks0: np.ndarray,
    horizons: np.ndarray,
) -> list[dict]:
    """`[{tier,target,horizon,slice,metric,value,n}, ...]` for every `target in (bike,dock,cnt)`,
    every `horizon in {0, *sorted(unique(horizons))}` (`0` = pooled), and every
    `slice in (all, at_risk)`. `at_risk`: `bikes0<=3` for bike/cnt, `docks0<=3` for dock
    (docs/worker-spec.md §7.4 decision). Rows with `n==0` (e.g. an empty `at_risk` slice) are
    omitted.
    """
    horizons = np.asarray(horizons)
    bikes0 = np.asarray(bikes0, dtype=np.float64)
    docks0 = np.asarray(docks0, dtype=np.float64)
    y_bike_arr = np.asarray(y_bike)
    y_dock_arr = np.asarray(y_dock)
    y_cnt_arr = np.asarray(y_cnt, dtype=np.float64)

    horizon_values = [0, *sorted({int(h) for h in horizons.tolist()})]
    rows: list[dict] = []
    for h in horizon_values:
        mask_h = np.ones(len(horizons), dtype=bool) if h == 0 else (horizons == h)
        for slice_name in ("all", "at_risk"):
            bike_mask = mask_h if slice_name == "all" else (mask_h & (bikes0 <= 3))
            if int(bike_mask.sum()) > 0:
                rows.extend(
                    _bike_dock_rows(tier, "bike", preds.p_bike[bike_mask], y_bike_arr[bike_mask], h, slice_name)
                )

            dock_mask = mask_h if slice_name == "all" else (mask_h & (docks0 <= 3))
            if int(dock_mask.sum()) > 0:
                rows.extend(
                    _bike_dock_rows(tier, "dock", preds.p_dock[dock_mask], y_dock_arr[dock_mask], h, slice_name)
                )

            if preds.y_cnt_hat is not None:
                cnt_mask = mask_h if slice_name == "all" else (mask_h & (bikes0 <= 3))
                if int(cnt_mask.sum()) > 0:
                    rows.extend(_cnt_rows(tier, preds.y_cnt_hat[cnt_mask], y_cnt_arr[cnt_mask], h, slice_name))
    return rows


__all__ = ["Preds", "brier", "logloss", "auc", "ece", "reliability", "mae", "rmse", "metric_rows"]
