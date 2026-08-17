"""Bootstrap DB integration test (docs/worker-spec.md §4.6): feeds the two fixture trip
CSVs and a synthetic weather archive through the full pipeline (trips -> weather_history ->
rates -> weather_glm -> neighbors) against a real migrated database.
"""

from __future__ import annotations

import json
import os
from datetime import date, timedelta
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
import psycopg
import pytest

from dockcast_ml import db as dbmod
from dockcast_ml.bootstrap.run import run_bootstrap
from dockcast_ml.config import Config

REPO_ROOT = Path(__file__).resolve().parents[2]
TRIPS_DIR = REPO_ROOT / "fixtures" / "trips"
GBFS_STATIONS = REPO_ROOT / "fixtures" / "gbfs" / "toronto_v3_station_information.json"

# station_ids that appear in both trip fixtures (verified) => expect source='trips'
TRIP_STATION_IDS = ["7000", "7001", "7002"]
# station_ids present in GBFS but absent from the trip fixtures => expect source='fallback'
FALLBACK_STATION_IDS = ["7066", "7086"]


def _seed_stations(conn: psycopg.Connection, city_id: int) -> None:
    stations_by_id = {s["station_id"]: s for s in json.loads(GBFS_STATIONS.read_text())["data"]["stations"]}
    with conn.cursor() as cur:
        for sid in TRIP_STATION_IDS + FALLBACK_STATION_IDS:
            s = stations_by_id[sid]
            cur.execute(
                "INSERT INTO stations (city_id, station_id, name, lat, lon, capacity, is_active) "
                "VALUES (%s,%s,%s,%s,%s,%s,true)",
                (city_id, sid, s["name"][0]["text"], s["lat"], s["lon"], s["capacity"]),
            )
    conn.commit()


def _synthetic_archive_handler(request: httpx.Request) -> httpx.Response:
    """Generates a plausible hourly payload matching whatever [start_date, end_date] was
    requested, so successive ≤92-day archive pages never collide on the same hour key."""
    params = dict(httpx.QueryParams(request.url.query))
    start = date.fromisoformat(params["start_date"])
    end = date.fromisoformat(params["end_date"])
    hours = pd.date_range(start, end + timedelta(days=1), freq="h", tz="UTC", inclusive="left")
    seed = abs(hash((start, end))) % (2**31)
    rng = np.random.default_rng(seed)
    payload = {
        "hourly": {
            "time": [h.strftime("%Y-%m-%dT%H:%M") for h in hours],
            "temperature_2m": rng.uniform(-15, 30, len(hours)).round(1).tolist(),
            "precipitation": rng.choice([0.0, 0.1, 0.5, 2.0], size=len(hours)).tolist(),
            "wind_speed_10m": rng.uniform(0, 30, len(hours)).round(1).tolist(),
        }
    }
    return httpx.Response(200, json=payload)


