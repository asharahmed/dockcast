"""predict-once DB integration test (docs/plan.md WP-5): seeds a realistic-ish city from the
Toronto GBFS fixtures plus synthetic rates/weather, runs `predict_once`, and checks the
forecasts_latest / forecast_history / worker_runs contract from docs/worker-spec.md §8.1.
"""

from __future__ import annotations

import json
import os
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import psycopg
import pytest

from dockcast_ml import db as dbmod
from dockcast_ml.config import Config
from dockcast_ml.models.artifact import BdBundle, dumps
from dockcast_ml.models.calibration import fit_calibrators
from dockcast_ml.predict import PredictState, predict_once
from dockcast_ml.timeutil import floor_to

REPO_ROOT = Path(__file__).resolve().parents[2]
GBFS_DIR = REPO_ROOT / "fixtures" / "gbfs"
N_STATIONS = 40


def _load_fixture_stations() -> tuple[list[dict], dict[str, dict]]:
    info = json.loads((GBFS_DIR / "toronto_v3_station_information.json").read_text())["data"]["stations"]
    status_list = json.loads((GBFS_DIR / "toronto_v3_station_status.json").read_text())["data"]["stations"]
    status_by_id = {s["station_id"]: s for s in status_list}
    return info[:N_STATIONS], status_by_id


def _cfg() -> Config:
    return Config(database_url=os.environ["DATABASE_URL_TEST"], trips_cache_dir=Path("/tmp/unused"))


class _Seeded:
    def __init__(self) -> None:
        self.pks: list[int] = []
        self.stale_pk: int | None = None
        self.zerocap_pk: int | None = None
        self.norates_pk: int | None = None


def _seed_from_fixture(conn: psycopg.Connection, city_id: int, t0: datetime) -> _Seeded:
    info, status_by_id = _load_fixture_stations()
    real_now = datetime.now(UTC)
    seeded = _Seeded()

    with conn.cursor() as cur:
        for i, s in enumerate(info):
            cur.execute(
                "INSERT INTO stations (city_id, station_id, name, lat, lon, capacity, is_active) "
                "VALUES (%s,%s,%s,%s,%s,%s,true) RETURNING id",
                (city_id, s["station_id"], s["name"][0]["text"], s["lat"], s["lon"], s["capacity"]),
            )
            row = cur.fetchone()
            assert row is not None
            pk = row[0]
            seeded.pks.append(pk)

            status = status_by_id[s["station_id"]]
            bikes = int(status["num_vehicles_available"])
            docks = int(status["num_docks_available"])
            last_reported = real_now - timedelta(seconds=30)

            if i == 5:
                seeded.zerocap_pk = pk
                bikes, docks = 0, 0
            elif i == 10:
                seeded.stale_pk = pk
                last_reported = real_now - timedelta(minutes=20)
            elif i == 15:
                seeded.norates_pk = pk

            cur.execute(
                "INSERT INTO station_current "
                "(station_pk, ts, bikes, docks, ebikes, is_installed, is_renting, is_returning, last_reported) "
                "VALUES (%s,%s,%s,%s,NULL,true,true,true,%s)",
                (pk, t0, bikes, docks, last_reported),
            )
            cur.execute(
                "INSERT INTO station_snapshots "
                "(station_pk, ts, bikes, docks, ebikes, is_installed, is_renting, is_returning, last_reported) "
                "VALUES (%s,%s,%s,%s,NULL,true,true,true,%s)",
                (pk, t0, bikes, docks, last_reported),
            )

        cur.execute(
            "INSERT INTO feed_state (city_id, feed, last_attempt_at, last_ok_at) VALUES (%s,'station_status',%s,%s)",
            (city_id, real_now, real_now - timedelta(seconds=5)),
        )

        poll_rows = [(city_id, t0 - timedelta(minutes=m), "station_status", True, N_STATIONS, 20) for m in range(0, 65, 1)]
        dbmod.copy_rows(cur, "poll_log", ["city_id", "polled_at", "feed", "ok", "n_items", "latency_ms"], poll_rows)

        rate_rows = []
        for pk in seeded.pks:
            if pk == seeded.norates_pk:
                continue
            for k in range(3):
                for j in range(96):
                    rate_rows.append((pk, k, j, 0.02, 0.015, "trips", real_now))
        dbmod.copy_rows(
            cur, "station_flow_rates",
            ["station_pk", "day_type", "bucket", "lam_in_per_min", "lam_out_per_min", "source", "fitted_at"],
            rate_rows,
        )

        mult_rows = [(city_id, tb, pb, 1.0, real_now) for tb in range(5) for pb in range(4)]
        dbmod.copy_rows(cur, "weather_multipliers", ["city_id", "temp_bin", "precip_bin", "m", "fitted_at"], mult_rows)

        fetched_at = t0 - timedelta(minutes=30)
        hours = sorted({(t0 + timedelta(minutes=h)).replace(minute=0, second=0, microsecond=0) for h in (0, 15, 30, 45, 60, 90, 120)})
        weather_rows = [(city_id, fetched_at, hour, 15.0, 0.0, 10, 5.0, 1) for hour in hours]
        dbmod.copy_rows(
            cur, "weather_forecasts",
            ["city_id", "fetched_at", "valid_hour", "temp_c", "precip_mm", "precip_prob", "wind_kmh", "weather_code"],
            weather_rows,
        )
    conn.commit()
    return seeded


