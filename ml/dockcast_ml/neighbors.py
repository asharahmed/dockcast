"""k=3 nearest-neighbour stations by PostGIS geodesic distance (docs/worker-spec.md §4.5).

Referenced by `docs/worker-spec.md` §8.2 step 1 as `neighbors.rebuild(city)`.
"""

from __future__ import annotations

import psycopg

_DELETE_SQL = "DELETE FROM station_neighbors WHERE station_pk IN (SELECT id FROM stations WHERE city_id = %(c)s)"

_INSERT_SQL = """
INSERT INTO station_neighbors (station_pk, neighbor_pk, rank, distance_m)
SELECT a.id, b.id, b.rn, b.d
FROM stations a
CROSS JOIN LATERAL (
  SELECT s2.id, ST_Distance(a.geom, s2.geom) AS d, row_number() OVER (ORDER BY a.geom <-> s2.geom) AS rn
  FROM stations s2 WHERE s2.city_id = a.city_id AND s2.is_active AND s2.id <> a.id
  ORDER BY a.geom <-> s2.geom LIMIT 3) b
WHERE a.city_id = %(c)s AND a.is_active
"""


def rebuild(conn: psycopg.Connection, city_id: int) -> dict[str, int]:
    """Rebuild `station_neighbors` for `city_id`. Returns `{"n_rows": <inserted>}`."""
    with conn.cursor() as cur:
        cur.execute(_DELETE_SQL, {"c": city_id})
        cur.execute(_INSERT_SQL, {"c": city_id})
        n_rows = cur.rowcount
    conn.commit()
    return {"n_rows": n_rows}
