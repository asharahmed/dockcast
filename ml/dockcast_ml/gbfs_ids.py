"""Station id/index helpers (docs/worker-spec.md §2.4)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import psycopg

from dockcast_ml import db


@dataclass
class StationIndex:
    pks: np.ndarray  # (S,) int32
    gbfs_ids: list[str]
    pos: dict[int, int]  # pk -> row index


def load_stations(conn: psycopg.Connection, city_id: int, active_only: bool = True) -> pd.DataFrame:
    sql = "SELECT id, station_id, name, lat, lon, capacity, is_active FROM stations WHERE city_id=%(c)s"
    if active_only:
        sql += " AND is_active"
    sql += " ORDER BY id"
    return db.fetch_df(conn, sql, {"c": city_id})


def station_index(df: pd.DataFrame) -> StationIndex:
    pks = df["id"].to_numpy(dtype=np.int32)
    gbfs_ids = df["station_id"].astype(str).tolist()
    pos = {int(pk): i for i, pk in enumerate(pks)}
    return StationIndex(pks=pks, gbfs_ids=gbfs_ids, pos=pos)
