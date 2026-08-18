"""T9-T11 (docs/ml-spec.md §8): the 1-minute as-of grid (docs/worker-spec.md §3.1)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import numpy as np
import psycopg
import pytest

from dockcast_ml.grid import load_city_grid

T0 = datetime(2026, 6, 1, 12, 0, tzinfo=UTC)


def _insert_station(conn: psycopg.Connection, city_id: int) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO stations (city_id, station_id, name, lat, lon, capacity, is_active) "
            "VALUES (%s,%s,%s,%s,%s,%s,true) RETURNING id",
            (city_id, "S1", "Station 1", 43.65, -79.38, 25),
        )
        row = cur.fetchone()
    conn.commit()
    assert row is not None
    return row[0]


def _insert_snapshot(
    conn: psycopg.Connection,
    station_pk: int,
    ts: datetime,
    bikes: int,
    docks: int,
    last_reported: datetime,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO station_snapshots "
            "(station_pk, ts, bikes, docks, ebikes, is_installed, is_renting, is_returning, last_reported) "
            "VALUES (%s,%s,%s,%s,%s,true,true,true,%s)",
            (station_pk, ts, bikes, docks, 0, last_reported),
        )
    conn.commit()


def _insert_poll(conn: psycopg.Connection, city_id: int, polled_at: datetime) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO poll_log (city_id, polled_at, feed, ok, n_items, latency_ms) "
            "VALUES (%s,%s,'station_status',true,1,10)",
            (city_id, polled_at),
        )
    conn.commit()


@pytest.mark.db
def test_poll_gap_masks(db_conn: psycopg.Connection, synthetic_city: int) -> None:
    """T9: a gap in poll_log masks `fresh` from 90s after the last pre-gap poll until the next
    ok poll; values (ffill) are unaffected by the gap.
    """
    pk = _insert_station(db_conn, synthetic_city)
    _insert_snapshot(db_conn, pk, T0, bikes=5, docks=10, last_reported=T0)
    for m in (0, 1, 2, 7, 8, 9):
        _insert_poll(db_conn, synthetic_city, T0 + timedelta(minutes=m))

    grid = load_city_grid(db_conn, synthetic_city, np.array([pk]), T0, T0 + timedelta(minutes=9))
    assert (grid.bikes[0] == 5).all()
    assert (grid.docks[0] == 10).all()

    expected_fresh = [True, True, True, True, False, False, False, True, True, True]
    assert list(grid.fresh[0]) == expected_fresh


@pytest.mark.db
def test_stale_last_reported(db_conn: psycopg.Connection, synthetic_city: int) -> None:
    """T10: `last_reported` 11 min old at every point in the window => `fresh` False throughout,
    even with an unbroken poll_log.
    """
    pk = _insert_station(db_conn, synthetic_city)
    _insert_snapshot(db_conn, pk, T0, bikes=5, docks=10, last_reported=T0 - timedelta(minutes=11))
    for m in range(3):
        _insert_poll(db_conn, synthetic_city, T0 + timedelta(minutes=m))

    grid = load_city_grid(db_conn, synthetic_city, np.array([pk]), T0, T0 + timedelta(minutes=2))
    assert not grid.fresh[0].any()
    assert (grid.bikes[0] == 5).all()


@pytest.mark.db
def test_change_only_equals_dense(db_conn: psycopg.Connection, synthetic_city: int) -> None:
    """T11: change-only compression of a synthetic dense series reconstructs identically via ffill."""
    pk = _insert_station(db_conn, synthetic_city)
    dense_bikes = [5, 5, 5, 6, 6, 7, 7, 7, 7, 8]  # minute 0..9, changes at 3, 5, 9
    change_points = [0, 3, 5, 9]
    for m in change_points:
        ts = T0 + timedelta(minutes=m)
        _insert_snapshot(db_conn, pk, ts, bikes=dense_bikes[m], docks=15, last_reported=ts)
    for m in range(10):
        _insert_poll(db_conn, synthetic_city, T0 + timedelta(minutes=m))

    grid = load_city_grid(db_conn, synthetic_city, np.array([pk]), T0, T0 + timedelta(minutes=9))
    assert list(grid.bikes[0]) == dense_bikes
    assert (grid.docks[0] == 15).all()
    assert grid.fresh[0].all()


@pytest.mark.db
def test_col_and_seed_lookback(db_conn: psycopg.Connection, synthetic_city: int) -> None:
    """`col()` maps a timestamp to the correct grid index, and a snapshot written before
    `t_start` still seeds the ffill (the "seed" query, up to 30 days back).
    """
    pk = _insert_station(db_conn, synthetic_city)
    seed_ts = T0 - timedelta(minutes=5)
    _insert_snapshot(db_conn, pk, seed_ts, bikes=3, docks=12, last_reported=seed_ts)
    for m in range(3):
        _insert_poll(db_conn, synthetic_city, T0 + timedelta(minutes=m))

    grid = load_city_grid(db_conn, synthetic_city, np.array([pk]), T0, T0 + timedelta(minutes=2))
    assert grid.col(T0) == 0
    assert grid.col(T0 + timedelta(minutes=2)) == 2
    with pytest.raises(ValueError):
        grid.col(T0 - timedelta(minutes=1))
    # seeded from before t_start, ffilled across the whole window
    assert (grid.bikes[0] == 3).all()
