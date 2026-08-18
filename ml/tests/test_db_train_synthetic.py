"""Synthetic end-to-end trainer test (docs/plan.md WP-6, docs/worker-spec.md §9
`test_db_train_synthetic.py`, DoD).

20 synthetic stations, 21 simulated local days of a (discrete-time, Poisson-thinned)
birth-death process -> `station_snapshots`/`poll_log`/`station_flow_rates`/
`weather_multipliers`/`weather_forecasts`; `predict_once` run at every 15-minute grid
origin over those days (the real predict path, batched per origin) so `forecast_history`
holds real `bd_raw` rows; labels materialised; then `train_city` run for the day right
after the simulated window. Asserts the full trainer contract: `model_versions` bd(active)
+ gbm(active|shadow) rows with the exact `Gate`/`MetricsVal` JSON shapes, `model_eval` rows
for every (target,horizon,slice), `model_metrics_daily` rows for windows 1 and 7 including
`persistence`, gbm beating persistence on val, and idempotency of a second `train` run.
"""

from __future__ import annotations

import math
from datetime import UTC, date, datetime, timedelta

import numpy as np
import pandas as pd
import psycopg
import pytest

from dockcast_ml import db as dbmod
from dockcast_ml.config import Config
from dockcast_ml.labels import materialise_labels
from dockcast_ml.predict import PredictState, predict_once
from dockcast_ml.timeutil import bucket as bucket_of
from dockcast_ml.timeutil import day_type, holiday_set, local_midnight, tz_of
from dockcast_ml.train import train_city

N_STATIONS = 20
N_DAYS = 21
START_DATE = date(2026, 4, 6)  # arbitrary anchor safely clear of any DST transition (America/Toronto:
# 2026-03-08 spring-forward, 2026-11-01 fall-back), so every simulated local day has exactly 96
# 15-minute-UTC-grid origins -- a DST-crossing window is a real, separately-worth-testing edge
# case, not something this end-to-end trainer test needs to also account for.
STEP_MIN = 5

_CHECK_NAMES = {
    "brier_bike_vs_ref", "brier_dock_vs_ref", "ece_bike", "ece_dock", "mae_vs_ref",
}
_HORIZONS_WITH_POOLED = (0, 15, 30, 45, 60, 90, 120)


def _database_url() -> str:
    import os

    return os.environ["DATABASE_URL_TEST"]


def _rate_pair(bucket: int, dtype: int, scale: float) -> tuple[float, float]:
    """Deterministic synthetic per-minute (lam_out, lam_in), rush-hour shaped."""
    if dtype == 0:
        morning = math.exp(-((bucket - 32) ** 2) / (2 * 4.0**2))
        evening = math.exp(-((bucket - 72) ** 2) / (2 * 4.0**2))
        lam_out = 0.02 + 0.10 * morning + 0.02 * evening
        lam_in = 0.02 + 0.02 * morning + 0.10 * evening
    else:
        midday = math.exp(-((bucket - 56) ** 2) / (2 * 10.0**2))
        lam_out = 0.02 + 0.05 * midday
        lam_in = 0.02 + 0.05 * midday
    return lam_out * scale, lam_in * scale


def _seed_static_tables(cur: psycopg.Cursor, city_id: int, station_pks: list[int], scales: list[float]) -> None:
    tz = tz_of("America/Toronto")
    fitted_at = datetime.now(UTC)

    rate_rows = []
    for pk, scale in zip(station_pks, scales, strict=True):
        for dtype in range(3):
            for b in range(96):
                lam_out, lam_in = _rate_pair(b, dtype, scale)
                rate_rows.append((pk, dtype, b, lam_in, lam_out, "trips", fitted_at))
    dbmod.copy_rows(
        cur, "station_flow_rates",
        ["station_pk", "day_type", "bucket", "lam_in_per_min", "lam_out_per_min", "source", "fitted_at"],
        rate_rows,
    )

    mult_rows = [(city_id, tb, pb, 1.0, fitted_at) for tb in range(5) for pb in range(4)]
    dbmod.copy_rows(cur, "weather_multipliers", ["city_id", "temp_bin", "precip_bin", "m", "fitted_at"], mult_rows)

    day_start = local_midnight(START_DATE, tz).astimezone(UTC)
    day_end = local_midnight(START_DATE + timedelta(days=N_DAYS + 1), tz).astimezone(UTC)
    hours = pd.date_range(day_start, day_end, freq="1h", tz="UTC")
    weather_fetched_at = day_start - timedelta(hours=1)
    weather_rows = [(city_id, weather_fetched_at, h.to_pydatetime(), 15.0, 0.0, 5, 5.0, 1) for h in hours]
    dbmod.copy_rows(
        cur, "weather_forecasts",
        ["city_id", "fetched_at", "valid_hour", "temp_c", "precip_mm", "precip_prob", "wind_kmh", "weather_code"],
        weather_rows,
    )


