"""1-minute UTC as-of grid (docs/ml-spec.md §1.3, docs/worker-spec.md §3.1).

The single primitive used by `features.py`/`profile.py` (and by the predictor's
`bd`-input lookups) to answer "what was station s reporting, and was it fresh,
at any UTC instant in a time range". Built once per (city, time range) by
forward-filling `station_snapshots` (change-only history) onto a dense
1-minute grid, then masking cells that fail ml-spec §1.2 freshness.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import numpy as np
import pandas as pd
import psycopg

from dockcast_ml import db

_SEED_SQL = """
SELECT s.pk AS station_pk, x.ts, x.bikes, x.docks, x.ebikes,
       x.is_installed, x.is_renting, x.is_returning, x.last_reported
FROM unnest(%(pks)s::int[]) AS s(pk)
CROSS JOIN LATERAL (
    SELECT ts, bikes, docks, ebikes, is_installed, is_renting, is_returning, last_reported
    FROM station_snapshots
    WHERE station_pk = s.pk AND ts < %(t_start)s AND ts >= %(t_start)s - interval '30 days'
    ORDER BY ts DESC LIMIT 1
) x
"""

_RANGE_SQL = """
SELECT station_pk, ts, bikes, docks, ebikes, is_installed, is_renting, is_returning, last_reported
FROM station_snapshots
WHERE station_pk = ANY(%(pks)s) AND ts >= %(t_start)s AND ts <= %(t_end)s
ORDER BY station_pk, ts
"""

# Narrow dtypes for the range read (the large query here): every column below is NOT NULL in
# station_snapshots, and `load_city_grid` casts them to these same widths anyway.
_RANGE_DTYPES = {
    "station_pk": "int32",
    "bikes": "int16",
    "docks": "int16",
    "is_installed": "bool",
    "is_renting": "bool",
    "is_returning": "bool",
}

_POLLS_SQL = """
SELECT polled_at
FROM poll_log
WHERE city_id = %(city_id)s AND feed = 'station_status' AND ok
  AND polled_at >= %(t_start)s - interval '90 seconds' AND polled_at <= %(t_end)s
