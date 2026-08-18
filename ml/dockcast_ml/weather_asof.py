"""Weather "as-of `t0`" lookup (docs/ml-spec.md §1.4, docs/worker-spec.md §3.2).

`WeatherAsOf` satisfies the structural `dockcast_ml.segments.WeatherAsOfLike`
protocol by construction: `segments.build_segments` and `features.py` both
consume it through `.at(t0, valid_hours)`. Temperature/precipitation binning
and the multiplier lookup live in `dockcast_ml.segments` (`temp_bin`,
`precip_bin`, `lookup_multiplier`) — this module does not redefine them.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import pandas as pd
import psycopg

from dockcast_ml import db

_VALUE_COLS = ["temp_c", "precip_mm", "precip_prob", "wind_kmh", "weather_code"]

_WINDOW_SQL = """
SELECT fetched_at, valid_hour, temp_c, precip_mm, precip_prob, wind_kmh, weather_code
FROM weather_forecasts
WHERE city_id = %(city_id)s AND fetched_at <= %(t_to)s AND fetched_at >= %(t_from)s - interval '48 hours'
  AND valid_hour >= %(t_from)s - interval '1 hour' AND valid_hour <= %(t_to)s + interval '3 hours'
"""


@dataclass
class WeatherRow:
    temp_c: float
    precip_mm: float
    precip_prob: float
    wind_kmh: float
    weather_code: float


class WeatherAsOf:
    """For each `valid_hour`, the row with the greatest `fetched_at <= t0`; missing -> NaN row."""

    def __init__(self, df: pd.DataFrame) -> None:
        self._df = df.copy() if not df.empty else pd.DataFrame(columns=["fetched_at", "valid_hour", *_VALUE_COLS])
        self._df["fetched_at"] = pd.to_datetime(self._df["fetched_at"], utc=True)
        self._df["valid_hour"] = pd.to_datetime(self._df["valid_hour"], utc=True)
        self._cache: dict[pd.Timestamp, pd.DataFrame] = {}

    def _as_of(self, t0: datetime) -> pd.DataFrame:
        key = pd.Timestamp(t0)
        cached = self._cache.get(key)
        if cached is not None:
            return cached
        sub = self._df[self._df["fetched_at"] <= key]
        sub = sub.sort_values("fetched_at").drop_duplicates("valid_hour", keep="last").set_index("valid_hour")
        self._cache[key] = sub
        return sub

    def at(self, t0: datetime, valid_hours: list[datetime]) -> pd.DataFrame:
        """Rows for `valid_hours` as known at `t0`; index = `valid_hour`, columns = `_VALUE_COLS`."""
        sub = self._as_of(t0)
        index = pd.to_datetime(pd.Index(list(valid_hours)), utc=True)
        return sub.reindex(index)[_VALUE_COLS]


def load_weather_window(conn: psycopg.Connection, city_id: int, t_from: datetime, t_to: datetime) -> WeatherAsOf:
    """Load a window of `weather_forecasts` wide enough to answer `.at(t0, ...)` for any
    `t0 in [t_from, t_to]` and any `valid_hour` up to 3 h past `t_to` (docs/worker-spec.md §3.2).
    """
    df = db.fetch_df(conn, _WINDOW_SQL, {"city_id": city_id, "t_from": t_from, "t_to": t_to})
    return WeatherAsOf(df)


__all__ = ["WeatherRow", "WeatherAsOf", "load_weather_window"]
