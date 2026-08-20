"""Trip-history CSV parsing and aggregation (docs/ml-spec.md §1.5, docs/worker-spec.md §4.1).

`iter_trip_chunks` takes an iterable of CSV sources (a path, string, or
file-like object — anything `pandas.read_csv` accepts) rather than the single
`zip_path` shown in docs/worker-spec.md §4.1. This is a deliberate, minimal
signature generalisation (not a change to the parsing/aggregation math) that
lets tests inject `fixtures/trips/*.csv` directly without a network call or a
real zip archive, per the WP-4 task brief ("an injectable file provider").
Zip handling lives in `iter_trip_chunks_from_zip`; discovery/download of the
actual published dumps lives in `bootstrap/trip_sources/` adapters, selected
by `cities.trip_source` (docs/add-a-city.md).
"""

from __future__ import annotations

import calendar
import io
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import IO
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import psycopg

from dockcast_ml import db
from dockcast_ml.config import Config
from dockcast_ml.timeutil import day_type_array, holiday_set, local_midnight

COLS = ["Start_Station_Id", "Start_Time", "End_Station_Id", "End_Time"]
CHUNK_SIZE = 200_000

CsvSource = str | Path | IO[str] | IO[bytes]


def _month_to_end(month_to: date) -> date:
    last_day = calendar.monthrange(month_to.year, month_to.month)[1]
    return date(month_to.year, month_to.month, last_day)


def _clean_chunk(chunk: pd.DataFrame, month_from: date, month_to: date, tz: ZoneInfo) -> pd.DataFrame:
    """Apply the drop rules and id/timestamp normalisation for one raw CSV chunk."""
    n_in = len(chunk)

    start_id = pd.to_numeric(chunk["Start_Station_Id"].astype(str).str.strip(), errors="coerce")
    end_id = pd.to_numeric(chunk["End_Station_Id"].astype(str).str.strip(), errors="coerce")
    start_ts = pd.to_datetime(
        chunk["Start_Time"].astype(str).str.strip(), format="%Y-%m-%d %H:%M:%S", errors="coerce"
    )
    end_ts = pd.to_datetime(
        chunk["End_Time"].astype(str).str.strip(), format="%Y-%m-%d %H:%M:%S", errors="coerce"
    )

    valid = start_id.notna() & end_id.notna() & start_ts.notna() & end_ts.notna()
    valid &= end_ts >= start_ts
    # `.dt.total_seconds()` avoids a pandas/numpy Timedelta-comparison deprecation warning
    # (implicit "generic unit" conversion) seen with pandas>=2.3 + numpy>=2.5.
    valid &= (end_ts - start_ts).dt.total_seconds() <= 24 * 3600

    month_to_end = _month_to_end(month_to)
    start_date = start_ts.dt.date
    valid &= (start_date >= month_from) & (start_date <= month_to_end)

    kept = pd.DataFrame(
        {
            "start_id": start_id[valid].astype("int64").astype(str).to_numpy(),
            "end_id": end_id[valid].astype("int64").astype(str).to_numpy(),
            "start_ts": start_ts[valid].to_numpy(),
            "end_ts": end_ts[valid].to_numpy(),
        }
    )
    kept.attrs["n_in"] = n_in
    kept.attrs["n_dropped"] = n_in - len(kept)
    return kept


def iter_trip_chunks(
    csv_sources: Iterable[CsvSource], month_from: date, month_to: date, tz: ZoneInfo
) -> Iterator[pd.DataFrame]:
    """Stream cleaned chunks from CSV sources; missing expected column -> ValueError."""
    for source in csv_sources:
        for raw_chunk in pd.read_csv(
            source,
            usecols=lambda c: c in COLS,
            dtype=str,
            chunksize=CHUNK_SIZE,
            encoding="utf-8",
            encoding_errors="replace",
        ):
            missing = [c for c in COLS if c not in raw_chunk.columns]
            if missing:
                raise ValueError(f"unexpected header: missing columns {missing}")
            yield _clean_chunk(raw_chunk, month_from, month_to, tz)