ORDER BY polled_at
"""

_FRESH_LAST_REPORTED_NS = 10 * 60 * 1_000_000_000
_FRESH_POLL_NS = 90 * 1_000_000_000


@dataclass
class GridArrays:
    station_pks: np.ndarray  # (S,) int32, sorted
    pos: dict[int, int]  # station_pk -> row index
    t_index: pd.DatetimeIndex  # (M,) UTC, freq 1min, [t_start floor, t_end floor]
    bikes: np.ndarray  # (S,M) int16, -1 = unknown
    docks: np.ndarray  # (S,M) int16, -1 = unknown
    ebikes: np.ndarray  # (S,M) int16, -1 = unknown
    fresh: np.ndarray  # (S,M) bool (ml-spec §1.2 conditions 1-3; NOT stations.is_active)

    def col(self, ts_utc: datetime) -> int:
        """Index of `floor(ts_utc, 1 min)` in `t_index`; raises `ValueError` if outside range."""
        floored = pd.Timestamp(ts_utc)
        floored = floored.tz_localize("UTC") if floored.tzinfo is None else floored.tz_convert("UTC")
        floored = floored.floor("min")
        offset = round((floored - self.t_index[0]).total_seconds() / 60.0)
        if offset < 0 or offset >= len(self.t_index):
            raise ValueError(f"{ts_utc} outside grid range [{self.t_index[0]}, {self.t_index[-1]}]")
        return int(offset)


def _to_ns(series: pd.Series) -> np.ndarray:
    return pd.to_datetime(series, utc=True).astype("int64").to_numpy()


def load_city_grid(
    conn: psycopg.Connection,
    city_id: int,
    station_pks: np.ndarray,
    t_start: datetime,
    t_end: datetime,
) -> GridArrays:
    """Build the 1-minute as-of grid for `station_pks` over `[t_start, t_end]` (docs/worker-spec.md §3.1)."""
    pks_sorted = np.sort(np.asarray(station_pks, dtype=np.int32))
    pos = {int(pk): i for i, pk in enumerate(pks_sorted)}
    s = len(pks_sorted)
    pks_list = [int(x) for x in pks_sorted]

    t_start_floor = pd.Timestamp(t_start).tz_convert("UTC").floor("min")
    t_end_floor = pd.Timestamp(t_end).tz_convert("UTC").floor("min")
    t_index = pd.date_range(t_start_floor, t_end_floor, freq="1min", tz="UTC")
    m = len(t_index)
    t_index_ns = t_index.astype("int64").to_numpy()

    seed = db.fetch_df(conn, _SEED_SQL, {"pks": pks_list, "t_start": t_start})
    rng = db.fetch_df_chunked(
        conn, _RANGE_SQL, {"pks": pks_list, "t_start": t_start, "t_end": t_end}, dtypes=_RANGE_DTYPES
    )
    frames = [f for f in (seed, rng) if not f.empty]
    rows = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()

    polls_df = db.fetch_df(conn, _POLLS_SQL, {"city_id": city_id, "t_start": t_start, "t_end": t_end})
    polls_ns = _to_ns(polls_df["polled_at"]) if not polls_df.empty else np.array([], dtype=np.int64)

    # Poll freshness (condition 1 of ml-spec §1.2) is shared across all stations/cells:
    # the collector polls the whole city's station_status feed in one request.
    poll_idx = np.searchsorted(polls_ns, t_index_ns, side="right") - 1
    has_poll = poll_idx >= 0
    poll_ok = np.zeros(m, dtype=bool)
    poll_ok[has_poll] = (t_index_ns[has_poll] - polls_ns[poll_idx[has_poll]]) <= _FRESH_POLL_NS

    bikes = np.full((s, m), -1, dtype=np.int16)
    docks = np.full((s, m), -1, dtype=np.int16)
    ebikes = np.full((s, m), -1, dtype=np.int16)
    fresh = np.zeros((s, m), dtype=bool)

    if not rows.empty:
        rows = rows.sort_values(["station_pk", "ts"])
        row_ts_ns = _to_ns(rows["ts"])
        row_lr_ns = _to_ns(rows["last_reported"])
        row_bikes = rows["bikes"].to_numpy(dtype=np.int16)
        row_docks = rows["docks"].to_numpy(dtype=np.int16)
        row_ebikes = pd.to_numeric(rows["ebikes"], errors="coerce").to_numpy(dtype=np.float64)
        row_flags = (
            rows["is_installed"].to_numpy(dtype=bool)
            & rows["is_renting"].to_numpy(dtype=bool)
            & rows["is_returning"].to_numpy(dtype=bool)
        )
        row_station_pk = rows["station_pk"].to_numpy(dtype=np.int32)

        for pk, i in pos.items():
            station_mask = row_station_pk == pk
            if not station_mask.any():
                continue
            r_ts = row_ts_ns[station_mask]
            r_lr = row_lr_ns[station_mask]
            r_bk = row_bikes[station_mask]
            r_dk = row_docks[station_mask]
            r_eb = row_ebikes[station_mask]
            r_fl = row_flags[station_mask]

            cell_pos = np.searchsorted(r_ts, t_index_ns, side="right") - 1
            valid = cell_pos >= 0
            safe_pos = np.clip(cell_pos, 0, len(r_ts) - 1)

            bikes[i, valid] = r_bk[safe_pos[valid]]
            docks[i, valid] = r_dk[safe_pos[valid]]
            eb_vals = r_eb[safe_pos[valid]]
            ebikes[i, valid] = np.where(np.isnan(eb_vals), -1, eb_vals).astype(np.int16)

            lr_ok = np.zeros(m, dtype=bool)
            lr_ok[valid] = (t_index_ns[valid] - r_lr[safe_pos[valid]]) <= _FRESH_LAST_REPORTED_NS
            flags_ok = np.zeros(m, dtype=bool)
            flags_ok[valid] = r_fl[safe_pos[valid]]

            fresh[i, :] = valid & flags_ok & lr_ok & poll_ok

    return GridArrays(
        station_pks=pks_sorted, pos=pos, t_index=t_index, bikes=bikes, docks=docks, ebikes=ebikes, fresh=fresh
    )


__all__ = ["GridArrays", "load_city_grid"]
