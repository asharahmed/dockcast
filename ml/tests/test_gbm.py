"""`train_boosters` reuses one binned Dataset for the three targets; the result must equal
boosters trained the old way, each target on its own freshly built Datasets from the
mixed-dtype feature frame (docs/ml-spec.md §3.4).
"""

from __future__ import annotations

import lightgbm as lgb
import numpy as np
import pandas as pd
import pytest

from dockcast_ml.features import _INT32_FEATURES, CATEGORICAL, FEATURE_NAMES
from dockcast_ml.models import gbm


def _frame(n: int, rng: np.random.Generator) -> pd.DataFrame:
    cols = {}
    for name in FEATURE_NAMES:
        if name == "station_pk":
            cols[name] = rng.integers(1, 40, n).astype(np.int32)
        elif name in _INT32_FEATURES:
            cols[name] = rng.integers(0, 7, n).astype(np.int32)
        else:
            cols[name] = rng.normal(size=n).astype(np.float32)
    return pd.DataFrame(cols)


def _targets(x: pd.DataFrame, rng: np.random.Generator) -> dict[str, np.ndarray]:
    signal = x["bikes0"].to_numpy() + 0.5 * x["fill0"].to_numpy() + rng.normal(scale=0.5, size=len(x))
    return {
        "bike": (signal > 0).astype(np.int8),
        "dock": (signal < 0.3).astype(np.int8),
        "cnt": signal.astype(np.float32),
    }


def _train_separately(x_tr, y_tr, x_es, y_es) -> dict[str, lgb.Booster]:
    """The pre-change implementation: new Datasets per target, DataFrame input."""
    out = {}
    for target in ("bike", "dock", "cnt"):
        if target in ("bike", "dock"):
            params = {**gbm.PARAMS_BASE, "objective": "binary", "metric": "binary_logloss"}
        else:
            params = {**gbm.PARAMS_BASE, "objective": "regression", "metric": "l2"}
        dtr = lgb.Dataset(
            x_tr[FEATURE_NAMES], label=y_tr[target], categorical_feature=CATEGORICAL, free_raw_data=False
        )
        des = lgb.Dataset(
            x_es[FEATURE_NAMES], label=y_es[target], reference=dtr, categorical_feature=CATEGORICAL
        )
        out[target] = lgb.train(
            params, dtr, num_boost_round=gbm.NUM_BOOST_ROUND, valid_sets=[des],
            callbacks=[lgb.early_stopping(gbm.EARLY_STOPPING_ROUNDS, verbose=False)],
        )
    return out


def _trees(booster: lgb.Booster) -> list[str]:
    """The model text without the `pandas_categorical` trailer, the one line that differs
    between a model trained from a DataFrame (`[]`) and from a matrix (`null`); neither has
    pandas categorical columns, so it does not affect prediction.
    """
    return [ln for ln in booster.model_to_string().splitlines() if not ln.startswith("pandas_categorical:")]


@pytest.mark.parametrize("as_matrix", [False, True])
def test_shared_datasets_match_separate_datasets(monkeypatch: pytest.MonkeyPatch, as_matrix: bool) -> None:
    monkeypatch.setattr(gbm, "NUM_BOOST_ROUND", 40)
    monkeypatch.setattr(gbm, "EARLY_STOPPING_ROUNDS", 5)
    rng = np.random.default_rng(1)
    x_tr, x_es = _frame(6000, rng), _frame(2000, rng)
    y_tr, y_es = _targets(x_tr, rng), _targets(x_es, rng)

    expected = _train_separately(x_tr, y_tr, x_es, y_es)
    if as_matrix:
        got = gbm.train_boosters(
            x_tr.to_numpy(np.float32), y_tr, x_es.to_numpy(np.float32), y_es
        )
    else:
        got = gbm.train_boosters(x_tr, y_tr, x_es, y_es)

    assert list(got) == list(expected)
    x_val = _frame(1500, rng)
    raw_expected = gbm.predict_raw(expected, x_val)
    raw_got = gbm.predict_raw(got, x_val if not as_matrix else x_val.to_numpy(np.float32))
    for target in expected:
        assert got[target].best_iteration == expected[target].best_iteration
        assert _trees(got[target]) == _trees(expected[target])
        np.testing.assert_array_equal(raw_got[target], raw_expected[target])


def test_int32_features_are_exact_in_float32() -> None:
    ints = np.array([0, 1, 1439, 2**24], dtype=np.int32)
    assert (ints.astype(np.float32).astype(np.int32) == ints).all()
