"""T8 (docs/ml-spec.md §8) plus general timeutil coverage."""

from __future__ import annotations

from datetime import UTC, date, datetime

import numpy as np

from dockcast_ml.timeutil import (
    bucket,
    ceil_to,
    day_type,
    day_type_array,
    floor_to,
    holiday_set,
    local_date,
    local_midnight,
    minute_of_day,
    to_local,
    tz_of,
)


def test_holiday_is_sun() -> None:
    hol = holiday_set("CA", "ON", years=[2026])
    assert date(2026, 7, 1) in hol  # Canada Day
    assert day_type(date(2026, 7, 1), hol) == 2
    assert day_type(date(2026, 7, 4), hol) == 1  # Saturday
    assert day_type(date(2026, 6, 30), hol) == 0  # Tuesday, non-holiday


def test_day_type_array_matches_scalar() -> None:
    hol = holiday_set("CA", "ON", years=[2026])
    days = [date(2026, 7, d) for d in range(1, 8)]
    dow = np.array([d.weekday() for d in days])
    is_hol = np.array([d in hol for d in days])
    vec = day_type_array(dow, is_hol)
    scalar = np.array([day_type(d, hol) for d in days])
    assert (vec == scalar).all()


def test_local_conversions() -> None:
    tz = tz_of("America/Toronto")
    ts_utc = datetime(2026, 7, 1, 16, 30, tzinfo=UTC)  # 12:30 EDT (UTC-4)
    local = to_local(ts_utc, tz)
    assert local.hour == 12
    assert local.minute == 30
    assert local_date(ts_utc, tz) == date(2026, 7, 1)
    assert minute_of_day(local) == 12 * 60 + 30
    assert bucket(local) == (12 * 60 + 30) // 15

    midnight = local_midnight(date(2026, 7, 1), tz)
    assert to_local(midnight, tz).hour == 0
    assert to_local(midnight, tz).minute == 0


def test_floor_ceil_to() -> None:
    ts = datetime(2026, 7, 1, 12, 7, 30, tzinfo=UTC)
    assert floor_to(ts, 300) == datetime(2026, 7, 1, 12, 5, 0, tzinfo=UTC)
    assert ceil_to(ts, 300) == datetime(2026, 7, 1, 12, 10, 0, tzinfo=UTC)
    on_grid = datetime(2026, 7, 1, 12, 5, 0, tzinfo=UTC)
    assert floor_to(on_grid, 300) == on_grid
    assert ceil_to(on_grid, 300) == on_grid
