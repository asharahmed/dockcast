"""LightGBM training (docs/ml-spec.md §3.4, docs/worker-spec.md §7.2).

Three pooled boosters (`bike`, `dock` binary; `cnt` regression), fixed
hyperparameters (no search in v1), early stopping on the `es` split.
"""

from __future__ import annotations

import logging
from typing import Any

import lightgbm as lgb
import numpy as np
import pandas as pd

from dockcast_ml.features import CATEGORICAL, FEATURE_NAMES
from dockcast_ml.memory import log_memory

logger = logging.getLogger("dockcast_ml.train")

PARAMS_BASE: dict[str, Any] = {
    "num_leaves": 63,
    "learning_rate": 0.05,
    "min_data_in_leaf": 200,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "lambda_l2": 1.0,
    "max_bin": 255,
    "seed": 42,
    "deterministic": True,
    "force_row_wise": True,  # required for bit-identical results with deterministic=True (LightGBM docs)
    "num_threads": 2,
    "verbosity": -1,
}
NUM_BOOST_ROUND = 3000
EARLY_STOPPING_ROUNDS = 50

_TARGETS = ("bike", "dock", "cnt")


def _as_matrix(x: pd.DataFrame | np.ndarray) -> np.ndarray:
    """`x` as a (rows, len(FEATURE_NAMES)) float32 matrix in `FEATURE_NAMES` column order.

    The int32 features are small integers (ids, minute-of-day, flags), exactly representable in
    float32; LightGBM bins from the same values either way. A DataFrame mixing int32 and float32
    columns would otherwise reach LightGBM as float64, twice the size.
    """
    if isinstance(x, pd.DataFrame):
        return x[FEATURE_NAMES].to_numpy(dtype=np.float32)
    if x.shape[1] != len(FEATURE_NAMES):
        raise ValueError(f"expected {len(FEATURE_NAMES)} feature columns, got {x.shape[1]}")
    return np.asarray(x, dtype=np.float32)


def build_datasets(
    x_tr: pd.DataFrame | np.ndarray,
    y_tr: dict[str, np.ndarray],
    x_es: pd.DataFrame | np.ndarray,
    y_es: dict[str, np.ndarray],
) -> tuple[lgb.Dataset, lgb.Dataset]:
    """The binned training and early-stopping Datasets, built once and shared by all targets.

    Binning depends on the features and on `PARAMS_BASE`'s dataset parameters, which are the
    same for every target, so only the label differs between targets. The Datasets drop their
    reference to the raw matrices once constructed (`free_raw_data=True`); a caller that then
    drops its own references releases the raw feature memory before the fit starts.
    """
    dtr = lgb.Dataset(
        _as_matrix(x_tr),
        label=y_tr[_TARGETS[0]],
        feature_name=list(FEATURE_NAMES),
        categorical_feature=CATEGORICAL,
        params=dict(PARAMS_BASE),
        free_raw_data=True,
    )
    dtr.construct()
    des = lgb.Dataset(
        _as_matrix(x_es),
        label=y_es[_TARGETS[0]],
        reference=dtr,
        feature_name=list(FEATURE_NAMES),
        categorical_feature=CATEGORICAL,
        free_raw_data=True,
    )
    des.construct()
    log_memory(logger, "gbm_datasets")
    return dtr, des


def fit_boosters(
    dtr: lgb.Dataset,
    des: lgb.Dataset,
    y_tr: dict[str, np.ndarray],
    y_es: dict[str, np.ndarray],
) -> dict[str, lgb.Booster]:
    """Train `M_bike`, `M_dock` (binary) and `M_cnt` (L2 regression) on the `build_datasets`
    pair, early stopping on `des` (docs/ml-spec.md §3.4).
    """
    boosters: dict[str, lgb.Booster] = {}
    for target in _TARGETS:
        if target in ("bike", "dock"):
            params = {**PARAMS_BASE, "objective": "binary", "metric": "binary_logloss"}
        else:
            params = {**PARAMS_BASE, "objective": "regression", "metric": "l2"}
        dtr.set_label(y_tr[target])
        des.set_label(y_es[target])
        booster = lgb.train(
            params,
            dtr,
            num_boost_round=NUM_BOOST_ROUND,
            valid_sets=[des],
            callbacks=[lgb.early_stopping(EARLY_STOPPING_ROUNDS, verbose=False)],
        )
        boosters[target] = booster
        log_memory(logger, f"fit_{target}")
    return boosters


def train_boosters(
    x_tr: pd.DataFrame | np.ndarray,
    y_tr: dict[str, np.ndarray],
    x_es: pd.DataFrame | np.ndarray,
    y_es: dict[str, np.ndarray],
) -> dict[str, lgb.Booster]:
    """`build_datasets` then `fit_boosters`. Feature matrices are float32 arrays in
    `FEATURE_NAMES` order (or DataFrames holding those columns).
    """
    dtr, des = build_datasets(x_tr, y_tr, x_es, y_es)
    return fit_boosters(dtr, des, y_tr, y_es)


def predict_raw(boosters: dict[str, lgb.Booster], x: pd.DataFrame | np.ndarray) -> dict[str, np.ndarray]:
    """`booster.predict(X[FEATURE_NAMES], num_iteration=booster.best_iteration)` per target."""
    feat = x[FEATURE_NAMES] if isinstance(x, pd.DataFrame) else x
    return {
        target: np.asarray(booster.predict(feat, num_iteration=booster.best_iteration))
        for target, booster in boosters.items()
    }


__all__ = [
    "PARAMS_BASE", "NUM_BOOST_ROUND", "EARLY_STOPPING_ROUNDS",
    "build_datasets", "fit_boosters", "train_boosters", "predict_raw",
]
