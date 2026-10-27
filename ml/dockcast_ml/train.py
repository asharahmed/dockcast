"""Nightly trainer job (docs/ml-spec.md §7 + §3.3 + §5, docs/worker-spec.md §8.2).

Operational order (worker-spec.md decision — labels precede row building):
1. rebuild `station_neighbors`
2. materialise `forecast_labels`
3. rebuild `station_tod_profile` for the coming local day
4. refit `bd` calibrators -> a `bd` `model_versions` row is written on *every* run
5. row universe & splits; if <14 local days with rows -> `gbm` `insufficient_data` row,
   skip straight to online metrics
6. per-day, memory-safe row + feature build for `train`/`es`/`val`
7. train the three boosters, calibrate on `es`
8. score every tier on the same `val` rows, gate, write `model_versions`/`model_eval`
9. online metrics (windows 1 and 7)
10. housekeeping (drop old `weather_forecasts`)
11. summary log + healthchecks ping
"""

from __future__ import annotations

import json
import logging
import math
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import pandas as pd
import psycopg
from psycopg.rows import dict_row
from psycopg.types.range import Range

from dockcast_ml import db, metrics_online, neighbors
from dockcast_ml.config import Config
from dockcast_ml.evaluate import Preds, metric_rows
from dockcast_ml.features import (
    FEATURE_NAMES,
    FEATURE_SCHEMA_VERSION,
    FeatureContext,
    build_features,
)
from dockcast_ml.gate import evaluate_gate
from dockcast_ml.gbfs_ids import load_stations
from dockcast_ml.grid import load_city_grid
from dockcast_ml.labels import materialise_labels
from dockcast_ml.memory import log_memory, release
from dockcast_ml.models import gbm as gbm_mod
from dockcast_ml.models.artifact import BdBundle, GbmBundle, boosters_of, dumps, load_active
from dockcast_ml.models.calibration import apply_calibrators, fit_calibrators
from dockcast_ml.profile import build_rolling_profile, write_table
from dockcast_ml.timeutil import day_type, holiday_set, local_midnight, tz_of
from dockcast_ml.weather_asof import load_weather_window

logger = logging.getLogger("dockcast_ml.train")

_ROW_CAPS = {"train": 3_000_000, "es": 1_000_000, "val": 2_000_000}
_MIN_LOCAL_DAYS = 14
_MIN_ROWS_FOR_BD_CAL = 50_000
_SEED = 42

_ROW_SELECT = """
    h.station_pk, h.t0, h.horizon,
    h.p_bike AS bd_p_bike, h.p_dock AS bd_p_dock, h.exp_bikes AS bd_exp_cnt,
    h.bd_a AS "bd_A", h.bd_d AS "bd_D", h.lam_in AS lam_in_now, h.lam_out AS lam_out_now,
    l.bikes0, l.docks0, l.y_bike, l.y_dock, l.y_cnt
"""
# Note: the "bd_A"/"bd_D" aliases are double-quoted -- Postgres folds unquoted identifiers to
# lowercase, and `features.build_features` requires the exact mixed-case column names
# `bd_A`/`bd_D` (matching `FEATURE_NAMES`), so an unquoted `AS bd_A` would silently come back
# as `bd_a` and fail `build_features`'s required-columns check.
_ROW_FROM_WHERE = """
    FROM forecast_history h
    JOIN forecast_labels l USING (station_pk, t0, horizon)
    JOIN stations s ON s.id = h.station_pk
    WHERE s.city_id = %(city_id)s AND s.is_active AND h.tier = 'bd_raw'
      AND h.t0 >= %(day_start)s AND h.t0 < %(day_end)s
"""
_ROW_SQL = f"SELECT {_ROW_SELECT} {_ROW_FROM_WHERE}"
_ROW_COUNT_SQL = f"SELECT count(*) AS n {_ROW_FROM_WHERE}"

# Only the columns the calibrators use: station_pk and t0 would be boxed per row for nothing.
_BD_CAL_SQL = """
SELECT h.horizon, h.p_bike, h.p_dock, l.y_bike, l.y_dock
FROM forecast_history h
JOIN forecast_labels l USING (station_pk, t0, horizon)
JOIN stations s ON s.id = h.station_pk
WHERE s.city_id = %(city_id)s AND s.is_active AND h.tier = 'bd_raw'
  AND h.t0 >= %(a)s AND h.t0 < %(b)s
"""

# p_bike/p_dock stay float64 for the same reason as the real columns in _ROW_DTYPES below.
_BD_CAL_DTYPES = {"horizon": "int16", "y_bike": "bool", "y_dock": "bool"}

