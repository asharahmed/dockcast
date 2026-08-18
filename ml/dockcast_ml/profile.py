"""Recent climatology / rolling time-of-day profile (docs/ml-spec.md §3.2 items 37-39,
docs/worker-spec.md §6.1).

`RollingProfile` is the single implementation used both by the nightly `profile`
job (28 days ending yesterday, written to `station_tod_profile`) and by WP-6's
`train.py` (rolling window advanced day by day, recomputed strictly from prior
days) so offline == online by construction (ml-spec Invariant L0).

**[decision]** `worker-spec.md`'s signatures for `RollingProfile.__init__` /
`.to_frame` are terse pseudocode (`__init__(self, S: int, max_days: int = 28)`,
`to_frame(self, built_for: date) -> pd.DataFrame`) and omit two values that are
structurally required: a `ZoneInfo` (to convert each 1-minute UTC grid column
to a local minute-of-day / bucket inside `add_day`) and the actual
`station_pk` values (`to_frame` must emit a `station_pk` column, and `S` alone
is just a count). This implementation therefore takes `tz: ZoneInfo` and
`station_pks: np.ndarray` in `__init__` instead of a bare `S: int` — `S` is
`len(station_pks)`. Recorded here for WP-6, which constructs `RollingProfile`
directly.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from datetime import date, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import psycopg

from dockcast_ml import db
from dockcast_ml.grid import GridArrays, load_city_grid
from dockcast_ml.timeutil import day_type, local_midnight

N_DAY_TYPES = 3
N_BUCKETS = 96

_TABLE_COLS = ["station_pk", "day_type", "bucket", "mean_fill", "p_bike", "p_dock", "n", "built_for"]


@dataclass
class _DayEntry:
    d: date
    day_type: int
    sum_fill: np.ndarray  # (S,96)
    sum_bike: np.ndarray  # (S,96)
    sum_dock: np.ndarray  # (S,96)
    n: np.ndarray  # (S,96)


class RollingProfile:
    """Per-`(station, day_type, bucket)` means over a rolling set of prior local days."""

    def __init__(self, tz: ZoneInfo, station_pks: np.ndarray, max_days: int = 28) -> None:
        self.tz = tz
        self.station_pks = np.asarray(station_pks, dtype=np.int32)
        self.pos = {int(pk): i for i, pk in enumerate(self.station_pks)}
        self.s = len(self.station_pks)
        self.max_days = max_days
        self.sum_fill = np.zeros((N_DAY_TYPES, self.s, N_BUCKETS), dtype=np.float64)
        self.sum_bike = np.zeros((N_DAY_TYPES, self.s, N_BUCKETS), dtype=np.float64)
        self.sum_dock = np.zeros((N_DAY_TYPES, self.s, N_BUCKETS), dtype=np.float64)
        self.n = np.zeros((N_DAY_TYPES, self.s, N_BUCKETS), dtype=np.float64)
        self._days: deque[_DayEntry] = deque()

    def _aggregate_day(
        self, grid: GridArrays, day_cols: slice
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        local_times = grid.t_index[day_cols].tz_convert(self.tz)
        minute_of_day = local_times.hour.to_numpy() * 60 + local_times.minute.to_numpy()
        buckets = np.minimum(minute_of_day // 15, N_BUCKETS - 1)

        bikes = grid.bikes[:, day_cols].astype(np.float64)
        docks = grid.docks[:, day_cols].astype(np.float64)
        fresh = grid.fresh[:, day_cols]
        cap = bikes + docks
        valid = fresh & (cap > 0)

        safe_cap = np.where(cap > 0, cap, 1.0)
        fill = np.where(valid, bikes / safe_cap, 0.0)
        has_bike = np.where(valid, (bikes >= 1).astype(np.float64), 0.0)
        has_dock = np.where(valid, (docks >= 1).astype(np.float64), 0.0)
        n_valid = valid.astype(np.float64)

        sum_fill_day = np.zeros((self.s, N_BUCKETS), dtype=np.float64)
        sum_bike_day = np.zeros((self.s, N_BUCKETS), dtype=np.float64)
        sum_dock_day = np.zeros((self.s, N_BUCKETS), dtype=np.float64)
        n_day = np.zeros((self.s, N_BUCKETS), dtype=np.float64)
        for j in range(N_BUCKETS):
            mask = buckets == j
            if not mask.any():
                continue
            sum_fill_day[:, j] = fill[:, mask].sum(axis=1)
            sum_bike_day[:, j] = has_bike[:, mask].sum(axis=1)
            sum_dock_day[:, j] = has_dock[:, mask].sum(axis=1)
            n_day[:, j] = n_valid[:, mask].sum(axis=1)
        return sum_fill_day, sum_bike_day, sum_dock_day, n_day

    def add_day(self, d: date, day_type_: int, grid: GridArrays, day_cols: slice) -> None:
        """Aggregate local day `d` (day-type `day_type_`) from `grid[:, day_cols]` into the
        rolling totals, then evict entries older than `max_days`.
        """
        sum_fill_day, sum_bike_day, sum_dock_day, n_day = self._aggregate_day(grid, day_cols)
        self.sum_fill[day_type_] += sum_fill_day
        self.sum_bike[day_type_] += sum_bike_day
        self.sum_dock[day_type_] += sum_dock_day
        self.n[day_type_] += n_day
        self._days.append(
            _DayEntry(d=d, day_type=day_type_, sum_fill=sum_fill_day, sum_bike=sum_bike_day, sum_dock=sum_dock_day, n=n_day)
        )
        while len(self._days) > self.max_days:
            old = self._days.popleft()
            self.sum_fill[old.day_type] -= old.sum_fill
            self.sum_bike[old.day_type] -= old.sum_bike
            self.sum_dock[old.day_type] -= old.sum_dock
            self.n[old.day_type] -= old.n

    def lookup(
        self, day_type_arr: np.ndarray, bucket_arr: np.ndarray, station_row: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Vectorised lookup: `(fill, p_bike, p_dock)`, NaN where `n == 0`."""
        n = self.n[day_type_arr, station_row, bucket_arr]
        safe_n = np.where(n > 0, n, 1.0)
        fill = np.where(n > 0, self.sum_fill[day_type_arr, station_row, bucket_arr] / safe_n, np.nan)
        p_bike = np.where(n > 0, self.sum_bike[day_type_arr, station_row, bucket_arr] / safe_n, np.nan)
        p_dock = np.where(n > 0, self.sum_dock[day_type_arr, station_row, bucket_arr] / safe_n, np.nan)
        return fill, p_bike, p_dock

    def to_frame(self, built_for: date) -> pd.DataFrame:
        """Rows with `n > 0` only: `station_pk, day_type, bucket, mean_fill, p_bike, p_dock, n, built_for`."""
        k_idx, s_idx, j_idx = np.nonzero(self.n > 0)
        if k_idx.size == 0:
            return pd.DataFrame(columns=_TABLE_COLS)
        n_vals = self.n[k_idx, s_idx, j_idx]
        mean_fill = self.sum_fill[k_idx, s_idx, j_idx] / n_vals
        p_bike = self.sum_bike[k_idx, s_idx, j_idx] / n_vals
        p_dock = self.sum_dock[k_idx, s_idx, j_idx] / n_vals
        return pd.DataFrame(
            {
                "station_pk": self.station_pks[s_idx],
                "day_type": k_idx.astype(np.int16),
                "bucket": j_idx.astype(np.int16),
                "mean_fill": mean_fill.astype(np.float32),
                "p_bike": p_bike.astype(np.float32),
                "p_dock": p_dock.astype(np.float32),
                "n": n_vals.astype(np.int32),
                "built_for": built_for,
            }
        )

    @classmethod
    def from_table(
        cls, conn: psycopg.Connection, city_id: int, tz: ZoneInfo, station_pks: np.ndarray, max_days: int = 28
    ) -> RollingProfile:
        """Reconstruct a `RollingProfile` from the current `station_tod_profile` rows (`n > 0`
        only, by construction of `write_table`) — used by the predictor, which does not
        recompute the profile itself. `lookup()` on the result reproduces the stored means.
        """
        obj = cls(tz, station_pks, max_days=max_days)
        pks_list = [int(x) for x in obj.station_pks]
        df = db.fetch_df(
            conn,
            "SELECT p.station_pk, p.day_type, p.bucket, p.mean_fill, p.p_bike, p.p_dock, p.n "
            "FROM station_tod_profile p JOIN stations s ON s.id = p.station_pk "
            "WHERE s.city_id = %(city_id)s AND p.station_pk = ANY(%(pks)s)",
            {"city_id": city_id, "pks": pks_list},
        )
        if df.empty:
            return obj
        for row in df.itertuples(index=False):
            i = obj.pos.get(int(row.station_pk))
            if i is None:
                continue
            k, j, n = int(row.day_type), int(row.bucket), float(row.n)
            obj.n[k, i, j] = n
            obj.sum_fill[k, i, j] = float(row.mean_fill) * n if row.mean_fill is not None else 0.0
            obj.sum_bike[k, i, j] = float(row.p_bike) * n if row.p_bike is not None else 0.0
            obj.sum_dock[k, i, j] = float(row.p_dock) * n if row.p_dock is not None else 0.0
        return obj


