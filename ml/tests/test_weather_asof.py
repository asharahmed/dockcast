"""docs/ml-spec.md §1.4, docs/worker-spec.md §3.2: weather "as-of `t0`" lookup."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pandas as pd
import psycopg
import pytest

from dockcast_ml.weather_asof import WeatherAsOf, load_weather_window

H0 = datetime(2026, 6, 1, 12, 0, tzinfo=UTC)  # valid_hour 12:00


def _df(rows: list[tuple[datetime, datetime, float, float]]) -> pd.DataFrame:
    return pd.DataFrame(
        rows,
        columns=["fetched_at", "valid_hour", "temp_c", "precip_mm"],
    ).assign(precip_prob=50, wind_kmh=10.0, weather_code=1)


def test_as_of_picks_greatest_fetched_at_leq_t0() -> None:
    """For a given valid_hour, `.at(t0, ...)` returns the row with the greatest fetched_at <= t0."""
    rows = [
        (H0 - timedelta(hours=2), H0, 10.0, 0.0),
        (H0 - timedelta(hours=1), H0, 15.0, 0.5),
        (H0, H0, 20.0, 1.0),  # fetched exactly at t0 -- still eligible (<=)
        (H0 + timedelta(minutes=1), H0, 999.0, 999.0),  # fetched after t0 -- must be excluded
    ]
    w = WeatherAsOf(_df(rows))
    out = w.at(H0, [H0])
    assert out.loc[H0, "temp_c"] == 20.0
    assert out.loc[H0, "precip_mm"] == 1.0

    # slightly before the last eligible fetch: falls back to the second-to-last row
    out_earlier = w.at(H0 - timedelta(seconds=1), [H0])
    assert out_earlier.loc[H0, "temp_c"] == 15.0


def test_missing_valid_hour_is_nan_row() -> None:
    w = WeatherAsOf(_df([(H0 - timedelta(hours=1), H0, 10.0, 0.0)]))
    out = w.at(H0, [H0 + timedelta(hours=5)])
    assert len(out) == 1
    assert pd.isna(out.iloc[0]["temp_c"])
    assert pd.isna(out.iloc[0]["precip_mm"])


def test_empty_dataframe_all_nan() -> None:
    w = WeatherAsOf(pd.DataFrame(columns=["fetched_at", "valid_hour", "temp_c", "precip_mm", "precip_prob", "wind_kmh", "weather_code"]))
    out = w.at(H0, [H0, H0 + timedelta(hours=1)])
    assert len(out) == 2
    assert out["temp_c"].isna().all()


def test_no_fetch_before_t0_is_nan() -> None:
    """Only a fetch strictly after t0 exists -> as-of t0, nothing is known yet."""
    w = WeatherAsOf(_df([(H0 + timedelta(minutes=5), H0, 20.0, 1.0)]))
    out = w.at(H0, [H0])
    assert pd.isna(out.loc[H0, "temp_c"])


def test_multiple_hours_in_one_call() -> None:
    rows = [
        (H0 - timedelta(hours=1), H0, 10.0, 0.0),
        (H0 - timedelta(hours=1), H0 + timedelta(hours=1), 12.0, 0.2),
        (H0 - timedelta(hours=1), H0 + timedelta(hours=2), 14.0, 0.4),
    ]
    w = WeatherAsOf(_df(rows))
    hours = [H0, H0 + timedelta(hours=1), H0 + timedelta(hours=2)]
    out = w.at(H0 + timedelta(hours=3), hours)
    assert list(out["temp_c"]) == [10.0, 12.0, 14.0]


def test_cache_reused_across_calls_with_same_t0() -> None:
    """The as-of slice for a given t0 is cached; a second `.at()` call with the same t0 but a
    different valid_hours list still reflects the cached (correct) fetched_at cutoff.
    """
    rows = [
        (H0 - timedelta(hours=1), H0, 10.0, 0.0),
        (H0 - timedelta(hours=1), H0 + timedelta(hours=1), 12.0, 0.2),
    ]
    w = WeatherAsOf(_df(rows))
    out1 = w.at(H0, [H0])
    out2 = w.at(H0, [H0 + timedelta(hours=1)])
    assert out1.loc[H0, "temp_c"] == 10.0
    assert out2.loc[H0 + timedelta(hours=1), "temp_c"] == 12.0
    assert H0 in w._cache


def test_satisfies_weather_as_of_like_protocol() -> None:
    """`WeatherAsOf` satisfies `dockcast_ml.segments.WeatherAsOfLike` in practice: it can drive
    `segments.build_segments` (which is `WeatherAsOfLike`'s only real consumer). The protocol is
    not `@runtime_checkable`, so this is exercised rather than checked via `isinstance`.
    """
    from zoneinfo import ZoneInfo

    from dockcast_ml.segments import build_segments

    w = WeatherAsOf(
        _df([(H0 - timedelta(hours=1), H0, 15.0, 0.0), (H0 - timedelta(hours=1), H0 + timedelta(hours=1), 15.0, 0.0)])
    )
    segs = build_segments(H0, ZoneInfo("America/Toronto"), hol=set(), weather=w, multipliers={})
    assert len(segs) > 0


@pytest.mark.db
def test_load_weather_window_db(db_conn: psycopg.Connection, synthetic_city: int) -> None:
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO weather_forecasts (city_id, fetched_at, valid_hour, temp_c, precip_mm, precip_prob, wind_kmh, weather_code) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (synthetic_city, H0 - timedelta(minutes=30), H0, 18.5, 0.0, 10, 5.0, 1),
        )
    db_conn.commit()
    w = load_weather_window(db_conn, synthetic_city, H0, H0)
    out = w.at(H0, [H0])
    assert abs(float(out.loc[H0, "temp_c"]) - 18.5) < 1e-4
