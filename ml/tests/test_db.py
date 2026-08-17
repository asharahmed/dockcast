"""Direct coverage for dockcast_ml.db primitives not otherwise exercised by other tests
(`copy_rows`/`fetch_df`/`worker_run` are exercised via tests/test_db_bootstrap.py and
tests/test_neighbors.py)."""

from __future__ import annotations

import math
from datetime import UTC, datetime

import pandas as pd
import psycopg
import pytest

from dockcast_ml import db


@pytest.mark.db
def test_copy_df_writes_nan_as_null(db_conn: psycopg.Connection, synthetic_city: int) -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    frame = pd.DataFrame(
        {
            "city_id": [synthetic_city, synthetic_city],
            "hour": [now, now.replace(hour=1)],
            "temp_c": [5.0, float("nan")],
            "precip_mm": [float("nan"), 1.5],
            "wind_kmh": [10.0, 12.0],
        }
    )
    with db_conn.cursor() as cur:
        n = db.copy_df(cur, "weather_history", frame)
    db_conn.commit()
    assert n == 2

    rows = db.fetch_df(
        db_conn,
        "SELECT temp_c, precip_mm FROM weather_history WHERE city_id=%(c)s ORDER BY hour",
        {"c": synthetic_city},
    )
    assert rows["temp_c"].iloc[0] == pytest.approx(5.0)
    assert math.isnan(rows["precip_mm"].iloc[0]) or rows["precip_mm"].iloc[0] is None
    assert rows["temp_c"].iloc[1] is None or math.isnan(rows["temp_c"].iloc[1])
    assert rows["precip_mm"].iloc[1] == pytest.approx(1.5)


@pytest.mark.db
def test_upsert_rows_inserts_then_updates(db_conn: psycopg.Connection, synthetic_city: int) -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    cols = ["city_id", "temp_bin", "precip_bin", "m", "fitted_at"]
    with db_conn.cursor() as cur:
        n1 = db.upsert_rows(
            cur, "weather_multipliers", cols, ["city_id", "temp_bin", "precip_bin"], ["m", "fitted_at"],
            [(synthetic_city, 0, 0, 1.0, now)],
        )
    db_conn.commit()
    assert n1 == 1

    rows = db.fetch_df(
        db_conn, "SELECT m FROM weather_multipliers WHERE city_id=%(c)s AND temp_bin=0 AND precip_bin=0",
        {"c": synthetic_city},
    )
    assert rows["m"].iloc[0] == pytest.approx(1.0)

    with db_conn.cursor() as cur:
        n2 = db.upsert_rows(
            cur, "weather_multipliers", cols, ["city_id", "temp_bin", "precip_bin"], ["m", "fitted_at"],
            [(synthetic_city, 0, 0, 2.5, now)],
        )
    db_conn.commit()
    assert n2 == 1

    rows_after = db.fetch_df(
        db_conn, "SELECT count(*) AS n, max(m) AS m FROM weather_multipliers WHERE city_id=%(c)s AND temp_bin=0 AND precip_bin=0",
        {"c": synthetic_city},
    )
    assert int(rows_after["n"].iloc[0]) == 1  # updated in place, not duplicated
    assert rows_after["m"].iloc[0] == pytest.approx(2.5)


@pytest.mark.db
def test_worker_run_records_success_and_failure(db_conn: psycopg.Connection, synthetic_city: int) -> None:
    import os

    from dockcast_ml.config import Config

    cfg = Config(database_url=os.environ["DATABASE_URL_TEST"])

    with db.worker_run(cfg, "profile", synthetic_city) as summary:
        summary["ok_marker"] = True

    ok_rows = db.fetch_df(
        db_conn,
        "SELECT ok, summary FROM worker_runs WHERE city_id=%(c)s AND kind='profile'",
        {"c": synthetic_city},
    )
    assert len(ok_rows) == 1
    assert bool(ok_rows["ok"].iloc[0]) is True
    assert ok_rows["summary"].iloc[0]["ok_marker"] is True

    with pytest.raises(ValueError, match="boom"), db.worker_run(cfg, "profile", synthetic_city) as summary:
        summary["partial"] = 1
        raise ValueError("boom")

    fail_rows = db.fetch_df(
        db_conn,
        "SELECT ok, error, summary FROM worker_runs WHERE city_id=%(c)s AND kind='profile' AND ok=false",
        {"c": synthetic_city},
    )
    assert len(fail_rows) == 1
    assert "boom" in fail_rows["error"].iloc[0]
    assert fail_rows["summary"].iloc[0]["partial"] == 1