def _run_predict_once(conn: psycopg.Connection, city: dict, t0: datetime, state: PredictState) -> dict:
    cfg = _cfg()
    with dbmod.worker_run(cfg, "predict", city["id"]) as summary:
        summary.update(predict_once(cfg, conn, city, t0, state))
    return summary


@pytest.mark.db
def test_predict_once_full_contract(db_conn: psycopg.Connection, synthetic_city: int) -> None:
    city = dbmod.fetch_df(db_conn, "SELECT * FROM cities WHERE id=%(c)s", {"c": synthetic_city}).iloc[0].to_dict()
    t0 = floor_to(datetime.now(UTC), 900)
    seeded = _seed_from_fixture(db_conn, synthetic_city, t0)
    assert t0.minute % 15 == 0

    state = PredictState()
    summary = _run_predict_once(db_conn, city, t0, state)
    assert summary["t0"] == t0.isoformat()
    assert summary["serving_tier"] == "bd_raw"

    latest = dbmod.fetch_df(
        db_conn,
        "SELECT station_pk, horizon, p_bike, p_dock, exp_bikes, tier, reason, model_version_id "
        "FROM forecasts_latest WHERE station_pk = ANY(%(pks)s)",
        {"pks": seeded.pks},
    )
    assert len(latest) == N_STATIONS * 6

    for pk in seeded.pks:
        rows = latest[latest["station_pk"] == pk]
        assert len(rows) == 6
        if pk == seeded.stale_pk:
            assert (rows["reason"] == "not_fresh").all()
            assert rows["p_bike"].isna().all()
            assert (rows["tier"] == "none").all()
        elif pk == seeded.zerocap_pk:
            assert (rows["reason"] == "zero_capacity").all()
            assert rows["p_bike"].isna().all()
        elif pk == seeded.norates_pk:
            assert (rows["reason"] == "no_rates").all()
            assert rows["p_bike"].isna().all()
        else:
            assert rows["reason"].isna().all()
            assert (rows["tier"] == "bd_raw").all()
            assert rows["model_version_id"].isna().all()
            assert ((rows["p_bike"] >= 0) & (rows["p_bike"] <= 1)).all()
            assert ((rows["p_dock"] >= 0) & (rows["p_dock"] <= 1)).all()

    n_forecastable = N_STATIONS - 3
    history = dbmod.fetch_df(
        db_conn,
        "SELECT station_pk, horizon, tier, bd_a, bd_d, lam_in, lam_out FROM forecast_history "
        "WHERE station_pk = ANY(%(pks)s) AND t0=%(t0)s",
        {"pks": seeded.pks, "t0": t0},
    )
    assert len(history) == n_forecastable * 6
    assert (history["tier"] == "bd_raw").all()
    assert history["bd_a"].notna().all()
    assert history["bd_d"].notna().all()
    assert history["lam_in"].notna().all()
    assert history["lam_out"].notna().all()

    runs = dbmod.fetch_df(db_conn, "SELECT ok, kind FROM worker_runs WHERE city_id=%(c)s AND kind='predict'", {"c": synthetic_city})
    assert len(runs) == 1
    assert bool(runs["ok"].iloc[0]) is True

    # --- run again 5 minutes later (not a 15-min-grid origin): no new history rows ---
    t1 = t0 + timedelta(minutes=5)
    assert t1.minute % 15 != 0
    _run_predict_once(db_conn, city, t1, state)
    history_after = dbmod.fetch_df(
        db_conn, "SELECT count(*) AS n FROM forecast_history WHERE station_pk = ANY(%(pks)s)", {"pks": seeded.pks}
    )
    assert int(history_after["n"].iloc[0]) == len(history)

    latest_after_t1 = dbmod.fetch_df(
        db_conn, "SELECT count(*) AS n FROM forecasts_latest WHERE station_pk = ANY(%(pks)s)", {"pks": seeded.pks}
    )
    assert int(latest_after_t1["n"].iloc[0]) == N_STATIONS * 6  # upsert in place, no growth

    # --- run twice at the same t0: idempotent (no duplicate history rows) ---
    _run_predict_once(db_conn, city, t0, state)
    _run_predict_once(db_conn, city, t0, state)
    history_final = dbmod.fetch_df(
        db_conn,
        "SELECT count(*) AS n FROM forecast_history WHERE station_pk = ANY(%(pks)s) AND t0=%(t0)s",
        {"pks": seeded.pks, "t0": t0},
    )
    assert int(history_final["n"].iloc[0]) == n_forecastable * 6

    runs_final = dbmod.fetch_df(db_conn, "SELECT count(*) AS n FROM worker_runs WHERE city_id=%(c)s AND kind='predict'", {"c": synthetic_city})
    assert int(runs_final["n"].iloc[0]) == 4  # t0, t1, t0 again, t0 again


