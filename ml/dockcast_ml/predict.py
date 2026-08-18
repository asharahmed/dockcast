"""Predictor loop (docs/ml-spec.md §6, docs/worker-spec.md §8.1).

Every `PREDICT_INTERVAL_SEC` (default 300 s), for each `forecasting_enabled`
city: compute the `bd` baseline for every station with a fresh state and
capacity, build the 39-feature matrix, score `gbm_active`/`gbm_shadow` if
loaded, calibrate, pick the serving tier, and upsert `forecasts_latest` (all
stations with a `station_current` row) plus, on 15-minute-grid origins,
append every tier to `forecast_history`.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import numpy as np
import pandas as pd
import psycopg

from dockcast_ml import db
from dockcast_ml.bd import BdOut, TransitionCache, forecast_station
from dockcast_ml.config import Config
from dockcast_ml.features import (
    FEATURE_NAMES,
    FEATURE_SCHEMA_VERSION,
    FeatureContext,
    build_features,
)
from dockcast_ml.gbfs_ids import load_stations
from dockcast_ml.grid import load_city_grid
from dockcast_ml.horizons import HORIZONS
from dockcast_ml.models import artifact
from dockcast_ml.models.artifact import BdBundle, GbmBundle
from dockcast_ml.models.calibration import apply_calibrators
from dockcast_ml.profile import RollingProfile
from dockcast_ml.segments import bucket as seg_bucket
from dockcast_ml.segments import build_segments, lookup_multiplier
from dockcast_ml.timeutil import ceil_to, day_type, holiday_set, tz_of
from dockcast_ml.weather_asof import load_weather_window

logger = logging.getLogger("dockcast_ml.predict")

_LOOKBACK_MIN = 61
_RATES_RELOAD_INTERVAL = timedelta(hours=1)


@dataclass
class PredictState:
    active: GbmBundle | None = None
    active_id: int | None = None
    shadow: GbmBundle | None = None
    shadow_id: int | None = None
    bd_cal: BdBundle | None = None
    bd_id: int | None = None
    max_seen_version_id: int = 0
    rates: np.ndarray | None = None  # (S,3,96,2) float32
    rates_ok: np.ndarray | None = None  # (S,) bool
    multipliers: dict[tuple[int, int], float] = field(default_factory=dict)
    neighbors: np.ndarray | None = None  # (S,3) int, -1 if none
    profile: RollingProfile | None = None
    rates_loaded_at: datetime | None = None
    station_pks_cached: np.ndarray | None = None


def _reload_models(conn: psycopg.Connection, city_id: int, state: PredictState) -> None:
    row = db.fetch_df(conn, "SELECT max(id) AS m FROM model_versions WHERE city_id=%(c)s", {"c": city_id})
    max_id_val = row["m"].iloc[0] if not row.empty else None
    max_id = int(max_id_val) if max_id_val is not None and pd.notna(max_id_val) else 0
    if max_id <= state.max_seen_version_id:
        return

    state.active, state.active_id = None, None
    state.shadow, state.shadow_id = None, None
    state.bd_cal, state.bd_id = None, None

    for mv_id, tier, status, bundle in artifact.load_serving_set(conn, city_id):
        if tier == "bd":
            if status == "active" and isinstance(bundle, BdBundle):
                state.bd_cal, state.bd_id = bundle, mv_id
            continue
        if not isinstance(bundle, GbmBundle):
            continue
        if bundle.feature_schema_version != FEATURE_SCHEMA_VERSION:
            logger.error(
                "gbm bundle feature_schema_version mismatch, ignoring",
                extra={"model_version_id": mv_id, "bundle_version": bundle.feature_schema_version},
            )
            continue
        if status == "active":
            state.active, state.active_id = bundle, mv_id
        elif status == "shadow":
            state.shadow, state.shadow_id = bundle, mv_id

    state.max_seen_version_id = max_id


def _reload_context(
    conn: psycopg.Connection, city_id: int, station_pks: np.ndarray, tz: object, t0: datetime, state: PredictState
) -> None:
    pks_list = [int(x) for x in station_pks]
    pos = {int(pk): i for i, pk in enumerate(station_pks)}
    s = len(station_pks)

    rates_df = db.fetch_df(
        conn,
        "SELECT station_pk, day_type, bucket, lam_in_per_min, lam_out_per_min "
        "FROM station_flow_rates WHERE station_pk = ANY(%(pks)s)",
        {"pks": pks_list},
    )
    rates = np.zeros((s, 3, 96, 2), dtype=np.float32)
    counts = np.zeros(s, dtype=np.int32)
    if not rates_df.empty:
        for r in rates_df.itertuples(index=False):
            i = pos.get(int(r.station_pk))
            if i is None:
                continue
            rates[i, int(r.day_type), int(r.bucket), 0] = r.lam_in_per_min
            rates[i, int(r.day_type), int(r.bucket), 1] = r.lam_out_per_min
            counts[i] += 1
    rates_ok = counts >= (3 * 96)

    mult_df = db.fetch_df(conn, "SELECT temp_bin, precip_bin, m FROM weather_multipliers WHERE city_id=%(c)s", {"c": city_id})
    multipliers = (
        {(int(r.temp_bin), int(r.precip_bin)): float(r.m) for r in mult_df.itertuples(index=False)}
        if not mult_df.empty
        else {}
    )
    if not multipliers:
        logger.warning("no weather_multipliers rows for city, using m=1.0 everywhere", extra={"city_id": city_id})

    neigh_df = db.fetch_df(
        conn,
        "SELECT station_pk, neighbor_pk, rank FROM station_neighbors WHERE station_pk = ANY(%(pks)s)",
        {"pks": pks_list},
    )
    neighbors = np.full((s, 3), -1, dtype=np.int64)
    if not neigh_df.empty:
        for r in neigh_df.itertuples(index=False):
            i = pos.get(int(r.station_pk))
            j = pos.get(int(r.neighbor_pk))
            rank = int(r.rank)
            if i is not None and j is not None and 1 <= rank <= 3:
                neighbors[i, rank - 1] = j

    profile = RollingProfile.from_table(conn, city_id, tz, station_pks)

    state.rates = rates
    state.rates_ok = rates_ok
    state.multipliers = multipliers
    state.neighbors = neighbors
    state.profile = profile
    state.rates_loaded_at = t0
    state.station_pks_cached = station_pks.copy()


def _needs_context_reload(state: PredictState, station_pks: np.ndarray, t0: datetime) -> bool:
    if state.rates is None or state.rates_loaded_at is None or state.station_pks_cached is None:
        return True
    if not np.array_equal(state.station_pks_cached, station_pks):
        return True
    return (t0 - state.rates_loaded_at) >= _RATES_RELOAD_INTERVAL


_FORECASTS_LATEST_COLS = [
    "station_pk", "horizon", "t0", "valid_at", "p_bike", "p_dock", "exp_bikes",
    "q10", "q90", "tier", "model_version_id", "reason",
]
_FORECAST_HISTORY_COLS = [
    "station_pk", "t0", "horizon", "tier", "p_bike", "p_dock", "exp_bikes",
    "model_version_id", "bd_a", "bd_d", "lam_in", "lam_out",
]


def predict_once(cfg: Config, conn: psycopg.Connection, city: dict, t0: datetime, state: PredictState) -> dict:
    t_start = time.monotonic()
    city_id = int(city["id"])
    tz = tz_of(city["tz"])
    local_year = t0.astimezone(tz).year
    hol = holiday_set(city["holiday_country"], city["holiday_subdiv"], [local_year - 1, local_year, local_year + 1])

    stations_df = load_stations(conn, city_id, active_only=True)
    station_pks = stations_df["id"].to_numpy(dtype=np.int32)
    pos = {int(pk): i for i, pk in enumerate(station_pks)}

    cur_df = db.fetch_df(conn, "SELECT * FROM station_state_fresh WHERE city_id=%(c)s", {"c": city_id})
    cur_by_pk = cur_df.set_index("station_pk") if not cur_df.empty else None

    _reload_models(conn, city_id, state)
    if _needs_context_reload(state, station_pks, t0):
        _reload_context(conn, city_id, station_pks, tz, t0, state)
    assert state.rates is not None and state.rates_ok is not None and state.profile is not None

    weather = load_weather_window(conn, city_id, t0, t0)
    segs = build_segments(t0, tz, hol, weather, state.multipliers)

    grid = load_city_grid(conn, city_id, station_pks, t0 - timedelta(minutes=_LOOKBACK_MIN), t0)
    col0 = grid.col(t0)

    t0_hour = t0.replace(minute=0, second=0, microsecond=0)
    w_now = weather.at(t0, [t0_hour]).iloc[0]
    temp_now = float(w_now["temp_c"]) if pd.notna(w_now["temp_c"]) else None
    precip_now = float(w_now["precip_mm"]) if pd.notna(w_now["precip_mm"]) else None
    m_now = lookup_multiplier(temp_now, precip_now, state.multipliers)
    local_t0 = t0.astimezone(tz)
    daytype_t0 = day_type(local_t0.date(), hol)
    bucket_t0 = seg_bucket(local_t0)

    t_bd_start = time.monotonic()
    bd_cache: TransitionCache = {}
    reasons: dict[int, str] = {}
    bd_by_station: dict[int, dict[int, BdOut]] = {}
    n_not_fresh = n_zero_capacity = n_no_rates = 0
    have_current: list[int] = []

    for pk in station_pks:
        pk_int = int(pk)
        if cur_by_pk is None or pk_int not in cur_by_pk.index:
            continue
        have_current.append(pk_int)
        row = cur_by_pk.loc[pk_int]
        i = pos[pk_int]
        is_fresh = bool(row["is_fresh"])
        bikes0 = int(grid.bikes[i, col0])
        docks0 = int(grid.docks[i, col0])
        if not is_fresh or bikes0 < 0 or docks0 < 0:
            reasons[pk_int] = "not_fresh"
            n_not_fresh += 1
            continue
        cap0 = bikes0 + docks0
        if cap0 == 0:
            reasons[pk_int] = "zero_capacity"
            n_zero_capacity += 1
            continue
        if not bool(state.rates_ok[i]):
            reasons[pk_int] = "no_rates"
            n_no_rates += 1
            continue

        bd_out = forecast_station(bikes0, cap0, state.rates[i], segs, horizons=HORIZONS, cache=bd_cache)
        bd_by_station[pk_int] = bd_out

    ms_bd = (time.monotonic() - t_bd_start) * 1000

    t_feat_start = time.monotonic()
    row_records = []
    for pk_int, bd_out in bd_by_station.items():
        i = pos[pk_int]
        lam_in_now = float(state.rates[i, daytype_t0, bucket_t0, 0]) * m_now
        lam_out_now = float(state.rates[i, daytype_t0, bucket_t0, 1]) * m_now
        for h in HORIZONS:
            out = bd_out[h]
            row_records.append(
                {
                    "station_pk": pk_int,
                    "t0": t0,
                    "horizon": h,
                    "bd_p_bike": out.p_bike,
                    "bd_p_dock": out.p_dock,
                    "bd_exp_cnt": out.exp,
                    "bd_A": out.A,
                    "bd_D": out.D,
                    "lam_in_now": lam_in_now,
                    "lam_out_now": lam_out_now,
                    "q10": out.q10,
                    "q90": out.q90,
                }
            )
    rows = pd.DataFrame(row_records) if row_records else pd.DataFrame(
        columns=[
            "station_pk", "t0", "horizon", "bd_p_bike", "bd_p_dock", "bd_exp_cnt",
            "bd_A", "bd_D", "lam_in_now", "lam_out_now", "q10", "q90",
        ]
    )

    ctx = FeatureContext(
        tz=tz, hol=hol, stations=stations_df, grid=grid, rates=state.rates, rates_ok=state.rates_ok,
        weather=weather, multipliers=state.multipliers, neighbors=state.neighbors, profile=state.profile,
    )
    feature_cols = ["station_pk", "t0", "horizon", "bd_p_bike", "bd_p_dock", "bd_exp_cnt", "bd_A", "bd_D", "lam_in_now", "lam_out_now"]
    x = build_features(ctx, rows[feature_cols]) if not rows.empty else None
    ms_features = (time.monotonic() - t_feat_start) * 1000

    cap0_arr = None
    gbm_active_out = gbm_shadow_out = None
    if not rows.empty:
        cap0_arr = x["cap0"].to_numpy(dtype=np.float64)
        horizon_arr_x = x["h"].to_numpy(dtype=np.int64)
        if state.active is not None:
            gbm_active_out = _score_gbm(state.active, x, cap0_arr, horizon_arr_x)
        if state.shadow is not None:
            gbm_shadow_out = _score_gbm(state.shadow, x, cap0_arr, horizon_arr_x)

    bd_cal_active = state.bd_cal is not None and bool(state.bd_cal.calibrators)
    bd_cal_out = None
    if bd_cal_active and not rows.empty:
        assert state.bd_cal is not None
        h_arr = rows["horizon"].to_numpy(dtype=np.int64)
        bd_cal_out = {
            "p_bike": apply_calibrators(state.bd_cal.calibrators.get("bike", {}), rows["bd_p_bike"].to_numpy(), h_arr),
            "p_dock": apply_calibrators(state.bd_cal.calibrators.get("dock", {}), rows["bd_p_dock"].to_numpy(), h_arr),
        }

    if state.active is not None:
        serving_tier = "gbm"
    elif bd_cal_active:
        serving_tier = "bd_cal"
    else:
        serving_tier = "bd_raw"

    latest_records = []
    for pk_int in have_current:
        if pk_int not in bd_by_station:
            reason = reasons[pk_int]
            for h in HORIZONS:
                latest_records.append(
                    {
                        "station_pk": pk_int, "horizon": h, "t0": t0, "valid_at": t0 + timedelta(minutes=h),
                        "p_bike": None, "p_dock": None, "exp_bikes": None, "q10": None, "q90": None,
                        "tier": "none", "model_version_id": None, "reason": reason,
                    }
                )

    if not rows.empty:
        assert x is not None
        row_station = rows["station_pk"].to_numpy(dtype=np.int64)
        row_horizon = rows["horizon"].to_numpy(dtype=np.int64)
        row_q10 = rows["q10"].to_numpy()
        row_q90 = rows["q90"].to_numpy()
        for j in range(len(rows)):
            pk_int = int(row_station[j])
            h = int(row_horizon[j])
            if serving_tier == "gbm" and gbm_active_out is not None:
                p_bike, p_dock, exp_bikes = gbm_active_out["p_bike"][j], gbm_active_out["p_dock"][j], gbm_active_out["exp_bikes"][j]
                model_version_id = state.active_id
            elif serving_tier == "bd_cal" and bd_cal_out is not None:
                p_bike, p_dock = bd_cal_out["p_bike"][j], bd_cal_out["p_dock"][j]
                exp_bikes = rows["bd_exp_cnt"].to_numpy()[j]
                model_version_id = state.bd_id
            else:
                p_bike, p_dock, exp_bikes = rows["bd_p_bike"].to_numpy()[j], rows["bd_p_dock"].to_numpy()[j], rows["bd_exp_cnt"].to_numpy()[j]
                model_version_id = None
            latest_records.append(
                {
                    "station_pk": pk_int, "horizon": h, "t0": t0, "valid_at": t0 + timedelta(minutes=h),
                    "p_bike": float(p_bike), "p_dock": float(p_dock), "exp_bikes": float(exp_bikes),
                    "q10": int(row_q10[j]), "q90": int(row_q90[j]),
                    "tier": serving_tier, "model_version_id": model_version_id, "reason": None,
                }
            )

    # Built directly from the list of dicts (not via a pandas DataFrame): forecasts_latest mixes
    # None (skipped stations) and float/int (forecasted stations) in the same columns, and a
    # DataFrame would silently upcast None -> NaN in those columns (pandas' usual float-column
    # coercion), which `upsert_rows`/`executemany` -- unlike `copy_df` -- does not sanitise back
    # to NULL, breaking inserts into the smallint columns (q10/q90/horizon).
    with conn.cursor() as cur:
        db.upsert_rows(
            cur,
            "forecasts_latest",
            _FORECASTS_LATEST_COLS,
            ["station_pk", "horizon"],
            ["t0", "valid_at", "p_bike", "p_dock", "exp_bikes", "q10", "q90", "tier", "model_version_id", "reason"],
            (tuple(r[c] for c in _FORECASTS_LATEST_COLS) for r in latest_records),
        )
    conn.commit()

    n_history = 0
    if t0.minute % 15 == 0 and not rows.empty:
        history_records = []
        row_station = rows["station_pk"].to_numpy(dtype=np.int64)
        row_horizon = rows["horizon"].to_numpy(dtype=np.int64)
        for j in range(len(rows)):
            pk_int = int(row_station[j])
            h = int(row_horizon[j])
            history_records.append(
                {
                    "station_pk": pk_int, "t0": t0, "horizon": h, "tier": "bd_raw",
                    "p_bike": float(rows["bd_p_bike"].to_numpy()[j]), "p_dock": float(rows["bd_p_dock"].to_numpy()[j]),
                    "exp_bikes": float(rows["bd_exp_cnt"].to_numpy()[j]), "model_version_id": None,
                    "bd_a": float(rows["bd_A"].to_numpy()[j]), "bd_d": float(rows["bd_D"].to_numpy()[j]),
                    "lam_in": float(rows["lam_in_now"].to_numpy()[j]), "lam_out": float(rows["lam_out_now"].to_numpy()[j]),
                }
            )
            if bd_cal_out is not None:
                history_records.append(
                    {
                        "station_pk": pk_int, "t0": t0, "horizon": h, "tier": "bd_cal",
                        "p_bike": float(bd_cal_out["p_bike"][j]), "p_dock": float(bd_cal_out["p_dock"][j]),
                        "exp_bikes": float(rows["bd_exp_cnt"].to_numpy()[j]), "model_version_id": state.bd_id,
                        "bd_a": None, "bd_d": None, "lam_in": None, "lam_out": None,
                    }
                )
            if gbm_active_out is not None:
                history_records.append(
                    {
                        "station_pk": pk_int, "t0": t0, "horizon": h, "tier": "gbm_active",
                        "p_bike": float(gbm_active_out["p_bike"][j]), "p_dock": float(gbm_active_out["p_dock"][j]),
                        "exp_bikes": float(gbm_active_out["exp_bikes"][j]), "model_version_id": state.active_id,
                        "bd_a": None, "bd_d": None, "lam_in": None, "lam_out": None,
                    }
                )
            if gbm_shadow_out is not None:
                history_records.append(
                    {
                        "station_pk": pk_int, "t0": t0, "horizon": h, "tier": "gbm_shadow",
                        "p_bike": float(gbm_shadow_out["p_bike"][j]), "p_dock": float(gbm_shadow_out["p_dock"][j]),
                        "exp_bikes": float(gbm_shadow_out["exp_bikes"][j]), "model_version_id": state.shadow_id,
                        "bd_a": None, "bd_d": None, "lam_in": None, "lam_out": None,
                    }
                )
        history_df = pd.DataFrame(history_records, columns=_FORECAST_HISTORY_COLS)
        n_history = len(history_df)
        # `ON COMMIT DROP` needs the CREATE/COPY/INSERT to share one transaction even when `conn`
        # is autocommit (each autocommit statement is otherwise its own transaction, which would
        # drop the temp table before the COPY runs) -- `conn.transaction()` gives that in both cases.
        with conn.transaction(), conn.cursor() as cur:
            cur.execute("CREATE TEMP TABLE tmp_forecast_history (LIKE forecast_history INCLUDING DEFAULTS) ON COMMIT DROP")
            db.copy_df(cur, "tmp_forecast_history", history_df)
            cur.execute(
                "INSERT INTO forecast_history SELECT * FROM tmp_forecast_history "
                "ON CONFLICT (station_pk, t0, horizon, tier) DO NOTHING"
            )

    ms_total = (time.monotonic() - t_start) * 1000
    if ms_total > cfg.predict_interval_sec * 500:  # > half the interval, in ms
        logger.warning("predict_once exceeded half the predict interval", extra={"ms_total": ms_total, "city_id": city_id})

    return {
        "t0": t0.isoformat(),
        "n_stations": len(have_current),
        "n_forecast": len(bd_by_station),
        "n_not_fresh": n_not_fresh,
        "n_zero_capacity": n_zero_capacity,
        "n_no_rates": n_no_rates,
        "n_history_rows": n_history,
        "serving_tier": serving_tier,
        "active_id": state.active_id,
        "shadow_id": state.shadow_id,
        "bd_cal_id": state.bd_id if bd_cal_active else None,
        "ms_bd": round(ms_bd, 1),
        "ms_features": round(ms_features, 1),
        "ms_total": round(ms_total, 1),
    }


def _score_gbm(bundle: GbmBundle, x: pd.DataFrame, cap0_arr: np.ndarray, horizon_arr: np.ndarray) -> dict[str, np.ndarray]:
    boosters = artifact.boosters_of(bundle)
    feat = x[FEATURE_NAMES]
    raw_bike = boosters["bike"].predict(feat, num_iteration=boosters["bike"].best_iteration)
    raw_dock = boosters["dock"].predict(feat, num_iteration=boosters["dock"].best_iteration)
    raw_cnt = boosters["cnt"].predict(feat, num_iteration=boosters["cnt"].best_iteration)
    p_bike = apply_calibrators(bundle.calibrators.get("bike", {}), np.asarray(raw_bike), horizon_arr)
    p_dock = apply_calibrators(bundle.calibrators.get("dock", {}), np.asarray(raw_dock), horizon_arr)
    exp_bikes = np.clip(np.asarray(raw_cnt), 0.0, cap0_arr)
    return {"p_bike": p_bike, "p_dock": p_dock, "exp_bikes": exp_bikes}


def loop(cfg: Config, city_slug: str | None = None) -> None:
    """`while True`: sleep to the next `PREDICT_INTERVAL_SEC` boundary from the epoch, then run
    `predict_once` for every `forecasting_enabled` city (or just `city_slug`, if given) under its
    own `worker_run`.
    """
    states: dict[int, PredictState] = {}
    conn = db.connect(cfg, autocommit=False)
    try:
        while True:
            now = datetime.now(UTC)
            t0 = ceil_to(now, cfg.predict_interval_sec)
            sleep_s = (t0 - datetime.now(UTC)).total_seconds()
            if sleep_s > 0:
                time.sleep(sleep_s)

            if city_slug:
                cities = db.fetch_df(conn, "SELECT * FROM cities WHERE slug=%(s)s", {"s": city_slug}).to_dict("records")
            else:
                cities = db.fetch_df(conn, "SELECT * FROM cities WHERE forecasting_enabled", None).to_dict("records")
            for city in cities:
                city_id = int(city["id"])
                state = states.setdefault(city_id, PredictState())
                try:
                    with db.worker_run(cfg, "predict", city_id) as summary:
                        summary.update(predict_once(cfg, conn, city, t0, state))
                    conn.commit()
                except Exception:
                    logger.exception("predict_once failed", extra={"city_id": city_id, "t0": t0.isoformat()})
                    # The connection is non-autocommit: without a rollback an aborted transaction
                    # would poison every later statement ("current transaction is aborted").
                    try:
                        conn.rollback()
                    except Exception:
                        logger.exception("rollback failed; reconnecting")
                        conn.close()
                        conn = db.connect(cfg, autocommit=False)
            # End the implicit transaction opened by the cities SELECT so we don't sit
            # "idle in transaction" (holding a snapshot) for the whole sleep.
            conn.commit()
    finally:
        conn.close()


__all__ = ["PredictState", "predict_once", "loop"]