def _seed_realtime_current(cur: psycopg.Cursor, city_id: int, station_pks: list[int]) -> None:
    """`station_current`/`feed_state` gate `predict_once` via `station_state_fresh`, which is
    evaluated against real wall-clock `now()` -- independent of the historical `t0` we predict
    for. A single, always-fresh row per station is enough (docs/worker-spec.md §8.1 step 5).
    """
    real_now = datetime.now(UTC)
    current_rows = [(pk, real_now, 10, 10, None, True, True, True, real_now - timedelta(seconds=20)) for pk in station_pks]
    dbmod.copy_rows(
        cur, "station_current",
        ["station_pk", "ts", "bikes", "docks", "ebikes", "is_installed", "is_renting", "is_returning", "last_reported"],
        current_rows,
    )
    cur.execute(
        "INSERT INTO feed_state (city_id, feed, last_attempt_at, last_ok_at) VALUES (%s,'station_status',%s,%s)",
        (city_id, real_now, real_now - timedelta(seconds=5)),
    )


def _simulate_and_seed_history(
    cur: psycopg.Cursor, city_id: int, station_pks: list[int], capacities: list[int], scales: list[float], hol: set
) -> None:
    tz = tz_of("America/Toronto")
    rng = np.random.default_rng(7)
    # Stepping must happen in UTC: `t += timedelta(...)` on a datetime whose tzinfo is a
    # `ZoneInfo` (not a fixed-offset zone) does wall-clock arithmetic and silently produces
    # duplicate/skipped absolute instants across a DST transition. Convert to UTC once, do all
    # arithmetic there, and only `.astimezone(tz)` per-iteration for local day_type/bucket.
    t_start = local_midnight(START_DATE, tz).astimezone(UTC)
    t_end = local_midnight(START_DATE + timedelta(days=N_DAYS), tz).astimezone(UTC)

    n_steps = int((t_end - t_start).total_seconds() // (STEP_MIN * 60))
    snap_rows: list[tuple] = []
    for pk, cap, scale in zip(station_pks, capacities, scales, strict=True):
        bikes = cap // 2
        t = t_start
        for _ in range(n_steps):
            local_t = t.astimezone(tz)
            dtype = day_type(local_t.date(), hol)
            b = bucket_of(local_t)
            lam_out, lam_in = _rate_pair(b, dtype, scale)
            docks = cap - bikes
            n_out = min(bikes, int(rng.poisson(lam_out * STEP_MIN)))
            n_in = min(docks, int(rng.poisson(lam_in * STEP_MIN)))
            bikes = int(np.clip(bikes - n_out + n_in, 0, cap))
            snap_rows.append((pk, t, bikes, cap - bikes, None, True, True, True, t))
            t += timedelta(minutes=STEP_MIN)

    dbmod.copy_rows(
        cur, "station_snapshots",
        ["station_pk", "ts", "bikes", "docks", "ebikes", "is_installed", "is_renting", "is_returning", "last_reported"],
        snap_rows,
    )

    n_poll_min = int((t_end - t_start).total_seconds() // 60)
    poll_rows = [(city_id, t_start + timedelta(minutes=m), "station_status", True, N_STATIONS, 20) for m in range(n_poll_min + 1)]
    dbmod.copy_rows(cur, "poll_log", ["city_id", "polled_at", "feed", "ok", "n_items", "latency_ms"], poll_rows)


@pytest.mark.db
@pytest.mark.slow
def test_train_synthetic_end_to_end(db_conn: psycopg.Connection, synthetic_city: int) -> None:
    cfg = Config(database_url=_database_url())
    city = dbmod.fetch_df(db_conn, "SELECT * FROM cities WHERE id=%(c)s", {"c": synthetic_city}).iloc[0].to_dict()
    tz = tz_of(city["tz"])
    hol = holiday_set(city["holiday_country"], city["holiday_subdiv"], [START_DATE.year - 1, START_DATE.year, START_DATE.year + 1])

    rng = np.random.default_rng(3)
    capacities = [int(rng.integers(15, 31)) for _ in range(N_STATIONS)]
    scales = [float(rng.uniform(0.7, 1.3)) for _ in range(N_STATIONS)]

    station_pks: list[int] = []
    with db_conn.cursor() as cur:
        for i in range(N_STATIONS):
            cur.execute(
                "INSERT INTO stations (city_id, station_id, name, lat, lon, capacity, is_active) "
                "VALUES (%s,%s,%s,%s,%s,%s,true) RETURNING id",
                (synthetic_city, f"syn-{i}", f"Synthetic {i}", 43.60 + 0.01 * (i % 10), -79.40 + 0.01 * (i // 10), capacities[i]),
            )
            row = cur.fetchone()
            assert row is not None
            station_pks.append(row[0])

        _seed_static_tables(cur, synthetic_city, station_pks, scales)
        _seed_realtime_current(cur, synthetic_city, station_pks)
        _simulate_and_seed_history(cur, synthetic_city, station_pks, capacities, scales, hol)
    db_conn.commit()

    # --- backfill forecast_history via the real predict path, at every 15-min grid origin ---
    # UTC-normalized so `+=` stepping is safe across the DST transition inside the simulated
    # window (see `_simulate_and_seed_history`'s comment); this also matches production, where
    # `t0` is always UTC (`ceil_to(datetime.now(UTC), ...)`).
    state = PredictState()
    t0 = local_midnight(START_DATE, tz).astimezone(UTC)
    end_t0 = local_midnight(START_DATE + timedelta(days=N_DAYS), tz).astimezone(UTC)
    n_calls = 0
    while t0 < end_t0:
        # `station_state_fresh` gates on REAL wall-clock `now()` (`feed_state.last_ok_at >= now()
        # - 90s`), independent of the simulated `t0` -- refresh it every iteration so a
        # multi-thousand-call, tens-of-seconds-long backfill loop doesn't go stale partway through
        # and start skipping stations as `not_fresh` for its last iterations.
        with db_conn.cursor() as cur:
            cur.execute("UPDATE feed_state SET last_ok_at = now(), last_attempt_at = now() WHERE city_id=%s", (synthetic_city,))
        predict_once(cfg, db_conn, city, t0, state)
        t0 += timedelta(minutes=15)
        n_calls += 1
    assert n_calls == N_DAYS * 96

    hist_count = dbmod.fetch_df(db_conn, "SELECT count(*) AS n FROM forecast_history WHERE tier='bd_raw'", None)
    assert int(hist_count["n"].iloc[0]) == N_DAYS * 96 * N_STATIONS * 6

    # --- labels ---
    now = end_t0 + timedelta(hours=3)
    label_summary = materialise_labels(db_conn, city, now)
    assert label_summary["n_rows"] > 0

    # --- train, for the day right after the simulated window ---
    trained_for_date = START_DATE + timedelta(days=N_DAYS)
    summary = train_city(cfg, db_conn, city, trained_for_date, now)
    assert summary["gbm_status"] in ("active", "shadow")

    versions = dbmod.fetch_df(
        db_conn,
        "SELECT id, tier, status, feature_schema_version, trained_for_date, metrics_val, gate "
        "FROM model_versions WHERE city_id=%(c)s ORDER BY id",
        {"c": synthetic_city},
    )
    bd_rows = versions[versions["tier"] == "bd"]
    gbm_rows = versions[versions["tier"] == "gbm"]
    assert len(bd_rows) == 1
    assert bd_rows.iloc[0]["status"] == "active"
    assert len(gbm_rows) == 1
    gbm_row = gbm_rows.iloc[0]
    assert gbm_row["status"] in ("active", "shadow")

    gate = gbm_row["gate"]
    assert set(gate.keys()) == {"passed", "checks"}
    check_names = {c["name"] for c in gate["checks"]}
    assert _CHECK_NAMES <= check_names
    for c in gate["checks"]:
        assert set(c.keys()) == {"name", "value", "threshold", "ok"}
    assert gate["passed"] == all(c["ok"] for c in gate["checks"])

    metrics_val = gbm_row["metrics_val"]
    assert set(metrics_val.keys()) >= {
        "n_val", "brier", "logloss", "auc", "ece", "mae", "rmse", "brier_at_risk", "ref", "best_iter",
    }
    assert set(metrics_val["brier"].keys()) == {"bike", "dock"}
    assert metrics_val["ref"]["tier"] in ("bd_raw", "bd_cal")

    # --- model_eval: every (target, horizon, slice) combo with the expected metric names ---
    gbm_id = int(gbm_row["id"])
    eval_df = dbmod.fetch_df(db_conn, "SELECT * FROM model_eval WHERE model_version_id=%(v)s", {"v": gbm_id})
    assert not eval_df.empty
    combos = set(zip(eval_df["target"], eval_df["horizon"], eval_df["slice"], strict=True))
    expected_combos = {
        (target, h, slice_name)
        for target in ("bike", "dock", "cnt")
        for h in _HORIZONS_WITH_POOLED
        for slice_name in ("all", "at_risk")
    }
    assert expected_combos <= combos

    bike_metrics_h0 = set(eval_df[(eval_df["target"] == "bike") & (eval_df["horizon"] == 0) & (eval_df["slice"] == "all")]["metric"])
    assert {"brier", "logloss", "auc", "ece", "n"} <= bike_metrics_h0
    assert any(m.startswith("rel_bin_") for m in bike_metrics_h0)
    cnt_metrics = set(eval_df[(eval_df["target"] == "cnt") & (eval_df["horizon"] == 15) & (eval_df["slice"] == "all")]["metric"])
    assert {"mae", "rmse", "n"} <= cnt_metrics

    bd_id = int(bd_rows.iloc[0]["id"])
    bd_eval = dbmod.fetch_df(db_conn, "SELECT DISTINCT target FROM model_eval WHERE model_version_id=%(v)s", {"v": bd_id})
    assert set(bd_eval["target"]) >= {"bike", "dock", "cnt"}

    # --- online metrics: windows 1 and 7, tier persistence present ---
    daily = dbmod.fetch_df(
        db_conn, "SELECT * FROM model_metrics_daily WHERE city_id=%(c)s AND day=%(d)s",
        {"c": synthetic_city, "d": trained_for_date},
    )
    assert not daily.empty
    assert set(daily["window_days"].unique()) >= {1, 7}
    assert "persistence" in set(daily["tier"].unique())

    # --- gbm beats persistence on val (pooled Brier, bike target) ---
    persist_val_query = """
        SELECT h.p_bike, h.p_dock, l.bikes0, l.docks0, l.y_bike, l.y_dock
        FROM forecast_history h JOIN forecast_labels l USING (station_pk, t0, horizon)
        JOIN stations s ON s.id = h.station_pk
        WHERE s.city_id = %(c)s AND h.tier = 'bd_raw'
          AND h.t0 >= %(a)s AND h.t0 < %(b)s
    """
    val_a = local_midnight(trained_for_date - timedelta(days=7), tz)
    val_b = local_midnight(trained_for_date, tz)
    val_rows = dbmod.fetch_df(db_conn, persist_val_query, {"c": synthetic_city, "a": val_a, "b": val_b})
    assert not val_rows.empty
    persistence_brier_bike = float(np.mean(((val_rows["bikes0"] >= 1).astype(float) - val_rows["y_bike"].astype(float)) ** 2))
    gbm_brier_bike = metrics_val["brier"]["bike"]
    assert gbm_brier_bike < persistence_brier_bike

    # --- idempotency: a second train run for the same date replaces the gbm row, same counts ---
    n_model_eval_before = len(dbmod.fetch_df(db_conn, "SELECT 1 FROM model_eval WHERE model_version_id=%(v)s", {"v": gbm_id}))
    summary2 = train_city(cfg, db_conn, city, trained_for_date, now)
    versions_after = dbmod.fetch_df(
        db_conn, "SELECT id, tier, status FROM model_versions WHERE city_id=%(c)s AND trained_for_date=%(d)s",
        {"c": synthetic_city, "d": trained_for_date},
    )
    gbm_after = versions_after[versions_after["tier"] == "gbm"]
    assert len(gbm_after) == 1
    new_gbm_id = int(gbm_after.iloc[0]["id"])
    assert new_gbm_id != gbm_id, "idempotent re-run must replace (delete-then-insert) the previous gbm row"
    n_model_eval_after = len(dbmod.fetch_df(db_conn, "SELECT 1 FROM model_eval WHERE model_version_id=%(v)s", {"v": new_gbm_id}))
    assert n_model_eval_after == n_model_eval_before
    assert summary2["gbm_status"] == summary["gbm_status"]

    old_gbm_still_present = dbmod.fetch_df(db_conn, "SELECT 1 FROM model_versions WHERE id=%(v)s", {"v": gbm_id})
    assert old_gbm_still_present.empty, "the previous gbm row must have been deleted"
