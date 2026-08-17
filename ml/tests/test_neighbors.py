"""docs/worker-spec.md §4.5: k=3 nearest-neighbour stations by PostGIS geodesic distance."""

from __future__ import annotations

import psycopg
import pytest

from dockcast_ml import db as dbmod
from dockcast_ml.neighbors import rebuild

# 6 stations along a line of increasing longitude near downtown Toronto, ~150m apart.
_STATIONS = [
    (43.6532, -79.3832),
    (43.6532, -79.3822),
    (43.6532, -79.3812),
    (43.6532, -79.3802),
    (43.6532, -79.3792),
    (43.6532, -79.3782),
]


def _seed_stations(conn: psycopg.Connection, city_id: int, active_flags: list[bool] | None = None) -> list[int]:
    flags = active_flags or [True] * len(_STATIONS)
    pks: list[int] = []
    with conn.cursor() as cur:
        for i, ((lat, lon), active) in enumerate(zip(_STATIONS, flags, strict=True)):
            cur.execute(
                "INSERT INTO stations (city_id, station_id, name, lat, lon, capacity, is_active) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                (city_id, f"S{i}", f"Station {i}", lat, lon, 20, active),
            )
            row = cur.fetchone()
            assert row is not None
            pks.append(row[0])
    conn.commit()
    return pks


@pytest.mark.db
def test_neighbors_rebuild(db_conn: psycopg.Connection, synthetic_city: int) -> None:
    pks = _seed_stations(db_conn, synthetic_city)

    result = rebuild(db_conn, synthetic_city)
    assert result["n_rows"] == len(pks) * 3

    rows = dbmod.fetch_df(
        db_conn,
        "SELECT station_pk, neighbor_pk, rank, distance_m FROM station_neighbors "
        "WHERE station_pk = ANY(%(pks)s) ORDER BY station_pk, rank",
        {"pks": pks},
    )
    assert len(rows) == len(pks) * 3

    for pk in pks:
        station_rows = rows[rows["station_pk"] == pk].sort_values("rank")
        assert list(station_rows["rank"]) == [1, 2, 3]
        distances = station_rows["distance_m"].to_numpy()
        assert (distances[1:] >= distances[:-1]).all()  # ascending
        assert station_rows["neighbor_pk"].nunique() == 3
        assert pk not in set(station_rows["neighbor_pk"])  # never its own neighbour


@pytest.mark.db
def test_neighbors_excludes_inactive_stations(db_conn: psycopg.Connection, synthetic_city: int) -> None:
    active_flags = [True, True, False, True, True, True]
    pks = _seed_stations(db_conn, synthetic_city, active_flags)
    inactive_pk = pks[2]

    rebuild(db_conn, synthetic_city)

    rows = dbmod.fetch_df(
        db_conn,
        "SELECT station_pk, neighbor_pk FROM station_neighbors WHERE station_pk = ANY(%(pks)s)",
        {"pks": pks},
    )
    # the inactive station itself gets no neighbour rows written (query only selects active `a`)
    assert inactive_pk not in set(rows["station_pk"])
    # no active station lists the inactive one as a neighbour
    assert inactive_pk not in set(rows["neighbor_pk"])


@pytest.mark.db
def test_neighbors_rebuild_is_idempotent(db_conn: psycopg.Connection, synthetic_city: int) -> None:
    pks = _seed_stations(db_conn, synthetic_city)
    rebuild(db_conn, synthetic_city)
    result2 = rebuild(db_conn, synthetic_city)
    assert result2["n_rows"] == len(pks) * 3

    rows = dbmod.fetch_df(
        db_conn,
        "SELECT count(*) AS n FROM station_neighbors WHERE station_pk = ANY(%(pks)s)",
        {"pks": pks},
    )
    assert int(rows["n"].iloc[0]) == len(pks) * 3
