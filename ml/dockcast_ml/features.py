"""GBM feature builder (docs/ml-spec.md §3.2, docs/worker-spec.md §6.2).

The single function used by both the predictor (online) and the trainer
(offline, WP-6) to build the 39-feature matrix, so train == serve by
construction (ml-spec Invariant L0).

**[decision]** ml-spec's normative "Source rule" (§3.2, features 21-27) states
plainly that `bd_p_bike, bd_p_dock, bd_exp_cnt, bd_A, bd_D, lam_in_now,
lam_out_now` come from the `bd` computation of the current cycle (online) or
`forecast_history` (offline) and are **never recomputed** by the feature
builder. `worker-spec.md`'s per-feature table additionally spells out the
*formula* for `bd_A`/`bd_D` ("online: `Σ_seg rates[...]·m_seg·dt_seg`
... vectorised over stations per t0") for documentation purposes — that
formula is exactly what `bd.forecast_station` (WP-4) already computes into
`BdOut.A`/`BdOut.D`, so it is not a second, independent computation this
module must perform. This module therefore takes all seven values as columns
of `rows` and never touches `ctx.rates`/`ctx.multipliers` for them (matching
the team lead's WP-5 brief). `ctx.rates`/`ctx.rates_ok`/`ctx.multipliers` are
still declared on `FeatureContext` per the worker-spec dataclass shape (a
caller building both the `bd` chain and features from one shared context may
use them), they are just not read inside `build_features`.

**[decision]** `build_features`'s output has a naming collision risk: feature
17 is named `station_pk` and feature 16 is named `h` — the same names a
row-identifying prefix would naturally use for "which station"/"which
horizon". WP-6 (`worker-spec.md` §7.2) does `X_tr[FEATURE_NAMES]`, a
name-based column selection that silently breaks (duplicated columns) if the
output has two columns both named `station_pk`. This implementation therefore
returns exactly `["t0", *FEATURE_NAMES]` (40 columns) — `t0` is the one piece
of row identity not already recoverable from the 39 features (station_pk and
h/horizon *are* features 17 and 16), and no output column name is duplicated.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from dockcast_ml.grid import GridArrays
from dockcast_ml.profile import RollingProfile
from dockcast_ml.timeutil import bucket, day_type, minute_of_day, to_local
from dockcast_ml.weather_asof import WeatherAsOf

FEATURE_SCHEMA_VERSION = 1

FEATURE_NAMES: list[str] = [
    "bikes0", "docks0", "cap0", "fill0", "dbikes_5", "dbikes_15", "dbikes_30", "dbikes_60", "ebikes0",
    "mod", "mod_sin", "mod_cos", "dow", "is_holiday", "daytype", "h", "station_pk", "lat", "lon", "cap_static",
    "bd_p_bike", "bd_p_dock", "bd_exp_cnt", "bd_A", "bd_D", "lam_in_now", "lam_out_now",
    "temp_now", "precip_now", "wind_now", "code_now", "temp_h", "precip_h", "precip_prob_h",
    "nn3_mean_fill", "nn3_mean_dfill_15", "clim_fill", "clim_p_bike", "clim_p_dock",
]
assert len(FEATURE_NAMES) == 39

CATEGORICAL: list[str] = ["dow", "daytype", "station_pk"]
_INT32_FEATURES = frozenset({"dow", "daytype", "station_pk", "h", "mod", "is_holiday"})

_ROWS_REQUIRED_COLS = {
    "station_pk", "t0", "horizon",
    "bd_p_bike", "bd_p_dock", "bd_exp_cnt", "bd_A", "bd_D", "lam_in_now", "lam_out_now",
}
_DBIKES_LOOKBACKS = (5, 15, 30, 60)


@dataclass
class FeatureContext:
    tz: ZoneInfo
    hol: set[date]
    stations: pd.DataFrame  # id, lat, lon, capacity; ordered as grid.station_pks
    grid: GridArrays
    rates: np.ndarray  # (S,3,96,2) float32 -- declared per worker-spec shape; unused here, see module docstring
    rates_ok: np.ndarray  # (S,) bool
    weather: WeatherAsOf
    multipliers: dict[tuple[int, int], float]
    neighbors: np.ndarray  # (S,3) int, row idx into stations/grid, -1 if none
    profile: RollingProfile


def _empty_result() -> pd.DataFrame:
    return pd.DataFrame(columns=["t0", *FEATURE_NAMES])


def _station_snapshot(ctx: FeatureContext, t0: pd.Timestamp) -> tuple[int, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Whole-`S` arrays at `t0`: `(col, bikes, docks, cap, fill, fresh)`."""
    col = ctx.grid.col(t0)
    bikes = ctx.grid.bikes[:, col].astype(np.float64)
    docks = ctx.grid.docks[:, col].astype(np.float64)
    fresh = ctx.grid.fresh[:, col]
    with np.errstate(divide="ignore", invalid="ignore"):
        cap = bikes + docks
        fill = np.where(cap > 0, bikes / np.where(cap > 0, cap, 1.0), np.nan)
    return col, bikes, docks, cap, fill, fresh