def _insert_calibrated_bd_version(conn: psycopg.Connection, city_id: int, t0: datetime) -> int:
    """A real `bd` model_versions row whose artifact carries per-horizon isotonic calibrators --
    what the trainer writes once its calibration window has enough rows (ml-spec §5.1)."""
    rng = np.random.default_rng(0)
    n = 300
    p = np.tile(rng.uniform(0.0, 1.0, n), 6)
    horizons = np.repeat([15, 30, 45, 60, 90, 120], n)
    y = (rng.uniform(0.0, 1.0, p.size) < p).astype(np.int8)
    cal = fit_calibrators(p, y, horizons, min_rows=100)
    bundle = BdBundle(calibrators={"bike": cal, "dock": cal}, fit_window=("a", "b"), created_at=t0.isoformat())
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO model_versions (city_id, tier, status, feature_schema_version, trained_for_date, artifact, activated_at) "
            "VALUES (%s, 'bd', 'active', 1, %s, %s, now()) RETURNING id",
            (city_id, t0.date(), dumps(bundle)),
        )
        row = cur.fetchone()
        assert row is not None
    conn.commit()
    return int(row[0])


@pytest.mark.db
def test_predict_once_with_calibrated_bd_writes_bd_cal_history(db_conn: psycopg.Connection, synthetic_city: int) -> None:
    """Regression (prod 2026-08-27 -> 09-01): with an active calibrated `bd` version the 15-min
    history write mixes bd_raw rows (model_version_id NULL) and bd_cal rows (integer id). Built via
    a DataFrame that column became float64 ("19.0") and COPY rejected every history write."""
    city = dbmod.fetch_df(db_conn, "SELECT * FROM cities WHERE id=%(c)s", {"c": synthetic_city}).iloc[0].to_dict()
    t0 = floor_to(datetime.now(UTC), 900)
    seeded = _seed_from_fixture(db_conn, synthetic_city, t0)
    bd_id = _insert_calibrated_bd_version(db_conn, synthetic_city, t0)

    state = PredictState()
    summary = _run_predict_once(db_conn, city, t0, state)
    assert summary["serving_tier"] == "bd_cal"
    assert state.bd_id == bd_id

    n_forecastable = N_STATIONS - 3
    history = dbmod.fetch_df(
        db_conn,
        "SELECT tier, model_version_id, p_bike, bd_a FROM forecast_history "
        "WHERE station_pk = ANY(%(pks)s) AND t0=%(t0)s",
        {"pks": seeded.pks, "t0": t0},
    )
    assert len(history) == n_forecastable * 6 * 2
    counts = history["tier"].value_counts()
    assert counts["bd_raw"] == n_forecastable * 6
    assert counts["bd_cal"] == n_forecastable * 6
    raw = history[history["tier"] == "bd_raw"]
    cal = history[history["tier"] == "bd_cal"]
    assert raw["model_version_id"].isna().all()
    assert (cal["model_version_id"] == bd_id).all()
    assert raw["bd_a"].notna().all()
    assert cal["bd_a"].isna().all()
    assert ((cal["p_bike"] >= 0) & (cal["p_bike"] <= 1)).all()

    latest = dbmod.fetch_df(
        db_conn,
        "SELECT tier, model_version_id FROM forecasts_latest WHERE station_pk = ANY(%(pks)s) AND reason IS NULL",
        {"pks": seeded.pks},
    )
    assert len(latest) == n_forecastable * 6
    assert (latest["tier"] == "bd_cal").all()
    assert (latest["model_version_id"] == bd_id).all()