def iter_trip_chunks_from_zip(
    zip_path: Path, month_from: date, month_to: date, tz: ZoneInfo
) -> Iterator[pd.DataFrame]:
    """Production path: open every `*.csv` member of `zip_path` and delegate to `iter_trip_chunks`."""
    with zipfile.ZipFile(zip_path) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        for name in names:
            with zf.open(name) as fh:
                text = io.TextIOWrapper(fh, encoding="utf-8", errors="replace")
                yield from iter_trip_chunks([text], month_from, month_to, tz)


@dataclass
class TripAgg:
    bucket_counts: dict[tuple[str, int, int], list[int]] = field(default_factory=dict)
    span: dict[str, list[date]] = field(default_factory=dict)
    hourly: dict[datetime, int] = field(default_factory=dict)
    n_trips: int = 0
    n_dropped: int = 0


def _update_span(span: dict[str, list[date]], sid: str, d: date) -> None:
    if sid not in span:
        span[sid] = [d, d]
    else:
        entry = span[sid]
        if d < entry[0]:
            entry[0] = d
        if d > entry[1]:
            entry[1] = d


def aggregate(chunks: Iterable[pd.DataFrame], tz: ZoneInfo, hol: set[date]) -> TripAgg:
    """Streaming aggregation only: nothing row-level is retained across chunks."""
    bucket_counts: dict[tuple[str, int, int], list[int]] = defaultdict(lambda: [0, 0])
    span: dict[str, list[date]] = {}
    hourly: dict[datetime, int] = defaultdict(int)
    n_trips = 0
    n_dropped = 0

    for chunk in chunks:
        n_trips += chunk.attrs.get("n_in", len(chunk))
        n_dropped += chunk.attrs.get("n_dropped", 0)
        if chunk.empty:
            continue

        start_ts = pd.to_datetime(chunk["start_ts"])
        end_ts = pd.to_datetime(chunk["end_ts"])
        start_local_date = start_ts.dt.date
        end_local_date = end_ts.dt.date
        start_bucket = (start_ts.dt.hour * 60 + start_ts.dt.minute) // 15
        end_bucket = (end_ts.dt.hour * 60 + end_ts.dt.minute) // 15

        start_dow = start_ts.dt.dayofweek.to_numpy()
        start_is_hol = pd.Series(start_local_date).isin(hol).to_numpy()
        start_daytype = day_type_array(start_dow, start_is_hol)

        end_dow = end_ts.dt.dayofweek.to_numpy()
        end_is_hol = pd.Series(end_local_date).isin(hol).to_numpy()
        end_daytype = day_type_array(end_dow, end_is_hol)

        starts = pd.DataFrame({"sid": chunk["start_id"], "k": start_daytype, "j": start_bucket})
        for (sid, k, j), cnt in starts.value_counts().items():
            bucket_counts[(sid, int(k), int(j))][0] += int(cnt)

        ends = pd.DataFrame({"sid": chunk["end_id"], "k": end_daytype, "j": end_bucket})
        for (sid, k, j), cnt in ends.value_counts().items():
            bucket_counts[(sid, int(k), int(j))][1] += int(cnt)

        for sid, d in zip(chunk["start_id"], start_local_date, strict=True):
            _update_span(span, sid, d)
        for sid, d in zip(chunk["end_id"], end_local_date, strict=True):
            _update_span(span, sid, d)

        start_utc = (
            start_ts.dt.tz_localize(tz, ambiguous=np.ones(len(chunk), dtype=bool), nonexistent="shift_forward")
            .dt.tz_convert("UTC")
        )
        hour_floor = start_utc.dt.floor("h")
        for h, cnt in hour_floor.value_counts().items():
            hourly[h.to_pydatetime()] += int(cnt)

    return TripAgg(
        bucket_counts=dict(bucket_counts), span=span, hourly=dict(hourly), n_trips=n_trips, n_dropped=n_dropped
    )


