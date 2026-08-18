"""T12, T14 (docs/ml-spec.md §8): feature builder leakage and schema manifest."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import pytest

from dockcast_ml.features import (
    FEATURE_NAMES,
    FEATURE_SCHEMA_VERSION,
    FeatureContext,
    build_features,
)
from dockcast_ml.grid import GridArrays
from dockcast_ml.horizons import HORIZONS
from dockcast_ml.profile import RollingProfile
from dockcast_ml.weather_asof import WeatherAsOf

TZ = ZoneInfo("America/Toronto")
T0 = datetime(2026, 6, 1, 16, 0, tzinfo=UTC)  # Monday, non-holiday


def _make_grid(t0: datetime, lookback_min: int = 65, lookahead_min: int = 65) -> GridArrays:
    t_start = t0 - timedelta(minutes=lookback_min)
    t_end = t0 + timedelta(minutes=lookahead_min)
    t_index = pd.date_range(t_start, t_end, freq="1min", tz="UTC")
    m = len(t_index)
    s = 2
    rng = np.random.default_rng(7)
    bikes = rng.integers(0, 15, size=(s, m)).astype(np.int16)
    docks = (25 - bikes).astype(np.int16)
    ebikes = rng.integers(0, 3, size=(s, m)).astype(np.int16)
    fresh = np.ones((s, m), dtype=bool)
    return GridArrays(
        station_pks=np.array([101, 102], dtype=np.int32),
        pos={101: 0, 102: 1},
        t_index=t_index,
        bikes=bikes,
        docks=docks,
        ebikes=ebikes,
        fresh=fresh,
    )


def _make_weather(t0: datetime, extra_future_rows: bool = False) -> WeatherAsOf:
    hours = sorted({(t0 + timedelta(minutes=h)).replace(minute=0, second=0, microsecond=0) for h in (0, *HORIZONS)})
    rows = []
    for i, hour in enumerate(hours):
        rows.append((t0 - timedelta(hours=1), hour, 10.0 + i, 0.2 * i, 20, 5.0, 1))
    if extra_future_rows:
        # a "later" fetch (after t0) with wildly different values -- must never affect .at(t0, ...)
        for hour in hours:
            rows.append((t0 + timedelta(minutes=1), hour, 999.0, 999.0, 99, 99.0, 9))
    df = pd.DataFrame(rows, columns=["fetched_at", "valid_hour", "temp_c", "precip_mm", "precip_prob", "wind_kmh", "weather_code"])
    return WeatherAsOf(df)


def _make_ctx(t0: datetime, grid: GridArrays, weather: WeatherAsOf) -> FeatureContext:
    stations = pd.DataFrame(
        {"id": [101, 102], "lat": [43.65, 43.66], "lon": [-79.38, -79.39], "capacity": [25, 25]}
    )
    rates = np.zeros((2, 3, 96, 2), dtype=np.float32)
    rates_ok = np.array([True, True])
    neighbors = np.array([[1, -1, -1], [0, -1, -1]], dtype=np.int64)
    profile = RollingProfile(TZ, station_pks=grid.station_pks, max_days=28)
    return FeatureContext(
        tz=TZ, hol=set(), stations=stations, grid=grid, rates=rates, rates_ok=rates_ok,
        weather=weather, multipliers={}, neighbors=neighbors, profile=profile,
    )


def _make_rows(t0: datetime) -> pd.DataFrame:
    records = []
    for pk in (101, 102):
        for h in HORIZONS:
            records.append(
                {
                    "station_pk": pk, "t0": t0, "horizon": h,
                    "bd_p_bike": 0.7, "bd_p_dock": 0.3, "bd_exp_cnt": 5.0,
                    "bd_A": 1.2, "bd_D": 0.8, "lam_in_now": 0.1, "lam_out_now": 0.05,
                }
            )
    return pd.DataFrame(records)


def test_no_leakage_from_future_grid_and_weather() -> None:
    """T12: perturbing any snapshot/weather row with ts > t0 leaves build_features(t0) unchanged."""
    grid_base = _make_grid(T0)
    weather_base = _make_weather(T0, extra_future_rows=False)
    ctx_base = _make_ctx(T0, grid_base, weather_base)
    rows = _make_rows(T0)
    baseline = build_features(ctx_base, rows)

    grid_perturbed = _make_grid(T0)
    col0 = grid_perturbed.col(T0)
    # corrupt every cell strictly after t0
    grid_perturbed.bikes[:, col0 + 1 :] = 999
    grid_perturbed.docks[:, col0 + 1 :] = 999
    grid_perturbed.ebikes[:, col0 + 1 :] = 999
    grid_perturbed.fresh[:, col0 + 1 :] = False
    weather_perturbed = _make_weather(T0, extra_future_rows=True)
    ctx_perturbed = _make_ctx(T0, grid_perturbed, weather_perturbed)
    perturbed = build_features(ctx_perturbed, rows)

    pd.testing.assert_frame_equal(baseline, perturbed)


def test_no_leakage_deep_copy_sanity() -> None:
    """Sanity check that the perturbation in the test above is actually independent of the
    baseline grid (i.e. this is a real two-object comparison, not an aliasing artifact)."""
    grid_a = _make_grid(T0)
    grid_b = _make_grid(T0)
    assert grid_a is not grid_b
    assert np.array_equal(grid_a.bikes, grid_b.bikes)
    grid_b.bikes[:] = -1
    assert not np.array_equal(grid_a.bikes, grid_b.bikes)


def test_schema_manifest() -> None:
    """T14: FEATURE_NAMES length 39 & order matches a hard-coded manifest; schema version 1."""
    manifest = [
        "bikes0", "docks0", "cap0", "fill0", "dbikes_5", "dbikes_15", "dbikes_30", "dbikes_60", "ebikes0",
        "mod", "mod_sin", "mod_cos", "dow", "is_holiday", "daytype", "h", "station_pk", "lat", "lon", "cap_static",
        "bd_p_bike", "bd_p_dock", "bd_exp_cnt", "bd_A", "bd_D", "lam_in_now", "lam_out_now",
        "temp_now", "precip_now", "wind_now", "code_now", "temp_h", "precip_h", "precip_prob_h",
        "nn3_mean_fill", "nn3_mean_dfill_15", "clim_fill", "clim_p_bike", "clim_p_dock",
    ]
    assert len(manifest) == 39
    assert FEATURE_NAMES == manifest
    assert FEATURE_SCHEMA_VERSION == 1


def test_output_shape_and_dtypes() -> None:
    grid = _make_grid(T0)
    weather = _make_weather(T0)
    ctx = _make_ctx(T0, grid, weather)
    rows = _make_rows(T0)
    out = build_features(ctx, rows)

    assert list(out.columns) == ["t0", *FEATURE_NAMES]
    assert list(out.columns[-39:]) == FEATURE_NAMES
    assert len(out) == len(rows)

    int32_cols = {"dow", "daytype", "station_pk", "h", "mod", "is_holiday"}
    for name in FEATURE_NAMES:
        expected_dtype = np.int32 if name in int32_cols else np.float32
        assert out[name].dtype == expected_dtype, f"{name}: {out[name].dtype}"

    # row order preserved
    assert list(out["station_pk"]) == list(rows["station_pk"])
    assert list(out["h"]) == list(rows["horizon"])

    # bd_* / lam_*_now passed through unchanged (features 21-27, "never recomputed")
    assert np.allclose(out["bd_p_bike"].to_numpy(), rows["bd_p_bike"].to_numpy())
    assert np.allclose(out["bd_A"].to_numpy(), rows["bd_A"].to_numpy())
    assert np.allclose(out["lam_out_now"].to_numpy(), rows["lam_out_now"].to_numpy())


def test_missing_required_columns_raises() -> None:
    grid = _make_grid(T0)
    weather = _make_weather(T0)
    ctx = _make_ctx(T0, grid, weather)
    bad_rows = pd.DataFrame({"station_pk": [101], "t0": [T0], "horizon": [15]})
    with pytest.raises(ValueError, match="missing columns"):
        build_features(ctx, bad_rows)


def test_empty_rows_returns_empty_frame() -> None:
    grid = _make_grid(T0)
    weather = _make_weather(T0)
    ctx = _make_ctx(T0, grid, weather)
    rows = _make_rows(T0).iloc[0:0]
    out = build_features(ctx, rows)
    assert out.empty
    assert list(out.columns) == ["t0", *FEATURE_NAMES]
