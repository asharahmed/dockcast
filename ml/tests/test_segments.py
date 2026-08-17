"""docs/worker-spec.md §3.3: segments tile (t0, t0+120] exactly, every horizon is a cum_end,
and local bucket boundaries are respected across a DST transition day."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pandas as pd
import pytest

from dockcast_ml.horizons import HORIZONS
from dockcast_ml.segments import build_segments

TZ = ZoneInfo("America/Toronto")


class _FakeWeather:
    """No weather signal: every multiplier lookup falls back to 1.0 (missing temp/precip)."""

    def at(self, t0: datetime, valid_hours: list[datetime]) -> pd.DataFrame:
        return pd.DataFrame(
            {"temp_c": [float("nan")] * len(valid_hours), "precip_mm": [float("nan")] * len(valid_hours)},
            index=valid_hours,
        )


def _assert_tiles(segs) -> None:  # noqa: ANN001
    total = sum(s.dt_min for s in segs)
    assert abs(total - 120.0) < 1e-9
    cum = 0.0
    for s in segs:
        cum += s.dt_min
        assert abs(cum - s.cum_end) < 1e-9
    cum_ends = {s.cum_end for s in segs}
    for h in HORIZONS:
        assert any(abs(ce - h) < 1e-9 for ce in cum_ends)
    for s in segs:
        assert 0 <= s.bucket <= 95
        assert s.day_type in (0, 1, 2)
        assert s.m == pytest.approx(1.0)


def test_segment_invariants_non_dst() -> None:
    t0 = datetime(2026, 6, 1, 12, 0, tzinfo=UTC)
    segs = build_segments(t0, TZ, hol=set(), weather=_FakeWeather(), multipliers={})
    _assert_tiles(segs)


def test_segment_invariants_dst_fallback_day() -> None:
    """2026-11-01: America/Toronto DST ends at 02:00 EDT (06:00 UTC); local hour 01:00 repeats.

    Bucket boundaries are detected from the *minute* component of local time
    (hour-agnostic), so a 120-minute UTC window always crosses exactly 8 local
    15-minute marks regardless of DST (the fold changes which wall-clock hour
    a segment falls in, not how many boundaries there are). The DST-specific
    behaviour to verify is therefore that the *bucket* sequence folds back
    (goes non-monotonic) at the transition, reflecting wall-clock 01:00-01:59
    genuinely recurring — something that never happens outside a fall-back day.
    """
    t0 = datetime(2026, 11, 1, 5, 10, tzinfo=UTC)  # 01:10 EDT
    segs_dst = build_segments(t0, TZ, hol=set(), weather=_FakeWeather(), multipliers={})
    _assert_tiles(segs_dst)

    buckets = [s.bucket for s in segs_dst]
    assert any(b2 < b1 for b1, b2 in zip(buckets, buckets[1:], strict=False)), (
        f"expected a bucket fold-back across the DST transition, got {buckets}"
    )

    t0_normal = datetime(2026, 6, 1, 5, 10, tzinfo=UTC)  # same UTC-of-day, no DST change that day
    segs_normal = build_segments(t0_normal, TZ, hol=set(), weather=_FakeWeather(), multipliers={})
    _assert_tiles(segs_normal)
    buckets_normal = [s.bucket for s in segs_normal]
    assert all(b2 >= b1 for b1, b2 in zip(buckets_normal, buckets_normal[1:], strict=False))
    assert len(segs_dst) == len(segs_normal) == 14  # both tile 120 min into the same segment count


def test_boundary_at_transition_instant() -> None:
    t0 = datetime(2026, 11, 1, 5, 10, tzinfo=UTC)
    segs = build_segments(t0, TZ, hol=set(), weather=_FakeWeather(), multipliers={})
    boundary_instants = {t0}
    cum = 0.0
    for s in segs:
        cum += s.dt_min
        boundary_instants.add(t0 + timedelta(minutes=cum))
    transition_instant = datetime(2026, 11, 1, 6, 0, tzinfo=UTC)
    assert any(abs((b - transition_instant).total_seconds()) < 1e-6 for b in boundary_instants)