_DATA_DAYS_SQL = """
SELECT DISTINCT (h.t0 AT TIME ZONE %(tz)s)::date AS d
FROM forecast_history h JOIN stations s ON s.id = h.station_pk
WHERE s.city_id = %(city_id)s AND s.is_active AND h.tier = 'bd_raw'
  AND h.t0 >= %(t_from)s AND h.t0 < %(t_to)s
"""

_FEATURE_INPUT_COLS = [
    "station_pk", "t0", "horizon",
    "bd_p_bike", "bd_p_dock", "bd_exp_cnt", "bd_A", "bd_D", "lam_in_now", "lam_out_now",
]
# Narrow dtypes for the per-day row read. Integer and boolean columns only: the real columns stay
# float64 because the text protocol hands psycopg a decimal string, and float32 would round it
# differently from the float64 the features were built from before.
_ROW_DTYPES = {
    "station_pk": "int32",
    "bikes0": "int16",
    "docks0": "int16",
    "y_bike": "bool",
    "y_dock": "bool",
    "y_cnt": "int16",
}
_LIGHT_COLS = [
    "station_pk", "t0", "horizon", "bikes0", "docks0", "y_bike", "y_dock", "y_cnt",
    "bd_p_bike", "bd_p_dock", "bd_exp_cnt",
]


class _SplitBuffer:
    """Feature matrix (float32) and labels for one split, filled day by day into arrays
    allocated once at the expected final size (the capped per-day row counts), so no second
    full-size copy is ever made. If the rows read differ from the counts (data written between
    the count pass and the read), the arrays grow or are trimmed; order is always append order.
    """

    def __init__(self, expected_rows: int) -> None:
        self.n = 0
        self._alloc(max(expected_rows, 1))

    def _alloc(self, capacity: int) -> None:
        self.x = np.empty((capacity, len(FEATURE_NAMES)), dtype=np.float32)
        self.y = {
            "bike": np.empty(capacity, dtype=np.int8),
            "dock": np.empty(capacity, dtype=np.int8),
            "cnt": np.empty(capacity, dtype=np.float32),
        }

    def append(self, x: np.ndarray, y_bike: np.ndarray, y_dock: np.ndarray, y_cnt: np.ndarray) -> None:
        end = self.n + len(x)
        if end > len(self.x):
            old_x, old_y, n = self.x, self.y, self.n
            self._alloc(max(end, 2 * len(old_x)))
            self.x[:n] = old_x[:n]
            for k in old_y:
                self.y[k][:n] = old_y[k][:n]
        self.x[self.n : end] = x
        self.y["bike"][self.n : end] = y_bike
        self.y["dock"][self.n : end] = y_dock
        self.y["cnt"][self.n : end] = y_cnt
        self.n = end

    def finish(self) -> tuple[np.ndarray, dict[str, np.ndarray]]:
        """`(x, y)` of exactly the rows appended; the buffer must not be used afterwards."""
        if self.n != len(self.x):
            self.x = self.x[: self.n].copy()
            self.y = {k: v[: self.n].copy() for k, v in self.y.items()}
        x, y = self.x, self.y
        del self.x, self.y
        return x, y