def _neighbor_means(
    ctx: FeatureContext,
    cap0: np.ndarray,
    fill0: np.ndarray,
    fresh0: np.ndarray,
    cap15: np.ndarray,
    fill15: np.ndarray,
    fresh15: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """`(nn3_mean_fill, nn3_mean_dfill_15)`, whole-`S` arrays (features 35-36)."""
    neighbor_idx = ctx.neighbors
    has_neighbor = neighbor_idx >= 0
    safe_idx = np.where(has_neighbor, neighbor_idx, 0)

    ok0 = has_neighbor & fresh0[safe_idx] & (cap0[safe_idx] > 0)
    fill0_n = np.where(ok0, fill0[safe_idx], 0.0)
    cnt0 = ok0.sum(axis=1)
    nn3_mean_fill = np.where(cnt0 > 0, fill0_n.sum(axis=1) / np.where(cnt0 > 0, cnt0, 1), np.nan)

    ok_both = ok0 & fresh15[safe_idx] & (cap15[safe_idx] > 0)
    dfill_n = np.where(ok_both, fill0[safe_idx] - fill15[safe_idx], 0.0)
    cnt_both = ok_both.sum(axis=1)
    nn3_mean_dfill_15 = np.where(cnt_both > 0, dfill_n.sum(axis=1) / np.where(cnt_both > 0, cnt_both, 1), np.nan)

    return nn3_mean_fill, nn3_mean_dfill_15


def _build_for_t0(
    ctx: FeatureContext,
    t0: pd.Timestamp,
    group: pd.DataFrame,
    stations_lat: np.ndarray,
    stations_lon: np.ndarray,
    stations_cap: np.ndarray,
) -> pd.DataFrame:
    n = len(group)
    station_pk_arr = group["station_pk"].to_numpy(dtype=np.int64)
    station_row = np.array([ctx.grid.pos[int(pk)] for pk in station_pk_arr], dtype=np.int64)
    horizon_arr = group["horizon"].to_numpy(dtype=np.int64)

    _, bikes0_all, docks0_all, cap0_all, fill0_all, fresh0_all = _station_snapshot(ctx, t0)
    _, bikes15_all, docks15_all, cap15_all, fill15_all, fresh15_all = _station_snapshot(ctx, t0 - timedelta(minutes=15))

    ebikes0_all = ctx.grid.ebikes[:, ctx.grid.col(t0)].astype(np.float64)
    ebikes0_all = np.where(ebikes0_all < 0, np.nan, ebikes0_all)

    dbikes_all: dict[int, np.ndarray] = {}
    for k in _DBIKES_LOOKBACKS:
        col_k = ctx.grid.col(t0 - timedelta(minutes=k))
        bikes_k = ctx.grid.bikes[:, col_k].astype(np.float64)
        fresh_k = ctx.grid.fresh[:, col_k]
        dbikes_all[k] = np.where(fresh_k, bikes0_all - bikes_k, np.nan)

    nn3_mean_fill_all, nn3_mean_dfill_15_all = _neighbor_means(
        ctx, cap0_all, fill0_all, fresh0_all, cap15_all, fill15_all, fresh15_all
    )

    local_t0 = to_local(t0, ctx.tz)
    mod = minute_of_day(local_t0)
    mod_sin = math.sin(2 * math.pi * mod / 1440)
    mod_cos = math.cos(2 * math.pi * mod / 1440)
    dow = local_t0.weekday()
    local_date_t0 = local_t0.date()
    is_holiday = 1 if local_date_t0 in ctx.hol else 0
    daytype_val = day_type(local_date_t0, ctx.hol)

    horizons_present = sorted({int(h) for h in horizon_arr})
    t0_hour = t0.replace(minute=0, second=0, microsecond=0)
    hour_for_h = {h: (t0 + timedelta(minutes=h)).replace(minute=0, second=0, microsecond=0) for h in horizons_present}
    unique_hours = sorted({t0_hour, *hour_for_h.values()})
    w = ctx.weather.at(t0, unique_hours)

    def _num(v: object) -> float:
        return float(v) if pd.notna(v) else float("nan")  # type: ignore[arg-type]

    w_now = w.loc[t0_hour]
    temp_now, precip_now, wind_now, code_now = (
        _num(w_now["temp_c"]), _num(w_now["precip_mm"]), _num(w_now["wind_kmh"]), _num(w_now["weather_code"])
    )

    temp_h_map: dict[int, float] = {}
    precip_h_map: dict[int, float] = {}
    precip_prob_h_map: dict[int, float] = {}
    daytype_h_map: dict[int, int] = {}
    bucket_h_map: dict[int, int] = {}
    for h in horizons_present:
        w_h = w.loc[hour_for_h[h]]
        temp_h_map[h] = _num(w_h["temp_c"])
        precip_h_map[h] = _num(w_h["precip_mm"])
        precip_prob_h_map[h] = _num(w_h["precip_prob"])
        local_t0h = to_local(t0 + timedelta(minutes=h), ctx.tz)
        daytype_h_map[h] = day_type(local_t0h.date(), ctx.hol)
        bucket_h_map[h] = bucket(local_t0h)

    temp_h = np.array([temp_h_map[int(h)] for h in horizon_arr], dtype=np.float64)
    precip_h = np.array([precip_h_map[int(h)] for h in horizon_arr], dtype=np.float64)
    precip_prob_h = np.array([precip_prob_h_map[int(h)] for h in horizon_arr], dtype=np.float64)
    clim_daytype = np.array([daytype_h_map[int(h)] for h in horizon_arr], dtype=np.int64)
    clim_bucket = np.array([bucket_h_map[int(h)] for h in horizon_arr], dtype=np.int64)

    clim_fill, clim_p_bike, clim_p_dock = ctx.profile.lookup(clim_daytype, clim_bucket, station_row)

    dbikes_5 = dbikes_all[5][station_row]
    dbikes_15 = dbikes_all[15][station_row]
    dbikes_30 = dbikes_all[30][station_row]
    dbikes_60 = dbikes_all[60][station_row]

    columns = {
        "bikes0": bikes0_all[station_row],
        "docks0": docks0_all[station_row],
        "cap0": cap0_all[station_row],
        "fill0": fill0_all[station_row],
        "dbikes_5": dbikes_5,
        "dbikes_15": dbikes_15,
        "dbikes_30": dbikes_30,
        "dbikes_60": dbikes_60,
        "ebikes0": ebikes0_all[station_row],
        "mod": np.full(n, mod),
        "mod_sin": np.full(n, mod_sin),
        "mod_cos": np.full(n, mod_cos),
        "dow": np.full(n, dow),
        "is_holiday": np.full(n, is_holiday),
        "daytype": np.full(n, daytype_val),
        "h": horizon_arr,
        "station_pk": station_pk_arr,
        "lat": stations_lat[station_row],
        "lon": stations_lon[station_row],
        "cap_static": stations_cap[station_row],
        "bd_p_bike": group["bd_p_bike"].to_numpy(dtype=np.float64),
        "bd_p_dock": group["bd_p_dock"].to_numpy(dtype=np.float64),
        "bd_exp_cnt": group["bd_exp_cnt"].to_numpy(dtype=np.float64),
        "bd_A": group["bd_A"].to_numpy(dtype=np.float64),
        "bd_D": group["bd_D"].to_numpy(dtype=np.float64),
        "lam_in_now": group["lam_in_now"].to_numpy(dtype=np.float64),
        "lam_out_now": group["lam_out_now"].to_numpy(dtype=np.float64),
        "temp_now": np.full(n, temp_now),
        "precip_now": np.full(n, precip_now),
        "wind_now": np.full(n, wind_now),
        "code_now": np.full(n, code_now),
        "temp_h": temp_h,
        "precip_h": precip_h,
        "precip_prob_h": precip_prob_h,
        "nn3_mean_fill": nn3_mean_fill_all[station_row],
        "nn3_mean_dfill_15": nn3_mean_dfill_15_all[station_row],
        "clim_fill": clim_fill,
        "clim_p_bike": clim_p_bike,
        "clim_p_dock": clim_p_dock,
    }

    frame = pd.DataFrame({"t0": [t0] * n})
    for name in FEATURE_NAMES:
        values = columns[name]
        dtype = np.int32 if name in _INT32_FEATURES else np.float32
        frame[name] = np.asarray(values, dtype=dtype)
    return frame


def build_features(ctx: FeatureContext, rows: pd.DataFrame) -> pd.DataFrame:
    """Build the 39-feature matrix for `rows` (`station_pk, t0, horizon` + the 7 `bd_*`/`lam_*_now`
    stacking columns; see module docstring for their source). Returns
    `["t0", *FEATURE_NAMES]`, row order preserved, dtypes per ml-spec §3.2 (int32 for
    dow/daytype/station_pk/h/mod/is_holiday, float32 for everything else).
    """
    missing = _ROWS_REQUIRED_COLS - set(rows.columns)
    if missing:
        raise ValueError(f"build_features: rows missing columns {sorted(missing)}")
    if rows.empty:
        return _empty_result()

    rows = rows.reset_index(drop=True)
    order = np.arange(len(rows))

    stations_lat = ctx.stations["lat"].to_numpy(dtype=np.float64)
    stations_lon = ctx.stations["lon"].to_numpy(dtype=np.float64)
    stations_cap = pd.to_numeric(ctx.stations["capacity"], errors="coerce").to_numpy(dtype=np.float64)

    frames = []
    for t0, group in rows.groupby("t0", sort=False):
        frame = _build_for_t0(ctx, t0, group, stations_lat, stations_lon, stations_cap)
        frame["_orig_order"] = order[group.index.to_numpy()]
        frames.append(frame)

    result = pd.concat(frames, ignore_index=True).sort_values("_orig_order").drop(columns="_orig_order")
    result = result.reset_index(drop=True)
    assert list(result.columns[-39:]) == FEATURE_NAMES
    return result


def build_labels(grid: GridArrays, rows: pd.DataFrame) -> pd.DataFrame:
    """Add `bikes0, docks0, y_bike, y_dock, y_cnt, label_ok` to `rows` (`station_pk, t0, horizon`).

    `label_ok` = fresh at `t0` and at `t0+h`, and `cap0 >= 1` (ml-spec row-validity rule, §3.1).
    """
    required = {"station_pk", "t0", "horizon"}
    missing = required - set(rows.columns)
    if missing:
        raise ValueError(f"build_labels: rows missing columns {sorted(missing)}")
    if rows.empty:
        return rows.assign(
            bikes0=pd.Series(dtype="int32"),
            docks0=pd.Series(dtype="int32"),
            y_bike=pd.Series(dtype=bool),
            y_dock=pd.Series(dtype=bool),
            y_cnt=pd.Series(dtype="int32"),
            label_ok=pd.Series(dtype=bool),
        )

    rows = rows.reset_index(drop=True)
    order = np.arange(len(rows))
    frames = []
    for t0, group in rows.groupby("t0", sort=False):
        n = len(group)
        station_pk_arr = group["station_pk"].to_numpy(dtype=np.int64)
        station_row = np.array([grid.pos[int(pk)] for pk in station_pk_arr], dtype=np.int64)
        col0 = grid.col(t0)
        bikes0 = grid.bikes[station_row, col0].astype(np.int32)
        docks0 = grid.docks[station_row, col0].astype(np.int32)
        fresh0 = grid.fresh[station_row, col0]
        cap0 = bikes0 + docks0

        horizon_arr = group["horizon"].to_numpy(dtype=np.int64)
        y_bike = np.zeros(n, dtype=bool)
        y_dock = np.zeros(n, dtype=bool)
        y_cnt = np.zeros(n, dtype=np.int32)
        fresh_h = np.zeros(n, dtype=bool)
        for h in sorted({int(x) for x in horizon_arr}):
            mask = horizon_arr == h
            col_h = grid.col(t0 + timedelta(minutes=h))
            rows_idx = station_row[mask]
            y_bike[mask] = grid.bikes[rows_idx, col_h] >= 1
            y_dock[mask] = grid.docks[rows_idx, col_h] >= 1
            y_cnt[mask] = grid.bikes[rows_idx, col_h]
            fresh_h[mask] = grid.fresh[rows_idx, col_h]

        label_ok = fresh0 & fresh_h & (cap0 >= 1)
        extra = pd.DataFrame(
            {
                "bikes0": bikes0,
                "docks0": docks0,
                "y_bike": y_bike,
                "y_dock": y_dock,
                "y_cnt": y_cnt,
                "label_ok": label_ok,
            },
            index=group.index,
        )
        frame = pd.concat([group, extra], axis=1)
        frame["_orig_order"] = order[group.index.to_numpy()]
        frames.append(frame)

    result = pd.concat(frames, ignore_index=True).sort_values("_orig_order").drop(columns="_orig_order")
    return result.reset_index(drop=True)


__all__ = ["FEATURE_SCHEMA_VERSION", "FEATURE_NAMES", "CATEGORICAL", "FeatureContext", "build_features", "build_labels"]
