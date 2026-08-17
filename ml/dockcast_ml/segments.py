"""Station-independent piece of the birth-death forecast (docs/ml-spec.md §2.3,
docs/worker-spec.md §3.3): splits `(t0, t0+120min]` into piecewise-constant-rate
segments at 15-minute local bucket boundaries and UTC hour boundaries.

`build_segments` needs a weather "as-of" lookup (`.at(t0, valid_hours)`), whose
concrete implementation (`dockcast_ml.weather_asof.WeatherAsOf`) is built in a
later work package (WP-5). To avoid an import dependency on a module that does
not exist yet, the dependency is expressed as a structural `Protocol`
(`WeatherAsOfLike`) here; WP-5's `WeatherAsOf` satisfies it by construction.
The temperature/precipitation binning + multiplier lookup ("Weather multiplier
lookup" in docs/worker-spec.md §3.2) is implemented here too, since this module
is currently its only consumer — WP-5 should import `temp_bin`/`precip_bin`/
`lookup_multiplier` from here rather than redefining them.

Precondition: `t0` must be aware and fall on a whole minute (no seconds/
microseconds) — true of every `t0` produced by `timeutil.floor_to`/`ceil_to`
with a divisor of 60 or more, which is how the predictor always builds it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Protocol
from zoneinfo import ZoneInfo

import pandas as pd

from dockcast_ml.horizons import HORIZONS
from dockcast_ml.timeutil import bucket, day_type

TEMP_EDGES: tuple[float, ...] = (0, 10, 20, 30)
PRECIP_EDGES: tuple[float, ...] = (0.1, 1, 3)


class WeatherAsOfLike(Protocol):
    """Structural interface satisfied by `dockcast_ml.weather_asof.WeatherAsOf` (WP-5)."""

    def at(self, t0: datetime, valid_hours: list[datetime]) -> pd.DataFrame: ...  # noqa: D102


def temp_bin(temp_c: float | None) -> int | None:
    """Temperature bin per docs/ml-spec.md §2.2; `None`/NaN -> `None` (missing)."""
    if temp_c is None or pd.isna(temp_c):
        return None
    if temp_c < TEMP_EDGES[0]:
        return 0
    if temp_c < TEMP_EDGES[1]:
        return 1
    if temp_c < TEMP_EDGES[2]:
        return 2
    if temp_c < TEMP_EDGES[3]:
        return 3
    return 4


def precip_bin(precip_mm: float | None) -> int | None:
    """Precipitation bin per docs/ml-spec.md §2.2; `None`/NaN -> `None` (missing)."""
    if precip_mm is None or pd.isna(precip_mm):
        return None
    if precip_mm < PRECIP_EDGES[0]:
        return 0
    if precip_mm < PRECIP_EDGES[1]:
        return 1
    if precip_mm < PRECIP_EDGES[2]:
        return 2
    return 3


def lookup_multiplier(
    temp_c: float | None,
    precip_mm: float | None,
    multipliers: dict[tuple[int, int], float],
) -> float:
    """`m(w)`: missing temp/precip or missing multiplier entry -> 1.0."""
    tb = temp_bin(temp_c)
    pb = precip_bin(precip_mm)
    if tb is None or pb is None:
        return 1.0
    return multipliers.get((tb, pb), 1.0)


@dataclass
class Segment:
    dt_min: float
    day_type: int
    bucket: int
    m: float
    cum_end: float  # minutes since t0 at segment end


def _boundaries(t0: datetime, tz: ZoneInfo) -> list[datetime]:
    """Every horizon end, local 15-min bucket boundary, and UTC hour boundary in `(t0, t0+120]`."""
    horizon_boundaries = {t0 + timedelta(minutes=h) for h in HORIZONS}
    other_boundaries: set[datetime] = set()
    for i in range(1, HORIZONS[-1] + 1):
        candidate = t0 + timedelta(minutes=i)
        if candidate.second == 0 and candidate.microsecond == 0 and candidate.minute == 0:
            other_boundaries.add(candidate)  # UTC hour boundary
        local = candidate.astimezone(tz)
        if local.second == 0 and local.microsecond == 0 and local.minute % 15 == 0:
            other_boundaries.add(candidate)  # local 15-minute bucket boundary
    return sorted(horizon_boundaries | other_boundaries)


def build_segments(
    t0: datetime,
    tz: ZoneInfo,
    hol: set[date],
    weather: WeatherAsOfLike,
    multipliers: dict[tuple[int, int], float],
) -> list[Segment]:
    boundaries = _boundaries(t0, tz)
    hours = sorted({b.replace(minute=0, second=0, microsecond=0) for b in [t0, *boundaries]})
    weather_df = weather.at(t0, hours)

    segments: list[Segment] = []
    prev = t0
    for end in boundaries:
        dt_min = (end - prev).total_seconds() / 60.0
        local_start = prev.astimezone(tz)
        seg_hour = prev.replace(minute=0, second=0, microsecond=0)
        temp_c = precip_mm = None
        if seg_hour in weather_df.index:
            row = weather_df.loc[seg_hour]
            temp_c = row.get("temp_c")
            precip_mm = row.get("precip_mm")
        m = lookup_multiplier(temp_c, precip_mm, multipliers)
        cum_end = (end - t0).total_seconds() / 60.0
        segments.append(
            Segment(
                dt_min=dt_min,
                day_type=day_type(local_start.date(), hol),
                bucket=bucket(local_start),
                m=m,
                cum_end=cum_end,
            )
        )
        prev = end
    return segments