def _json_safe(obj: Any) -> Any:
    """Recursively replace non-finite floats with `None` (jsonb rejects `NaN`/`Infinity`)."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list | tuple):
        return [_json_safe(v) for v in obj]
    return obj


def _write_model_version(
    conn: psycopg.Connection,
    city_id: int,
    tier: str,
    status: str,
    trained_for_date: date,
    train_window: tuple[datetime, datetime] | None,
    feature_schema_version: int,
    git_sha: str,
    hyperparams: dict | None,
    metrics_val: dict | None,
    gate_json: dict | None,
    artifact_bytes: bytes | None,
) -> int:
    """docs/worker-spec.md §8.4 activation SQL: delete-then-insert per `(city,tier,date)`,
    superseding the previous `active` (or, for a gbm `shadow`, the previous `shadow`).
    """
    tw = Range(train_window[0], train_window[1], bounds="[)") if train_window is not None else None
    # Explicit row_factory: callers may pass a connection with either a tuple- or dict-row
    # default (e.g. the test suite's `db_conn` fixture is tuple-row; production `db.connect()`
    # is dict-row), so this cursor's row shape must not depend on the connection's default.
    with conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "DELETE FROM model_versions WHERE city_id=%s AND tier=%s AND trained_for_date=%s",
            (city_id, tier, trained_for_date),
        )
        if status == "active":
            cur.execute(
                "UPDATE model_versions SET status='superseded', deactivated_at=now() "
                "WHERE city_id=%s AND tier=%s AND status='active'",
                (city_id, tier),
            )
        if status == "shadow":
            cur.execute(
                "UPDATE model_versions SET status='superseded', deactivated_at=now() "
                "WHERE city_id=%s AND tier='gbm' AND status='shadow'",
                (city_id,),
            )
        cur.execute(
            """
            INSERT INTO model_versions
                (city_id, tier, status, feature_schema_version, trained_for_date, train_window,
                 git_sha, hyperparams, metrics_val, gate, artifact, activated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s,
                    CASE WHEN %s = 'active' THEN now() END)
            RETURNING id
            """,
            (
                city_id,
                tier,
                status,
                feature_schema_version,
                trained_for_date,
                tw,
                git_sha,
                json.dumps(_json_safe(hyperparams)) if hyperparams is not None else None,
                json.dumps(_json_safe(metrics_val)) if metrics_val is not None else None,
                json.dumps(_json_safe(gate_json)) if gate_json is not None else None,
                artifact_bytes,
                status,
            ),
        )
        row = cur.fetchone()
        assert row is not None
        return int(row["id"])


def _update_metrics_val(conn: psycopg.Connection, model_version_id: int, metrics_val: dict) -> None:
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            "UPDATE model_versions SET metrics_val=%s::jsonb WHERE id=%s",
            (json.dumps(_json_safe(metrics_val)), model_version_id),
        )


def _write_model_eval(conn: psycopg.Connection, model_version_id: int, split: str, rows: list[dict]) -> int:
    """Transform `evaluate.metric_rows` dicts (`{tier,target,horizon,slice,metric,value,n}`)
    into `model_eval` rows (`tier` is part of the key since migration 0002; `n` becomes its own
    `metric='n'` row per `(tier,target,horizon,slice)`).
    """
    out_rows: list[tuple] = []
    seen_n: set[tuple[str, str, int, str]] = set()
    for r in rows:
        tier = str(r.get("tier", "gbm"))
        key = (tier, r["target"], r["horizon"], r["slice"])
        out_rows.append(
            (model_version_id, tier, split, r["target"], r["horizon"], r["slice"], r["metric"], r["value"])
        )
        if key not in seen_n:
            seen_n.add(key)
            out_rows.append(
                (model_version_id, tier, split, r["target"], r["horizon"], r["slice"], "n", float(r["n"]))
            )
    if not out_rows:
        return 0
    with conn.transaction(), conn.cursor() as cur:
        db.copy_rows(
            cur,
            "model_eval",
            ["model_version_id", "tier", "split", "target", "horizon", "slice", "metric", "value"],
            out_rows,
        )
    return len(out_rows)


def _pooled(rows: list[dict]) -> dict[str, float]:
    """`{'brier_bike','brier_dock','ece_bike','ece_dock','mae'}` at horizon 0, slice 'all'."""
    by_key = {(r["target"], r["metric"]): r["value"] for r in rows if r["horizon"] == 0 and r["slice"] == "all"}
    return {
        "brier_bike": by_key.get(("bike", "brier"), float("nan")),
        "brier_dock": by_key.get(("dock", "brier"), float("nan")),
        "ece_bike": by_key.get(("bike", "ece"), float("nan")),
        "ece_dock": by_key.get(("dock", "ece"), float("nan")),
        "mae": by_key.get(("cnt", "mae"), float("nan")),
    }


def _metrics_val_json(
    rows: list[dict], n_val: int, ref: dict[str, Any] | None, best_iter: dict[str, int] | None = None
) -> dict:
    by_key = {(r["target"], r["horizon"], r["slice"], r["metric"]): r["value"] for r in rows}

    def g(target: str, metric: str, slice_name: str = "all") -> float | None:
        return by_key.get((target, 0, slice_name, metric))

    out: dict[str, Any] = {
        "n_val": n_val,
        "brier": {"bike": g("bike", "brier"), "dock": g("dock", "brier")},
        "logloss": {"bike": g("bike", "logloss"), "dock": g("dock", "logloss")},
        "auc": {"bike": g("bike", "auc"), "dock": g("dock", "auc")},
        "ece": {"bike": g("bike", "ece"), "dock": g("dock", "ece")},
        "mae": g("cnt", "mae"),
        "rmse": g("cnt", "rmse"),
        "brier_at_risk": {"bike": g("bike", "brier", "at_risk"), "dock": g("dock", "brier", "at_risk")},
        "ref": ref if ref is not None else {"tier": None, "brier": None, "mae": None},
    }
    if best_iter is not None:
        out["best_iter"] = best_iter
    return out


def _load_static_context(
    conn: psycopg.Connection, city_id: int, station_pks: np.ndarray
) -> tuple[np.ndarray, np.ndarray, dict[tuple[int, int], float], np.ndarray]:
    """`(rates, rates_ok, multipliers, neighbors)`, loaded once for the whole training run
    (mirrors `predict.py`'s `_reload_context`, duplicated rather than shared to keep WP-5's
    `predict.py` untouched).
    """
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

    mult_df = db.fetch_df(
        conn, "SELECT temp_bin, precip_bin, m FROM weather_multipliers WHERE city_id=%(c)s", {"c": city_id}
    )
    multipliers = (
        {(int(r.temp_bin), int(r.precip_bin)): float(r.m) for r in mult_df.itertuples(index=False)}
        if not mult_df.empty
        else {}
    )

    neigh_df = db.fetch_df(
        conn,
        "SELECT station_pk, neighbor_pk, rank FROM station_neighbors WHERE station_pk = ANY(%(pks)s)",
        {"pks": pks_list},
    )
    neighbors_arr = np.full((s, 3), -1, dtype=np.int64)
    if not neigh_df.empty:
        for r in neigh_df.itertuples(index=False):
            i = pos.get(int(r.station_pk))
            j = pos.get(int(r.neighbor_pk))
            rank = int(r.rank)
            if i is not None and j is not None and 1 <= rank <= 3:
                neighbors_arr[i, rank - 1] = j

    return rates, rates_ok, multipliers, neighbors_arr


def _data_days(conn: psycopg.Connection, city_id: int, tz_name: str, t_from: datetime, t_to: datetime) -> list[date]:
    df = db.fetch_df(conn, _DATA_DAYS_SQL, {"tz": tz_name, "city_id": city_id, "t_from": t_from, "t_to": t_to})
    if df.empty:
        return []
    return sorted(pd.to_datetime(df["d"]).dt.date.tolist())


def _split_for_day(d: date, train_end: date, es_end: date) -> str:
    if d < train_end:
        return "train"
    if d < es_end:
        return "es"
    return "val"


def _refit_bd(
    conn: psycopg.Connection,
    cfg: Config,
    city_id: int,
    tz_name: str,
    T: date,
    now: datetime,
) -> tuple[int, str, BdBundle]:
    """Step 4: refit `bd` calibrators on `[T-21,T-7)`; write a `bd` `model_versions` row
    (always). Returns `(bd_id, ref_tier, bundle)`.

    The 14-day window is ~8.4M rows (2026-10); read whole with `fetch_df` it set the
    trainer's peak at ~5.7 GiB, so it streams in chunks with narrowed dtypes.
    """
    tz = tz_of(tz_name)
    a = local_midnight(T - timedelta(days=21), tz)
    b = local_midnight(T - timedelta(days=7), tz)
    rows = db.fetch_df_chunked(
        conn, _BD_CAL_SQL, {"city_id": city_id, "a": a, "b": b}, dtypes=_BD_CAL_DTYPES, name="dockcast_bd_cal"
    )
    n = len(rows)

    if n >= _MIN_ROWS_FOR_BD_CAL:
        horizons = rows["horizon"].to_numpy()
        cal_bike = fit_calibrators(rows["p_bike"].to_numpy(), rows["y_bike"].to_numpy(), horizons)
        cal_dock = fit_calibrators(rows["p_dock"].to_numpy(), rows["y_dock"].to_numpy(), horizons)
        calibrators = {"bike": cal_bike, "dock": cal_dock}
        ref_tier = "bd_cal"
    else:
        logger.info("bd_uncalibrated", extra={"n_rows": n, "min_required": _MIN_ROWS_FOR_BD_CAL, "city_id": city_id})
        calibrators = {}
        ref_tier = "bd_raw"

    bundle = BdBundle(calibrators=calibrators, fit_window=(a.isoformat(), b.isoformat()), created_at=now.isoformat())
    artifact_bytes = dumps(bundle)
    bd_id = _write_model_version(
        conn, city_id, "bd", "active", T, (a, b), FEATURE_SCHEMA_VERSION, cfg.git_sha, None, None, None, artifact_bytes
    )
    return bd_id, ref_tier, bundle


def train_city(cfg: Config, conn: psycopg.Connection, city: dict[str, Any], T: date, now: datetime) -> dict[str, Any]:
    """Run the full nightly trainer job for `city`, `trained_for_date = T`, as-of `now`
    (docs/worker-spec.md §8.2). Idempotent per `(city, tier, T)`.
    """
    city_id = int(city["id"])
    tz_name = str(city["tz"])
    tz = tz_of(tz_name)
    hol_years = [T.year - 1, T.year, T.year + 1]
    hol = holiday_set(city["holiday_country"], city["holiday_subdiv"], hol_years)

    summary: dict[str, Any] = {"city_id": city_id, "trained_for_date": T.isoformat()}

    # 1. neighbours
    summary["neighbors"] = neighbors.rebuild(conn, city_id)

    # 2. labels
    summary["labels"] = materialise_labels(conn, city, now)
    log_memory(logger, "labels")

    # 3. profile for the coming local day
    stations_df = load_stations(conn, city_id, active_only=True)
    station_pks = stations_df["id"].to_numpy(dtype=np.int32)
    serving_profile = build_rolling_profile(conn, city_id, tz, hol, station_pks, T)
    write_table(conn, city_id, serving_profile.to_frame(T))
    summary["profile_rows"] = len(serving_profile.to_frame(T))
    log_memory(logger, "serving_profile")

    # 4. bd calibration (always writes a bd model_versions row)
    bd_id, ref_tier, bd_bundle = _refit_bd(conn, cfg, city_id, tz_name, T, now)
    summary["bd_id"] = bd_id
    summary["ref_tier"] = ref_tier
    log_memory(logger, "bd_calibration")

    # 5. row universe & splits
    t_from60 = local_midnight(T - timedelta(days=60), tz)
    t_to = local_midnight(T, tz)
    data_days = _data_days(conn, city_id, tz_name, t_from60, t_to)
    summary["n_data_days"] = len(data_days)

    if len(data_days) < _MIN_LOCAL_DAYS:
        gbm_id = _write_model_version(
            conn, city_id, "gbm", "insufficient_data", T, None, FEATURE_SCHEMA_VERSION, cfg.git_sha,
            {"n_days": len(data_days)}, None, None, None,
        )
        summary["gbm_id"] = gbm_id
        summary["gbm_status"] = "insufficient_data"
        summary["metrics_online"] = metrics_online.compute(conn, city, T)
        _housekeeping(conn, city_id, now)
        _ping(cfg)
        logger.info("train_city complete (insufficient_data)", extra=summary)
        return summary

    start = max(T - timedelta(days=60), min(data_days))
    train_end = T - timedelta(days=9)
    es_end = T - timedelta(days=7)

    rates, rates_ok, multipliers, neighbor_idx = _load_static_context(conn, city_id, station_pks)
    train_profile = build_rolling_profile(conn, city_id, tz, hol, station_pks, start)
    log_memory(logger, "train_profile")

    # --- pass 1: per-day row counts (for cap-based subsampling) ---
    all_days = [start + timedelta(days=i) for i in range((T - start).days)]
    day_split = {d: _split_for_day(d, train_end, es_end) for d in all_days}
    counts: dict[str, dict[date, int]] = {"train": {}, "es": {}, "val": {}}
    for d in all_days:
        day_start = local_midnight(d, tz)
        day_end = local_midnight(d + timedelta(days=1), tz)
        n = db.fetch_df(conn, _ROW_COUNT_SQL, {"city_id": city_id, "day_start": day_start, "day_end": day_end})
        counts[day_split[d]][d] = int(n["n"].iloc[0]) if not n.empty else 0

    n_d: dict[str, dict[date, int]] = {}
    for split_name, cap in _ROW_CAPS.items():
        c = counts[split_name]
        total = sum(c.values())
        if total > cap:
            n_d[split_name] = {d: min(v, round(cap * v / total)) for d, v in c.items()}
        else:
            n_d[split_name] = dict(c)

    log_memory(logger, "row_counts")

    rng = np.random.default_rng(_SEED)

    # --- pass 2: per-day feature build ---
    tr_buf = _SplitBuffer(sum(n_d["train"].values()))
    es_buf = _SplitBuffer(sum(n_d["es"].values()))
    val_light_parts: list[pd.DataFrame] = []
    val_day_order: list[date] = []

    with tempfile.TemporaryDirectory(prefix="dockcast_train_val_") as tmpdir:
        tmp_path = Path(tmpdir)
        for d in all_days:
            split_name = day_split[d]
            day_start = local_midnight(d, tz)
            day_end = local_midnight(d + timedelta(days=1), tz)

            rows_d = db.fetch_df_chunked(
                conn, _ROW_SQL, {"city_id": city_id, "day_start": day_start, "day_end": day_end},
                dtypes=_ROW_DTYPES,
            )
            grid_d = load_city_grid(
                conn, city_id, station_pks, day_start - timedelta(minutes=61), day_end + timedelta(minutes=120)
            )

            if not rows_d.empty:
                rows_d = rows_d.sort_values(["station_pk", "t0", "horizon"]).reset_index(drop=True)
                target_n = n_d[split_name].get(d, len(rows_d))
                if target_n < len(rows_d):
                    keep = np.sort(rng.choice(len(rows_d), size=target_n, replace=False))
                    rows_d = rows_d.iloc[keep].reset_index(drop=True)

                if not rows_d.empty:
                    ctx_d = FeatureContext(
                        tz=tz, hol=hol, stations=stations_df, grid=grid_d, rates=rates, rates_ok=rates_ok,
                        weather=load_weather_window(conn, city_id, day_start, day_end), multipliers=multipliers,
                        neighbors=neighbor_idx, profile=train_profile,
                    )
                    x_d = build_features(ctx_d, rows_d[_FEATURE_INPUT_COLS])

                    if split_name == "train":
                        tr_buf.append(
                            x_d[FEATURE_NAMES].to_numpy(dtype=np.float32),
                            rows_d["y_bike"].to_numpy(dtype=np.int8),
                            rows_d["y_dock"].to_numpy(dtype=np.int8),
                            rows_d["y_cnt"].to_numpy(dtype=np.float32),
                        )
                    elif split_name == "es":
                        es_buf.append(
                            x_d[FEATURE_NAMES].to_numpy(dtype=np.float32),
                            rows_d["y_bike"].to_numpy(dtype=np.int8),
                            rows_d["y_dock"].to_numpy(dtype=np.int8),
                            rows_d["y_cnt"].to_numpy(dtype=np.float32),
                        )
                    else:
                        np.save(tmp_path / f"val_{d.isoformat()}.npy", x_d[FEATURE_NAMES].to_numpy(np.float32))
                        val_light_parts.append(rows_d[_LIGHT_COLS])
                        val_day_order.append(d)

            # profile is advanced with day d only after it has been used to build d's features.
            col_start = grid_d.col(day_start)
            col_end = grid_d.col(day_end - timedelta(minutes=1)) + 1
            train_profile.add_day(d, day_type(d, hol), grid_d, slice(col_start, col_end))

        log_memory(logger, "feature_build")
        n_train = tr_buf.n
        n_es = es_buf.n
        n_val = sum(len(p) for p in val_light_parts)
        summary["n_train_rows"] = n_train
        summary["n_es_rows"] = n_es
        summary["n_val_rows"] = n_val

        if n_train == 0 or n_es == 0 or n_val == 0:
            gbm_id = _write_model_version(
                conn, city_id, "gbm", "insufficient_data", T, None, FEATURE_SCHEMA_VERSION, cfg.git_sha,
                {"n_days": len(data_days), "n_train_rows": n_train, "n_es_rows": n_es, "n_val_rows": n_val},
                None, None, None,
            )
            summary["gbm_id"] = gbm_id
            summary["gbm_status"] = "insufficient_data"
            summary["metrics_online"] = metrics_online.compute(conn, city, T)
            _housekeeping(conn, city_id, now)
            _ping(cfg)
            logger.info("train_city complete (insufficient split rows)", extra=summary)
            return summary

        x_tr, y_tr_arrays = tr_buf.finish()
        x_es, y_es_arrays = es_buf.finish()
        del tr_buf, es_buf
        val_light = pd.concat(val_light_parts, ignore_index=True) if val_light_parts else pd.DataFrame(columns=_LIGHT_COLS)
        del val_light_parts
        # Last day's frames of the pass-2 loop; names may be unbound if the loop never built a day.
        rows_d = grid_d = ctx_d = x_d = None

        # 7. train + calibrate on es
        log_memory(logger, "feature_matrices")
        # The Datasets keep only the binned copy; dropping the raw training matrix before the
        # fit releases it for the whole of the (long) boosting phase. `x_es` stays for the
        # calibration pass below.
        dtr, des = gbm_mod.build_datasets(x_tr, y_tr_arrays, x_es, y_es_arrays)
        del x_tr
        release()
        boosters = gbm_mod.fit_boosters(dtr, des, y_tr_arrays, y_es_arrays)
        del dtr, des
        release()
        raw_es = gbm_mod.predict_raw(boosters, x_es)
        h_es = x_es[:, FEATURE_NAMES.index("h")].astype(np.int32)
        cal_bike_gbm = fit_calibrators(raw_es["bike"], y_es_arrays["bike"], h_es)
        cal_dock_gbm = fit_calibrators(raw_es["dock"], y_es_arrays["dock"], h_es)
        del x_es, raw_es, h_es, y_tr_arrays, y_es_arrays
        release()
        log_memory(logger, "calibration")

        # 8. score every tier on the same val rows
        active_loaded = load_active(conn, city_id, "gbm")
        active_bundle: GbmBundle | None = None
        active_id: int | None = None
        if active_loaded is not None:
            active_id, bundle = active_loaded
            if isinstance(bundle, GbmBundle) and bundle.feature_schema_version == FEATURE_SCHEMA_VERSION:
                active_bundle = bundle

        cand_p_bike: list[np.ndarray] = []
        cand_p_dock: list[np.ndarray] = []
        cand_cnt: list[np.ndarray] = []
        active_p_bike: list[np.ndarray] = []
        active_p_dock: list[np.ndarray] = []
        active_cnt: list[np.ndarray] = []

        for d in val_day_order:
            x_d = pd.DataFrame(np.load(tmp_path / f"val_{d.isoformat()}.npy"), columns=FEATURE_NAMES)
            cap0_d = x_d["cap0"].to_numpy(dtype=np.float64)
            h_d = x_d["h"].to_numpy(dtype=np.int64)

            raw_cand = gbm_mod.predict_raw(boosters, x_d)
            cand_p_bike.append(apply_calibrators(cal_bike_gbm, raw_cand["bike"], h_d))
            cand_p_dock.append(apply_calibrators(cal_dock_gbm, raw_cand["dock"], h_d))
            cand_cnt.append(np.clip(raw_cand["cnt"], 0.0, cap0_d))

            if active_bundle is not None:
                active_boosters = boosters_of(active_bundle)
                raw_active = gbm_mod.predict_raw(active_boosters, x_d)
                active_p_bike.append(apply_calibrators(active_bundle.calibrators.get("bike", {}), raw_active["bike"], h_d))
                active_p_dock.append(apply_calibrators(active_bundle.calibrators.get("dock", {}), raw_active["dock"], h_d))
                active_cnt.append(np.clip(raw_active["cnt"], 0.0, cap0_d))

    # Val-scoring loop temporaries; raw_active/active_boosters are only bound when a GBM is active.
    x_d = cap0_d = h_d = raw_cand = raw_active = active_boosters = None
    active_loaded = bundle = None
    log_memory(logger, "val_scoring")
    horizons_val = val_light["horizon"].to_numpy()
    bikes0_val = val_light["bikes0"].to_numpy()
    docks0_val = val_light["docks0"].to_numpy()
    y_bike_val = val_light["y_bike"].to_numpy()
    y_dock_val = val_light["y_dock"].to_numpy()
    y_cnt_val = val_light["y_cnt"].to_numpy()

    persistence_preds = Preds(
        p_bike=(bikes0_val >= 1).astype(np.float64),
        p_dock=(docks0_val >= 1).astype(np.float64),
        y_cnt_hat=bikes0_val.astype(np.float64),
    )
    persistence_rows = metric_rows(
        "persistence", persistence_preds, y_bike_val, y_dock_val, y_cnt_val, bikes0_val, docks0_val, horizons_val
    )

    bd_raw_preds = Preds(
        p_bike=val_light["bd_p_bike"].to_numpy(dtype=np.float64),
        p_dock=val_light["bd_p_dock"].to_numpy(dtype=np.float64),
        y_cnt_hat=val_light["bd_exp_cnt"].to_numpy(dtype=np.float64),
    )
    bd_raw_rows = metric_rows(
        "bd_raw", bd_raw_preds, y_bike_val, y_dock_val, y_cnt_val, bikes0_val, docks0_val, horizons_val
    )

    bd_cal_rows: list[dict] = []
    if bd_bundle.calibrators:
        bd_cal_p_bike = apply_calibrators(bd_bundle.calibrators.get("bike", {}), val_light["bd_p_bike"].to_numpy(), horizons_val)
        bd_cal_p_dock = apply_calibrators(bd_bundle.calibrators.get("dock", {}), val_light["bd_p_dock"].to_numpy(), horizons_val)
        bd_cal_preds = Preds(p_bike=bd_cal_p_bike, p_dock=bd_cal_p_dock, y_cnt_hat=val_light["bd_exp_cnt"].to_numpy(dtype=np.float64))
        bd_cal_rows = metric_rows(
            "bd_cal", bd_cal_preds, y_bike_val, y_dock_val, y_cnt_val, bikes0_val, docks0_val, horizons_val
        )

    cand_preds = Preds(
        p_bike=np.concatenate(cand_p_bike), p_dock=np.concatenate(cand_p_dock), y_cnt_hat=np.concatenate(cand_cnt)
    )
    cand_rows = metric_rows(
        "gbm_cand", cand_preds, y_bike_val, y_dock_val, y_cnt_val, bikes0_val, docks0_val, horizons_val
    )

    active_rows: list[dict] = []
    if active_bundle is not None and active_p_bike:
        active_preds = Preds(
            p_bike=np.concatenate(active_p_bike), p_dock=np.concatenate(active_p_dock), y_cnt_hat=np.concatenate(active_cnt)
        )
        active_rows = metric_rows(
            "gbm_active", active_preds, y_bike_val, y_dock_val, y_cnt_val, bikes0_val, docks0_val, horizons_val
        )

    ref_rows = bd_cal_rows if ref_tier == "bd_cal" else bd_raw_rows
    ref_pooled = _pooled(ref_rows)
    cand_pooled = _pooled(cand_rows)
    active_pooled = _pooled(active_rows) if active_rows else None

    gate_result = evaluate_gate(cand_pooled, ref_pooled, active_pooled, ref_tier)
    status = "active" if gate_result.passed else "shadow"

    best_iter = {t: b.best_iteration for t, b in boosters.items()}
    hyperparams_json = {
        **gbm_mod.PARAMS_BASE,
        "num_boost_round": gbm_mod.NUM_BOOST_ROUND,
        "early_stopping_rounds": gbm_mod.EARLY_STOPPING_ROUNDS,
        "best_iteration": best_iter,
    }
    ref_field = {"tier": ref_tier, "brier": {"bike": ref_pooled["brier_bike"], "dock": ref_pooled["brier_dock"]}, "mae": ref_pooled["mae"]}
    cand_metrics_val = _metrics_val_json(cand_rows, n_val, ref_field, best_iter)

    train_window_bounds = (local_midnight(start, tz), local_midnight(train_end, tz))
    gbm_bundle = GbmBundle(
        feature_schema_version=FEATURE_SCHEMA_VERSION,
        feature_names=list(FEATURE_NAMES),
        boosters={t: b.model_to_string() for t, b in boosters.items()},
        calibrators={"bike": cal_bike_gbm, "dock": cal_dock_gbm},
        train_window=(train_window_bounds[0].isoformat(), train_window_bounds[1].isoformat()),
        git_sha=cfg.git_sha,
        hyperparams=hyperparams_json,
        metrics_val=cand_metrics_val,
        created_at=now.isoformat(),
    )
    gbm_artifact = dumps(gbm_bundle)

    gbm_id = _write_model_version(
        conn, city_id, "gbm", status, T, train_window_bounds, FEATURE_SCHEMA_VERSION, cfg.git_sha,
        hyperparams_json, cand_metrics_val, gate_result.to_json(), gbm_artifact,
    )
    summary["gbm_id"] = gbm_id
    summary["gbm_status"] = status
    summary["gate_passed"] = gate_result.passed

    n_eval_cand = _write_model_eval(conn, gbm_id, "val", [{**r, "tier": "gbm"} for r in cand_rows])

    bd_metrics_val = _metrics_val_json(ref_rows, n_val, ref=None)
    _update_metrics_val(conn, bd_id, bd_metrics_val)
    n_eval_bd = _write_model_eval(conn, bd_id, "val", persistence_rows + bd_raw_rows + bd_cal_rows)
    summary["n_model_eval_rows"] = n_eval_cand + n_eval_bd

    # 9. online metrics. Release everything the fit and the val scoring held first: the 7-day
    # window read is the other large allocation of the run and need not sit on top of them.
    del boosters, gbm_bundle, val_light, horizons_val, bikes0_val, docks0_val
    del y_bike_val, y_dock_val, y_cnt_val, persistence_preds, bd_raw_preds
    del cand_p_bike, cand_p_dock, cand_cnt, cand_preds
    del active_p_bike, active_p_dock, active_cnt, gbm_artifact
    # Bound only on the calibrators-present / active-GBM paths.
    bd_cal_p_bike = bd_cal_p_dock = bd_cal_preds = active_preds = active_bundle = None
    release()
    log_memory(logger, "release")
    summary["metrics_online"] = metrics_online.compute(conn, city, T)
    log_memory(logger, "metrics_online")

    # 10. housekeeping
    _housekeeping(conn, city_id, now)

    # 11. summary log + healthchecks ping
    _ping(cfg)
    logger.info("train_city complete", extra=summary)
    return summary


def _housekeeping(conn: psycopg.Connection, city_id: int, now: datetime) -> None:
    """Delete weather forecasts older than 120 days relative to the injected clock (R9: no wall clock)."""
    cutoff = now - timedelta(days=120)
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            "DELETE FROM weather_forecasts WHERE city_id=%s AND fetched_at < %s",
            (city_id, cutoff),
        )


def _ping(cfg: Config) -> None:
    if not cfg.healthchecks_trainer_url:
        return
    try:
        httpx.get(cfg.healthchecks_trainer_url, timeout=10)
    except httpx.HTTPError:
        logger.warning("healthchecks ping failed", exc_info=True)


__all__ = ["train_city"]