def write_table(conn: psycopg.Connection, city_id: int, df: pd.DataFrame) -> None:
    """`DELETE` this city's `station_tod_profile` rows and `COPY` in `df` (one transaction)."""
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM station_tod_profile WHERE station_pk IN (SELECT id FROM stations WHERE city_id=%s)",
            (city_id,),
        )
        db.copy_df(cur, "station_tod_profile", df[_TABLE_COLS])
    conn.commit()


def build_rolling_profile(
    conn: psycopg.Connection,
    city_id: int,
    tz: ZoneInfo,
    hol: set[date],
    station_pks: np.ndarray,
    end_date_exclusive: date,
    max_days: int = 28,
) -> RollingProfile:
    """Build a `RollingProfile` over the `max_days` local days strictly before
    `end_date_exclusive` (i.e. `[end_date_exclusive - max_days, end_date_exclusive - 1]`),
    loading the grid one local day at a time. Used by the `profile` CLI command.
    """
    prof = RollingProfile(tz, station_pks, max_days=max_days)
    for offset in range(max_days, 0, -1):
        d = end_date_exclusive - timedelta(days=offset)
        day_start = local_midnight(d, tz)
        day_end_incl = local_midnight(d + timedelta(days=1), tz) - timedelta(minutes=1)
        grid = load_city_grid(conn, city_id, station_pks, day_start, day_end_incl)
        prof.add_day(d, day_type(d, hol), grid, slice(0, len(grid.t_index)))
    return prof


__all__ = ["RollingProfile", "write_table", "build_rolling_profile"]
