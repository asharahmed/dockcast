"""LightGBM training (docs/ml-spec.md §3.4, docs/worker-spec.md §7.2).

Three pooled boosters (`bike`, `dock` binary; `cnt` regression), fixed
hyperparameters (no search in v1), early stopping on the `es` split.
"""

from __future__ import annotations

from typing import Any

import lightgbm as lgb
import numpy as np
import pandas as pd

from dockcast_ml.features import CATEGORICAL, FEATURE_NAMES

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


def train_boosters(
    x_tr: pd.DataFrame,
    y_tr: dict[str, np.ndarray],
    x_es: pd.DataFrame,
    y_es: dict[str, np.ndarray],
) -> dict[str, lgb.Booster]:
    """Train `M_bike`, `M_dock` (binary) and `M_cnt` (L2 regression) on `x_tr`/`y_tr`, early
    stopping on `x_es`/`y_es` (docs/ml-spec.md §3.4).
    """
    boosters: dict[str, lgb.Booster] = {}
    for target in _TARGETS:
        if target in ("bike", "dock"):
            params = {**PARAMS_BASE, "objective": "binary", "metric": "binary_logloss"}
        else:
            params = {**PARAMS_BASE, "objective": "regression", "metric": "l2"}
        dtr = lgb.Dataset(
            x_tr[FEATURE_NAMES], label=y_tr[target], categorical_feature=CATEGORICAL, free_raw_data=False
        )
        des = lgb.Dataset(
            x_es[FEATURE_NAMES], label=y_es[target], reference=dtr, categorical_feature=CATEGORICAL
        )
        booster = lgb.train(
            params,
            dtr,
            num_boost_round=NUM_BOOST_ROUND,
            valid_sets=[des],
            callbacks=[lgb.early_stopping(EARLY_STOPPING_ROUNDS, verbose=False)],
        )
        boosters[target] = booster
    return boosters


def predict_raw(boosters: dict[str, lgb.Booster], x: pd.DataFrame) -> dict[str, np.ndarray]:
    """`booster.predict(X[FEATURE_NAMES], num_iteration=booster.best_iteration)` per target."""
    feat = x[FEATURE_NAMES]
    return {
        target: np.asarray(booster.predict(feat, num_iteration=booster.best_iteration))
        for target, booster in boosters.items()
    }


__all__ = ["PARAMS_BASE", "NUM_BOOST_ROUND", "EARLY_STOPPING_ROUNDS", "train_boosters", "predict_raw"]