def write_agg(
    conn: psycopg.Connection, city_id: int, agg: TripAgg, window: tuple[date, date], tz: ZoneInfo
) -> None:
    """Replace the city's trip aggregates and record a `bootstrap_runs` row.

    `tz` is required (beyond the literal docs/worker-spec.md §4.1 signature) to
    compute the "every UTC hour, zero-filled" range for `system_hourly_trips`
    (`local_midnight(month_from)` .. `local_midnight(month_to_end+1)`), which
    is inherently timezone-dependent; flagged in the WP-4 final report.
    """
    month_from, month_to = window
    month_to_end = _month_to_end(month_to)

    with conn.cursor() as cur:
        cur.execute("DELETE FROM trip_bucket_counts WHERE city_id=%s", (city_id,))
        cur.execute("DELETE FROM trip_station_span WHERE city_id=%s", (city_id,))
        cur.execute("DELETE FROM system_hourly_trips WHERE city_id=%s", (city_id,))

        bucket_rows = [
            (city_id, sid, k, j, counts_[0], counts_[1]) for (sid, k, j), counts_ in agg.bucket_counts.items()
        ]
        db.copy_rows(
            cur, "trip_bucket_counts", ["city_id", "station_id", "day_type", "bucket", "n_start", "n_end"], bucket_rows
        )

        span_rows = [(city_id, sid, span_[0], span_[1]) for sid, span_ in agg.span.items()]
        db.copy_rows(cur, "trip_station_span", ["city_id", "station_id", "first_seen", "last_seen"], span_rows)

        start = local_midnight(month_from, tz)
        end = local_midnight(month_to_end + timedelta(days=1), tz)
        all_hours = pd.date_range(start, end, freq="h", inclusive="left")
        hourly_rows = [(city_id, h.to_pydatetime(), agg.hourly.get(h.to_pydatetime(), 0)) for h in all_hours]
        db.copy_rows(cur, "system_hourly_trips", ["city_id", "hour", "n_start"], hourly_rows)

        cur.execute(
            "INSERT INTO bootstrap_runs (city_id, window_start, window_end, n_trips, n_dropped) "
            "VALUES (%s,%s,%s,%s,%s)",
            (city_id, month_from, month_to, agg.n_trips, agg.n_dropped),
        )
    conn.commit()


def run(
    cfg: Config,
    conn: psycopg.Connection,
    city: dict,
    month_from: date,
    month_to: date,
    cache_dir: Path,
    skip_download: bool = False,
    csv_sources: Iterable[CsvSource] | None = None,
) -> dict:
    """`csv_sources`: injectable CSV paths/file-like objects bypassing CKAN/zip download
    entirely (used by tests to feed `fixtures/trips/*.csv` without network)."""
    tz = ZoneInfo(city["tz"])

    if csv_sources is not None:
        chunks: Iterator[pd.DataFrame] = iter_trip_chunks(csv_sources, month_from, month_to, tz)
    else:
        # Local import: trip_sources adapters import this module's parsers.
        from dockcast_ml.bootstrap import trip_sources

        source_cfg = dict(city.get("trip_source") or {})
        adapter_name = source_cfg.pop("adapter", None)
        if not adapter_name:
            raise ValueError(
                f"city {city.get('slug')!r} has no trip_source.adapter configured; "
                "see docs/add-a-city.md"
            )
        adapter = trip_sources.get_adapter(adapter_name)
        chunks = adapter(city, source_cfg, month_from, month_to, cache_dir, skip_download)

    hol_years = range(month_from.year, month_to.year + 1)
    hol = holiday_set(city["holiday_country"], city["holiday_subdiv"], hol_years)

    agg = aggregate(chunks, tz, hol)
    write_agg(conn, city["id"], agg, (month_from, month_to), tz)
    return {"n_trips": agg.n_trips, "n_dropped": agg.n_dropped, "n_stations": len(agg.span)}