@pytest.mark.db
def test_bootstrap_full_pipeline(db_conn: psycopg.Connection, synthetic_city: int) -> None:
    _seed_stations(db_conn, synthetic_city)
    city = dbmod.fetch_df(db_conn, "SELECT * FROM cities WHERE id=%(c)s", {"c": synthetic_city}).iloc[0].to_dict()

    cfg = Config(database_url=os.environ["DATABASE_URL_TEST"], trips_cache_dir=Path("/tmp/unused"))
    weather_client = httpx.Client(transport=httpx.MockTransport(_synthetic_archive_handler))

    summary = run_bootstrap(
        cfg,
        db_conn,
        city,
        month_from=date(2025, 8, 1),
        month_to=date(2026, 1, 1),
        cache_dir=Path("/tmp/unused"),
        trips_csv_sources=[
            TRIPS_DIR / "bikeshare_2025_08_head2000.csv",
            TRIPS_DIR / "bikeshare-ridership-2026_head2000.csv",
        ],
        weather_http_client=weather_client,
    )

    assert summary["n_trips"] == 4000
    assert summary["n_dropped"] == 6  # 1 (2025 fixture) + 5 (2026 fixture), verified against real data

    bucket_rows = dbmod.fetch_df(
        db_conn, "SELECT count(*) AS n FROM trip_bucket_counts WHERE city_id=%(c)s", {"c": synthetic_city}
    )
    assert int(bucket_rows["n"].iloc[0]) > 0

    rates = dbmod.fetch_df(
        db_conn,
        "SELECT s.station_id, r.day_type, r.bucket, r.source "
        "FROM station_flow_rates r JOIN stations s ON s.id = r.station_pk "
        "WHERE s.city_id=%(c)s",
        {"c": synthetic_city},
    )
    for sid in TRIP_STATION_IDS:
        station_rows = rates[rates["station_id"] == sid]
        assert len(station_rows) == 288  # 3 day_types x 96 buckets
        assert (station_rows["source"] == "trips").any()
    for sid in FALLBACK_STATION_IDS:
        station_rows = rates[rates["station_id"] == sid]
        assert len(station_rows) == 288
        assert (station_rows["source"] == "fallback").all()

    multipliers = dbmod.fetch_df(
        db_conn, "SELECT temp_bin, precip_bin, m FROM weather_multipliers WHERE city_id=%(c)s", {"c": synthetic_city}
    )
    assert len(multipliers) == 20
    assert (multipliers["m"] >= 0.1).all()
    assert (multipliers["m"] <= 3.0).all()
    assert summary["glm"]["Z"] > 0  # mean-one normaliser: (m_raw/Z) has mean 1 over the window, by construction

    bootstrap_runs = dbmod.fetch_df(
        db_conn, "SELECT n_trips, n_dropped FROM bootstrap_runs WHERE city_id=%(c)s", {"c": synthetic_city}
    )
    assert len(bootstrap_runs) == 1
    assert int(bootstrap_runs["n_trips"].iloc[0]) == 4000
    assert int(bootstrap_runs["n_dropped"].iloc[0]) == 6

    worker_runs = dbmod.fetch_df(
        db_conn,
        "SELECT ok, kind FROM worker_runs WHERE city_id=%(c)s AND kind='bootstrap'",
        {"c": synthetic_city},
    )
    assert len(worker_runs) == 1
    assert bool(worker_runs["ok"].iloc[0]) is True

    # neighbors.rebuild ran as the last bootstrap step
    neighbor_rows = dbmod.fetch_df(
        db_conn,
        "SELECT count(*) AS n FROM station_neighbors sn JOIN stations s ON s.id = sn.station_pk "
        "WHERE s.city_id=%(c)s",
        {"c": synthetic_city},
    )
    assert int(neighbor_rows["n"].iloc[0]) == len(TRIP_STATION_IDS + FALLBACK_STATION_IDS) * 3


@pytest.mark.db
def test_bootstrap_fails_without_stations(db_conn: psycopg.Connection, synthetic_city: int) -> None:
    city = dbmod.fetch_df(db_conn, "SELECT * FROM cities WHERE id=%(c)s", {"c": synthetic_city}).iloc[0].to_dict()
    cfg = Config(database_url=os.environ["DATABASE_URL_TEST"], trips_cache_dir=Path("/tmp/unused"))

    with pytest.raises(RuntimeError, match="run the collector first"):
        run_bootstrap(
            cfg,
            db_conn,
            city,
            month_from=date(2025, 8, 1),
            month_to=date(2026, 1, 1),
            cache_dir=Path("/tmp/unused"),
            trips_csv_sources=[],
        )

    worker_runs = dbmod.fetch_df(
        db_conn,
        "SELECT ok, error FROM worker_runs WHERE city_id=%(c)s AND kind='bootstrap'",
        {"c": synthetic_city},
    )
    assert len(worker_runs) == 1
    assert bool(worker_runs["ok"].iloc[0]) is False
    assert "run the collector first" in worker_runs["error"].iloc[0]
