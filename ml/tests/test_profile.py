"""docs/worker-spec.md §6.1: RollingProfile (recent climatology, ml-spec §3.2 items 37-39)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import psycopg
import pytest

from dockcast_ml import db as dbmod
from dockcast_ml.grid import GridArrays
from dockcast_ml.profile import RollingProfile, write_table

TZ = ZoneInfo("America/Toronto")


def _synthetic_day_grid(day_start_utc: datetime, minutes: int, bikes_pattern: np.ndarray) -> GridArrays:
    """A single-station GridArrays for one local day: `bikes_pattern` (len==minutes), constant
    docks=10, all cells fresh.
    """
    t_index = pd.date_range(day_start_utc, periods=minutes, freq="1min", tz="UTC")
    bikes = bikes_pattern.reshape(1, -1).astype(np.int16)
    docks = np.full((1, minutes), 10, dtype=np.int16)
    ebikes = np.zeros((1, minutes), dtype=np.int16)
    fresh = np.ones((1, minutes), dtype=bool)
    return GridArrays(station_pks=np.array([1], dtype=np.int32), pos={1: 0}, t_index=t_index, bikes=bikes, docks=docks, ebikes=ebikes, fresh=fresh)


def test_add_day_and_lookup_means() -> None:
    """A single day where bucket 0 (minutes 0-14) always has bikes=5,docks=10 (fill=5/15) and
    bucket 1 (minutes 15-29) always has bikes=0 (fill=0, p_bike=0) => lookup reproduces those means.
    """
    day_start = datetime(2026, 6, 1, 0, 0, tzinfo=TZ).astimezone(UTC)  # Monday
    minutes = 30
    bikes_pattern = np.array([5] * 15 + [0] * 15, dtype=np.int16)
    grid = _synthetic_day_grid(day_start, minutes, bikes_pattern)

    prof = RollingProfile(TZ, station_pks=np.array([1], dtype=np.int32), max_days=28)
    prof.add_day(date(2026, 6, 1), day_type_=0, grid=grid, day_cols=slice(0, minutes))

    fill, p_bike, p_dock = prof.lookup(np.array([0]), np.array([0]), np.array([0]))
    assert fill[0] == pytest.approx(5 / 15.0)
    assert p_bike[0] == pytest.approx(1.0)
    assert p_dock[0] == pytest.approx(1.0)

    fill1, p_bike1, p_dock1 = prof.lookup(np.array([0]), np.array([1]), np.array([0]))
    assert fill1[0] == pytest.approx(0.0)
    assert p_bike1[0] == pytest.approx(0.0)
    assert p_dock1[0] == pytest.approx(1.0)

    # bucket never observed on this day_type -> NaN (n==0)
    fill_missing, p_bike_missing, _ = prof.lookup(np.array([1]), np.array([0]), np.array([0]))
    assert np.isnan(fill_missing[0])
    assert np.isnan(p_bike_missing[0])


def test_rolling_window_evicts_oldest_beyond_max_days() -> None:
    """29 days added with max_days=28 => the oldest day's contribution is fully evicted."""
    minutes = 15  # exactly one bucket
    prof = RollingProfile(TZ, station_pks=np.array([1], dtype=np.int32), max_days=28)

    base_day = date(2026, 5, 1)
    for offset in range(29):
        d = base_day + timedelta(days=offset)
        day_start = datetime(d.year, d.month, d.day, 0, 0, tzinfo=TZ).astimezone(UTC)
        # day 0 (to be evicted) has bikes=100 (an outlier); every later day has bikes=5
        bikes_val = 100 if offset == 0 else 5
        grid = _synthetic_day_grid(day_start, minutes, np.full(minutes, bikes_val, dtype=np.int16))
        prof.add_day(d, day_type_=0, grid=grid, day_cols=slice(0, minutes))

    fill, _, _ = prof.lookup(np.array([0]), np.array([0]), np.array([0]))
    # if day 0 (bikes=100) were still included, mean fill would be pulled way up
    expected_fill = 5 / 15.0  # bikes=5, docks=10 => fill = 5/15
    assert fill[0] == pytest.approx(expected_fill, abs=1e-9)
    assert len(prof._days) == 28


def test_to_frame_only_n_positive_rows() -> None:
    minutes = 15
    day_start = datetime(2026, 6, 1, 0, 0, tzinfo=TZ).astimezone(UTC)
    grid = _synthetic_day_grid(day_start, minutes, np.full(minutes, 5, dtype=np.int16))
    prof = RollingProfile(TZ, station_pks=np.array([42], dtype=np.int32), max_days=28)
    prof.add_day(date(2026, 6, 1), day_type_=0, grid=grid, day_cols=slice(0, minutes))

    frame = prof.to_frame(built_for=date(2026, 6, 2))
    assert len(frame) == 1  # only bucket 0, day_type 0 has n>0
    row = frame.iloc[0]
    assert int(row["station_pk"]) == 42
    assert int(row["day_type"]) == 0
    assert int(row["bucket"]) == 0
    assert int(row["n"]) == 15
    assert row["built_for"] == date(2026, 6, 2)
    assert row["mean_fill"] == pytest.approx(5 / 15.0)


@pytest.mark.db
def test_write_table_and_from_table_roundtrip(db_conn: psycopg.Connection, synthetic_city: int) -> None:
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO stations (city_id, station_id, name, lat, lon, capacity, is_active) "
            "VALUES (%s,'S1','Station 1',43.65,-79.38,20,true) RETURNING id",
            (synthetic_city,),
        )
        row = cur.fetchone()
    db_conn.commit()
    assert row is not None
    pk = row[0]

    minutes = 15
    day_start = datetime(2026, 6, 1, 0, 0, tzinfo=TZ).astimezone(UTC)
    grid = _synthetic_day_grid(day_start, minutes, np.full(minutes, 6, dtype=np.int16))
    grid.station_pks[:] = pk
    grid.pos = {pk: 0}
    prof = RollingProfile(TZ, station_pks=np.array([pk], dtype=np.int32), max_days=28)
    prof.add_day(date(2026, 6, 1), day_type_=0, grid=grid, day_cols=slice(0, minutes))

    frame = prof.to_frame(built_for=date(2026, 6, 2))
    write_table(db_conn, synthetic_city, frame)

    loaded = RollingProfile.from_table(db_conn, synthetic_city, TZ, np.array([pk], dtype=np.int32))
    fill, p_bike, p_dock = loaded.lookup(np.array([0]), np.array([0]), np.array([0]))
    assert fill[0] == pytest.approx(6 / 16.0, abs=1e-4)
    assert p_bike[0] == pytest.approx(1.0)
    assert p_dock[0] == pytest.approx(1.0)

    # write_table is a full DELETE+COPY (idempotent replace)
    write_table(db_conn, synthetic_city, frame)
    rows = dbmod.fetch_df(
        db_conn, "SELECT count(*) AS n FROM station_tod_profile WHERE station_pk=%(pk)s", {"pk": pk}
    )
    assert int(rows["n"].iloc[0]) == len(frame)
