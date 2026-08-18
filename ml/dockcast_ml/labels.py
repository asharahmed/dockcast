"""Label materialisation (docs/ml-spec.md §5.4, docs/worker-spec.md §6.3).

Nightly (and before training), for every `forecast_history` origin whose
`t0+h` has passed, compute the realised outcome and write it to
`forecast_labels`. Idempotent: an `EXCEPT` against already-materialised rows
plus `ON CONFLICT DO NOTHING` means re-running is a no-op.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

import numpy as np
import pandas as pd
import psycopg

from dockcast_ml import db
from dockcast_ml.features import build_labels
from dockcast_ml.gbfs_ids import load_stations
from dockcast_ml.grid import load_city_grid
from dockcast_ml.timeutil import local_date, local_midnight, tz_of

_LAST_LABEL_SQL = """
SELECT max(l.t0) AS m
FROM forecast_labels l JOIN stations s ON s.id = l.station_pk
WHERE s.city_id = %(city_id)s
"""

_MIN_HISTORY_SQL = """
SELECT min(h.t0) AS m
FROM forecast_history h JOIN stations s ON s.id = h.station_pk
WHERE s.city_id = %(city_id)s AND h.tier = 'bd_raw'
"""

_CANDIDATE_SQL = """
SELECT h.station_pk, h.t0, h.horizon
FROM forecast_history h
WHERE h.tier = 'bd_raw' AND h.t0 >= %(day_start)s AND h.t0 < %(day_end)s
  AND h.station_pk = ANY(%(pks)s)
  AND h.t0 + (h.horizon || ' minutes')::interval <= %(now)s - interval '5 minutes'
EXCEPT
SELECT station_pk, t0, horizon
FROM forecast_labels
WHERE t0 >= %(day_start)s AND t0 < %(day_end)s
"""

_LABEL_COLS = ["station_pk", "t0", "horizon", "bikes0", "docks0", "y_bike", "y_dock", "y_cnt"]


def materialise_labels(conn: psycopg.Connection, city: dict[str, Any], now: datetime) -> dict[str, int]:
    """Materialise `forecast_labels` for `city` for every `forecast_history(tier='bd_raw')`
    origin whose `t0+h` has passed (with a 5-minute safety margin). Returns
    `{'n_rows': <written>, 'days': <local days processed>}`.
    """
    city_id = int(city["id"])
    tz = tz_of(city["tz"])

    last_row = db.fetch_df(conn, _LAST_LABEL_SQL, {"city_id": city_id})
    last = last_row["m"].iloc[0] if not last_row.empty else None
    if last is None or pd.isna(last):
        min_row = db.fetch_df(conn, _MIN_HISTORY_SQL, {"city_id": city_id})
        last = min_row["m"].iloc[0] if not min_row.empty else None
    if last is None or pd.isna(last):
        return {"n_rows": 0, "days": 0}
    last = last.to_pydatetime() if isinstance(last, pd.Timestamp) else last

    range_start = last - timedelta(days=1)
    range_end = now - timedelta(minutes=125)
    if range_end < range_start:
        return {"n_rows": 0, "days": 0}

    start_date = local_date(range_start, tz)
    end_date = local_date(range_end, tz)

    stations_df = load_stations(conn, city_id, active_only=True)
    station_pks = stations_df["id"].to_numpy(dtype=np.int32)
    if len(station_pks) == 0:
        return {"n_rows": 0, "days": 0}
    pks_list = [int(x) for x in station_pks]

    n_rows_total = 0
    n_days = 0
    d = start_date
    while d <= end_date:
        day_start = local_midnight(d, tz)
        day_end = local_midnight(d + timedelta(days=1), tz)

        candidates = db.fetch_df(
            conn,
            _CANDIDATE_SQL,
            {"day_start": day_start, "day_end": day_end, "pks": pks_list, "now": now},
        )
        n_days += 1
        if candidates.empty:
            d += timedelta(days=1)
            continue

        grid = load_city_grid(conn, city_id, station_pks, day_start, day_end + timedelta(minutes=120))
        labelled = build_labels(grid, candidates[["station_pk", "t0", "horizon"]])
        labelled = labelled[labelled["label_ok"]]
        if labelled.empty:
            d += timedelta(days=1)
            continue

        out = labelled[_LABEL_COLS].copy()
        with conn.transaction(), conn.cursor() as cur:
            cur.execute("CREATE TEMP TABLE tmp_labels (LIKE forecast_labels) ON COMMIT DROP")
            db.copy_df(cur, "tmp_labels", out)
            cur.execute(
                "INSERT INTO forecast_labels SELECT * FROM tmp_labels "
                "ON CONFLICT (station_pk, t0, horizon) DO NOTHING"
            )
            n_rows_total += len(out)

        d += timedelta(days=1)

    return {"n_rows": n_rows_total, "days": n_days}


__all__ = ["materialise_labels"]