def _seed_synthetic_perf(conn: psycopg.Connection, city_id: int, t0: datetime, n: int) -> list[int]:
    real_now = datetime.now(UTC)
    with conn.cursor() as cur:
        station_rows = [
            (city_id, f"synthetic-{i}", f"Synthetic Station {i}", 43.6 + (i % 100) * 0.001, -79.4 + (i // 100) * 0.001, 20, True)
            for i in range(n)
        ]
        dbmod.copy_rows(cur, "stations", ["city_id", "station_id", "name", "lat", "lon", "capacity", "is_active"], station_rows)
        cur.execute("SELECT id FROM stations WHERE city_id=%(c)s ORDER BY id", {"c": city_id})
        pks = [r[0] for r in cur.fetchall()]

        last_reported = real_now - timedelta(seconds=20)
        current_rows = [(pk, t0, 8, 12, None, True, True, True, last_reported) for pk in pks]
        dbmod.copy_rows(
            cur, "station_current",
            ["station_pk", "ts", "bikes", "docks", "ebikes", "is_installed", "is_renting", "is_returning", "last_reported"],
            current_rows,
        )
        snap_rows = [(pk, t0, 8, 12, None, True, True, True, last_reported) for pk in pks]
        dbmod.copy_rows(
            cur, "station_snapshots",
            ["station_pk", "ts", "bikes", "docks", "ebikes", "is_installed", "is_renting", "is_returning", "last_reported"],
            snap_rows,
        )

        cur.execute(
            "INSERT INTO feed_state (city_id, feed, last_attempt_at, last_ok_at) VALUES (%s,'station_status',%s,%s)",
            (city_id, real_now, real_now - timedelta(seconds=5)),
        )
        poll_rows = [(city_id, t0 - timedelta(minutes=m), "station_status", True, n, 20) for m in range(0, 65)]
        dbmod.copy_rows(cur, "poll_log", ["city_id", "polled_at", "feed", "ok", "n_items", "latency_ms"], poll_rows)

        rate_rows = [(pk, k, j, 0.02, 0.015, "trips", real_now) for pk in pks for k in range(3) for j in range(96)]
        dbmod.copy_rows(
            cur, "station_flow_rates",
            ["station_pk", "day_type", "bucket", "lam_in_per_min", "lam_out_per_min", "source", "fitted_at"],
            rate_rows,
        )
        mult_rows = [(city_id, tb, pb, 1.0, real_now) for tb in range(5) for pb in range(4)]
        dbmod.copy_rows(cur, "weather_multipliers", ["city_id", "temp_bin", "precip_bin", "m", "fitted_at"], mult_rows)

        fetched_at = t0 - timedelta(minutes=30)
        hours = sorted({(t0 + timedelta(minutes=h)).replace(minute=0, second=0, microsecond=0) for h in (0, 15, 30, 45, 60, 90, 120)})
        weather_rows = [(city_id, fetched_at, hour, 15.0, 0.0, 10, 5.0, 1) for hour in hours]
        dbmod.copy_rows(
            cur, "weather_forecasts",
            ["city_id", "fetched_at", "valid_hour", "temp_c", "precip_mm", "precip_prob", "wind_kmh", "weather_code"],
            weather_rows,
        )
    conn.commit()
    return pks


@pytest.mark.db
@pytest.mark.slow
def test_predict_once_perf_budget(db_conn: psycopg.Connection, synthetic_city: int) -> None:
    """1,100 synthetic stations: `predict_once` must complete in < 25s (docs/worker-spec.md §5 budget)."""
    n = 1100
    city = dbmod.fetch_df(db_conn, "SELECT * FROM cities WHERE id=%(c)s", {"c": synthetic_city}).iloc[0].to_dict()
    t0 = floor_to(datetime.now(UTC), 900)
    pks = _seed_synthetic_perf(db_conn, synthetic_city, t0, n)
    assert len(pks) == n

    state = PredictState()
    started = time.monotonic()
    summary = predict_once(_cfg(), db_conn, city, t0, state)
    elapsed = time.monotonic() - started

    print(f"\npredict_once for {n} synthetic stations took {elapsed:.2f}s (summary: {summary})")
    assert summary["n_forecast"] == n
    assert elapsed < 25.0, f"predict_once took {elapsed:.2f}s, budget is 25s"
