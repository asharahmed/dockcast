"""T13 (docs/ml-spec.md §8): golden-row equality.

`build_features` is the *single* function used both online (predict.py) and
offline (train.py, WP-6) -- there is no separate "offline builder" to diff
against (ml-spec Invariant L0). This test freezes its output on a fully
deterministic (no RNG) fixture scenario under `tests/fixtures/features_golden.json`
and checks two things exactly:
1. calling `build_features` on two independently-constructed `rows` DataFrames
   that carry identical values (simulating "this cycle's bd output" vs
   "read back from forecast_history") produces identical output -- i.e. the
   builder's output depends only on the values in `rows`, never on how they
   got there;
2. the output matches the frozen golden fixture exactly (ints exact, floats
   `atol=1e-6`), guarding against accidental drift in the feature math.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import pytest

from dockcast_ml.features import FEATURE_NAMES, FeatureContext, build_features
from dockcast_ml.grid import GridArrays
from dockcast_ml.horizons import HORIZONS
from dockcast_ml.profile import RollingProfile
from dockcast_ml.weather_asof import WeatherAsOf

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "features_golden.json"
TZ = ZoneInfo("America/Toronto")
T0 = datetime(2026, 6, 1, 16, 0, tzinfo=UTC)  # Monday 12:00 local (EDT), non-holiday

_STATION_PKS = np.array([201, 202], dtype=np.int32)
# bikes at t0-k minutes, per station (index 0=pk201, 1=pk202), k in {0,5,15,30,60}
_BIKES_BY_LOOKBACK = {
    0: (8, 3),
    5: (9, 4),
    15: (6, 5),
    30: (10, 2),
    60: (5, 6),
}
_EBIKES0 = (2, 0)
_CAPACITY = (20, 15)
_LAT = (43.65, 43.70)
_LON = (-79.38, -79.42)
# clim inputs: local noon Monday => day_type 0; buckets for h in (0,*HORIZONS) computed below
_CLIM_MEAN_FILL = {48: 0.40, 49: 0.41, 50: 0.42, 51: 0.43, 52: 0.44, 54: 0.46, 56: 0.48}
_CLIM_P_BIKE = 0.8
_CLIM_P_DOCK = 0.7
_CLIM_N = 10


def _build_golden_grid() -> GridArrays:
    t_start = T0 - timedelta(minutes=65)
    t_end = T0 + timedelta(minutes=5)  # build_features never reads past t0; small margin is enough
    t_index = pd.date_range(t_start, t_end, freq="1min", tz="UTC")
    m = len(t_index)
    s = 2
    bikes = np.full((s, m), 10, dtype=np.int16)  # filler for minutes we don't care about
    fresh = np.ones((s, m), dtype=bool)
    col0 = int((T0 - t_index[0]).total_seconds() // 60)
    for k, (b0, b1) in _BIKES_BY_LOOKBACK.items():
        bikes[0, col0 - k] = b0
        bikes[1, col0 - k] = b1
    docks = np.stack([_CAPACITY[0] - bikes[0], _CAPACITY[1] - bikes[1]]).astype(np.int16)
    ebikes = np.zeros((s, m), dtype=np.int16)
    ebikes[0, col0] = _EBIKES0[0]
    ebikes[1, col0] = _EBIKES0[1]
    return GridArrays(
        station_pks=_STATION_PKS, pos={201: 0, 202: 1}, t_index=t_index,
        bikes=bikes, docks=docks, ebikes=ebikes, fresh=fresh,
    )


def _build_golden_weather() -> WeatherAsOf:
    hours = sorted({(T0 + timedelta(minutes=h)).replace(minute=0, second=0, microsecond=0) for h in (0, *HORIZONS)})
    values = {16: (15.0, 0.0, 10), 17: (16.0, 0.5, 20), 18: (17.0, 1.0, 30)}
    rows = []
    for hour in hours:
        temp, precip, prob = values[hour.hour]
        rows.append((T0 - timedelta(minutes=30), hour, temp, precip, prob, 8.0, 2))
    df = pd.DataFrame(rows, columns=["fetched_at", "valid_hour", "temp_c", "precip_mm", "precip_prob", "wind_kmh", "weather_code"])
    return WeatherAsOf(df)


def _build_golden_profile() -> RollingProfile:
    prof = RollingProfile(TZ, station_pks=_STATION_PKS, max_days=28)
    for j, mean_fill in _CLIM_MEAN_FILL.items():
        for s in (0, 1):
            offset = 0.0 if s == 0 else 0.05
            prof.n[0, s, j] = _CLIM_N
            prof.sum_fill[0, s, j] = (mean_fill + offset) * _CLIM_N
            prof.sum_bike[0, s, j] = _CLIM_P_BIKE * _CLIM_N
            prof.sum_dock[0, s, j] = _CLIM_P_DOCK * _CLIM_N
    return prof


def _build_golden_ctx() -> FeatureContext:
    stations = pd.DataFrame({"id": list(_STATION_PKS), "lat": list(_LAT), "lon": list(_LON), "capacity": list(_CAPACITY)})
    rates = np.zeros((2, 3, 96, 2), dtype=np.float32)
    rates_ok = np.array([True, True])
    neighbors = np.array([[1, -1, -1], [0, -1, -1]], dtype=np.int64)
    return FeatureContext(
        tz=TZ, hol=set(), stations=stations, grid=_build_golden_grid(), rates=rates, rates_ok=rates_ok,
        weather=_build_golden_weather(), multipliers={}, neighbors=neighbors, profile=_build_golden_profile(),
    )


def _build_golden_rows(variant: str) -> pd.DataFrame:
    """`variant` in {"online", "offline"}: two independent constructions of the same values,
    simulating this-cycle bd output vs a forecast_history read-back.
    """
    records = []
    for i, pk in enumerate(_STATION_PKS):
        for h in HORIZONS:
            base = 0.1 * i
            if variant == "online":
                bd_p_bike, bd_p_dock, bd_exp_cnt = 0.60 + base, 0.35 + base, 5.0 + i
                bd_a, bd_d = 1.5 + base, 1.1 + base
                lam_in, lam_out = 0.12 + base, 0.09 + base
            else:
                # offline: as if these were read out of forecast_history columns, computed the
                # same arithmetic way but through a distinct code path to prove provenance doesn't matter
                stored = {"p_bike": 0.60 + base, "p_dock": 0.35 + base, "exp_bikes": 5.0 + i, "bd_a": 1.5 + base, "bd_d": 1.1 + base, "lam_in": 0.12 + base, "lam_out": 0.09 + base}
                bd_p_bike, bd_p_dock, bd_exp_cnt = stored["p_bike"], stored["p_dock"], stored["exp_bikes"]
                bd_a, bd_d = stored["bd_a"], stored["bd_d"]
                lam_in, lam_out = stored["lam_in"], stored["lam_out"]
            records.append(
                {
                    "station_pk": int(pk), "t0": T0, "horizon": h,
                    "bd_p_bike": bd_p_bike, "bd_p_dock": bd_p_dock, "bd_exp_cnt": bd_exp_cnt,
                    "bd_A": bd_a, "bd_D": bd_d, "lam_in_now": lam_in, "lam_out_now": lam_out,
                }
            )
    return pd.DataFrame(records)


def _generate_fixture() -> list[dict]:
    ctx = _build_golden_ctx()
    rows = _build_golden_rows("online")
    out = build_features(ctx, rows)
    records = out.to_dict("records")
    for rec in records:
        rec["t0"] = pd.Timestamp(rec["t0"]).isoformat()
        for k, v in list(rec.items()):
            if isinstance(v, (np.integer,)):
                rec[k] = int(v)
            elif isinstance(v, (np.floating,)):
                rec[k] = None if np.isnan(v) else float(v)
    return records


def test_online_offline_provenance_independence() -> None:
    ctx = _build_golden_ctx()
    online = build_features(ctx, _build_golden_rows("online"))
    offline = build_features(_build_golden_ctx(), _build_golden_rows("offline"))
    pd.testing.assert_frame_equal(online, offline)


@pytest.mark.skipif(not FIXTURE_PATH.exists(), reason="golden fixture not generated yet")
def test_golden_rows_exact() -> None:
    golden = json.loads(FIXTURE_PATH.read_text())
    ctx = _build_golden_ctx()
    out = build_features(ctx, _build_golden_rows("online"))
    assert len(out) == len(golden)

    int_cols = {"dow", "daytype", "station_pk", "h", "mod", "is_holiday"}
    for i, expected_row in enumerate(golden):
        actual_row = out.iloc[i]
        for name in FEATURE_NAMES:
            expected = expected_row[name]
            actual = actual_row[name]
            if name in int_cols:
                assert int(actual) == int(expected), f"row {i} col {name}: {actual} != {expected}"
            elif expected is None:
                assert pd.isna(actual), f"row {i} col {name}: expected NaN, got {actual}"
            else:
                assert abs(float(actual) - float(expected)) < 1e-6, f"row {i} col {name}: {actual} != {expected}"


if __name__ == "__main__":
    # one-off fixture generation: `uv run python tests/test_features_golden.py`
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(json.dumps(_generate_fixture(), indent=2))
    print(f"wrote {FIXTURE_PATH}")
