"""Time and calendar helpers (docs/worker-spec.md §2.2, docs/ml-spec.md §0).

All datetimes handled here are timezone-aware. Never call `datetime.now()`
inside algorithms — callers pass `now` in explicitly so tests are
deterministic (docs/plan.md R9).
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import holidays as holidays_lib
import numpy as np


def tz_of(city_tz: str) -> ZoneInfo:
    return ZoneInfo(city_tz)


def to_local(ts_utc: datetime, tz: ZoneInfo) -> datetime:
    return ts_utc.astimezone(tz)


def local_date(ts_utc: datetime, tz: ZoneInfo) -> date:
    return to_local(ts_utc, tz).date()


def local_midnight(d: date, tz: ZoneInfo) -> datetime:
    """The aware UTC instant of local 00:00 on `d`."""
    return datetime(d.year, d.month, d.day, tzinfo=tz)


def minute_of_day(local_dt: datetime) -> int:
    return local_dt.hour * 60 + local_dt.minute


def bucket(local_dt: datetime) -> int:
    return minute_of_day(local_dt) // 15


def holiday_set(country: str, subdiv: str | None, years: Iterable[int]) -> set[date]:
    hol = holidays_lib.country_holidays(country, subdiv=subdiv, years=list(years))
    return set(hol.keys())


def day_type(d: date, hol: set[date]) -> int:
    """0 = WD (Mon-Fri non-holiday), 1 = SAT, 2 = SUN or holiday."""
    if d.weekday() == 5:
        return 1
    if d.weekday() == 6 or d in hol:
        return 2
    return 0


def day_type_array(dow: np.ndarray, is_holiday: np.ndarray) -> np.ndarray:
    """Vectorised `day_type`: `dow` (0=Mon..6=Sun) and `is_holiday` boolean, same shape."""
    return np.where(dow == 5, 1, np.where((dow == 6) | is_holiday, 2, 0))


def floor_to(ts_utc: datetime, seconds: int) -> datetime:
    epoch = ts_utc.timestamp()
    floored = (epoch // seconds) * seconds
    return datetime.fromtimestamp(floored, tz=UTC)


def ceil_to(ts_utc: datetime, seconds: int) -> datetime:
    epoch = ts_utc.timestamp()
    ceiled = -(-epoch // seconds) * seconds
    return datetime.fromtimestamp(ceiled, tz=UTC)


__all__ = [
    "tz_of",
    "to_local",
    "local_date",
    "local_midnight",
    "minute_of_day",
    "bucket",
    "holiday_set",
    "day_type",
    "day_type_array",
    "floor_to",
    "ceil_to",
]
