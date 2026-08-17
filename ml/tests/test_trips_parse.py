"""docs/ml-spec.md §1.5 parsing rules against fixtures/trips/*.csv and synthetic drop cases.

NOTE (see WP-4 final report): docs/worker-spec.md §9's test table states
"bikeshare_2025_08_head2000.csv: 2000 rows in, n_dropped == 0" and
"bikeshare-ridership-2026_head2000.csv: ... all rows kept". Verified directly
against the real fixture files, both contain rows with an empty
`End_Station_Id` (1 in the 2025 fixture, 5 in the 2026 fixture), which
docs/ml-spec.md §1.5's own drop rule ("Drop rows where either station id or
either timestamp is empty/unparseable") correctly removes. This test asserts
the verified ground truth (1999/2000 and 1995/2000 kept) rather than the
worker-spec table's counts.
"""

from __future__ import annotations

import io
from datetime import UTC, date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import pytest

from dockcast_ml.bootstrap.trips import aggregate, iter_trip_chunks

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES = REPO_ROOT / "fixtures" / "trips"
TZ = ZoneInfo("America/Toronto")


def _read_all(path: Path, month_from: date, month_to: date) -> pd.DataFrame:
    chunks = list(iter_trip_chunks([path], month_from, month_to, TZ))
    assert len(chunks) == 1  # 2000 rows < CHUNK_SIZE (200_000)
    return chunks[0]


def test_2025_fixture_row_counts_and_drop() -> None:
    path = FIXTURES / "bikeshare_2025_08_head2000.csv"
    chunk = _read_all(path, date(2025, 8, 1), date(2025, 8, 31))
    assert chunk.attrs["n_in"] == 2000
    assert chunk.attrs["n_dropped"] == 1
    assert len(chunk) == 1999


def test_2026_fixture_float_id_normalisation_and_drop() -> None:
    path = FIXTURES / "bikeshare-ridership-2026_head2000.csv"
    chunk = _read_all(path, date(2026, 1, 1), date(2026, 1, 31))
    assert chunk.attrs["n_in"] == 2000
    assert chunk.attrs["n_dropped"] == 5
    assert len(chunk) == 1995
    # ids rendered as "7037.0" in the CSV must normalise to "7037" (no ".0" suffix, no leading zeros lost)
    assert not chunk["start_id"].str.contains(r"\.").any()
    assert not chunk["end_id"].str.contains(r"\.").any()
    assert (chunk["start_id"] == "7719").any()
    assert (chunk["end_id"] == "7037").any()


def test_synthetic_drop_rules() -> None:
    csv_text = (
        "Trip_Id,Trip_Duration,Start_Station_Id,Start_Time,Start_Station_Name,"
        "End_Station_Id,End_Time,End_Station_Name,Bike_Id,User_Type,Bike_Model\n"
        # kept: normal trip
        "1,300,100,2026-01-01 08:00:00,A,101,2026-01-01 08:05:00,B,1,Member,ICONIC\n"
        # dropped: empty End_Station_Id
        "2,300,100,2026-01-01 08:00:00,A,,2026-01-01 08:05:00,B,1,Member,ICONIC\n"
        # dropped: end < start
        "3,300,100,2026-01-01 08:10:00,A,101,2026-01-01 08:00:00,B,1,Member,ICONIC\n"
        # dropped: duration > 24h (25h)
        "4,300,100,2026-01-01 08:00:00,A,101,2026-01-02 09:00:00,B,1,Member,ICONIC\n"
        # kept: float-rendered station id, duration exactly 24h (boundary, not dropped)
        "5,300,100.0,2026-01-01 08:00:00,A,101.0,2026-01-02 08:00:00,B,1,Member,ICONIC\n"
    )
    chunks = list(iter_trip_chunks([io.StringIO(csv_text)], date(2026, 1, 1), date(2026, 1, 31), TZ))
    assert len(chunks) == 1
    chunk = chunks[0]
    assert chunk.attrs["n_in"] == 5
    assert chunk.attrs["n_dropped"] == 3
    assert len(chunk) == 2
    assert set(chunk["start_id"]) == {"100"}
    assert set(chunk["end_id"]) == {"101"}


def test_missing_header_raises() -> None:
    csv_text = "Not_The_Right,Header\n1,2\n"
    with pytest.raises(ValueError, match="unexpected header"):
        list(iter_trip_chunks([io.StringIO(csv_text)], date(2026, 1, 1), date(2026, 1, 31), TZ))


def test_aggregate_bucket_counts_and_span() -> None:
    csv_text = (
        "Trip_Id,Trip_Duration,Start_Station_Id,Start_Time,Start_Station_Name,"
        "End_Station_Id,End_Time,End_Station_Name,Bike_Id,User_Type,Bike_Model\n"
        "1,300,100,2026-01-05 08:03:00,A,101,2026-01-05 08:12:00,B,1,Member,ICONIC\n"  # Mon, WD
        "2,300,100,2026-01-05 08:07:00,A,101,2026-01-05 08:20:00,B,1,Member,ICONIC\n"  # same bucket start
        "3,300,102,2026-01-10 09:00:00,A,100,2026-01-10 09:05:00,B,1,Member,ICONIC\n"  # Sat
    )
    chunks = list(iter_trip_chunks([io.StringIO(csv_text)], date(2026, 1, 1), date(2026, 1, 31), TZ))
    agg = aggregate(chunks, TZ, hol=set())

    assert agg.n_trips == 3
    assert agg.n_dropped == 0

    # bucket for 08:03 and 08:07 local -> minute 483..487 -> bucket 32 (480//15=32), day_type WD=0
    assert agg.bucket_counts[("100", 0, 32)][0] == 2  # n_start
    # end times 08:12 (bucket 32) and 08:20 (bucket 33)
    assert agg.bucket_counts[("101", 0, 32)][1] == 1  # n_end
    assert agg.bucket_counts[("101", 0, 33)][1] == 1

    # Saturday trip: day_type=1
    assert agg.bucket_counts[("102", 1, 36)][0] == 1  # 09:00 -> bucket 36

    # station "100" is also the end station of trip 3 (Jan 10), so its span extends to it
    assert agg.span["100"] == [date(2026, 1, 5), date(2026, 1, 10)]
    assert agg.span["101"] == [date(2026, 1, 5), date(2026, 1, 5)]
    assert agg.span["102"] == [date(2026, 1, 10), date(2026, 1, 10)]

    # hourly UTC counts: 08:03/08:07 EST (UTC-5, non-DST Jan) -> 13:00 UTC hour
    assert agg.hourly[datetime(2026, 1, 5, 13, 0, tzinfo=UTC)] == 2
