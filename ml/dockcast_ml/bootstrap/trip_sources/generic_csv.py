"""Config-driven trip-history adapter: any city whose ridership dumps are CSVs
(bare or zipped) can be bootstrapped without writing code.

`trip_source` config:

    {
      "adapter": "generic_csv",
      "urls": ["https://.../2025-tripdata.zip", ...],   // downloaded to the cache dir
      "files": ["2025-q*.csv"],                         // and/or globs relative to the cache dir
      "columns": {                                      // raw CSV header names
        "start_id": "start_station_id",
        "end_id": "end_station_id",
        "start_time": "started_at",
        "end_time": "ended_at"
      },
      "timestamp_format": "%Y-%m-%d %H:%M:%S",          // optional; omit for mixed/ISO parsing
      "timestamps": "local",                            // "local" (default) or "utc"
      "id_normalization": "string"                      // "string" (default) or "numeric"
    }

Station ids must match GBFS `stations.station_id` after normalization
("numeric" strips float artefacts like "7021.0" -> "7021", as Toronto's dumps
need). Timestamps declared "utc" are converted to the city's local clock —
day-typing and 15-min buckets are local by definition (docs/ml-spec.md §0).

The drop rules mirror docs/ml-spec.md §1.5 exactly (same as the Toronto
parser): unparseable ids/timestamps, end < start, duration > 24 h, start date
outside the bootstrap window.
"""

from __future__ import annotations

import calendar
import io
import zipfile
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from dockcast_ml.bootstrap.trip_sources import download

CHUNK_SIZE = 200_000

REQUIRED_COLUMN_KEYS = ("start_id", "end_id", "start_time", "end_time")


def _month_to_end(month_to: date) -> date:
    last_day = calendar.monthrange(month_to.year, month_to.month)[1]
    return date(month_to.year, month_to.month, last_day)


def _normalize_ids(raw: pd.Series, mode: str) -> pd.Series:
    stripped = raw.astype(str).str.strip()
    if mode == "numeric":
        numeric = pd.to_numeric(stripped, errors="coerce")
        out = pd.Series(pd.NA, index=raw.index, dtype="object")
        ok = numeric.notna()
        out[ok] = numeric[ok].astype("int64").astype(str)
        return out
    return stripped.where(stripped != "", pd.NA).where(stripped.str.lower() != "nan", pd.NA)


def _clean_chunk(
    chunk: pd.DataFrame,
    cols: dict[str, str],
    month_from: date,
    month_to: date,
    tz: ZoneInfo,
    ts_format: str | None,
    ts_kind: str,
    id_mode: str,
) -> pd.DataFrame:
    n_in = len(chunk)

    start_id = _normalize_ids(chunk[cols["start_id"]], id_mode)
    end_id = _normalize_ids(chunk[cols["end_id"]], id_mode)

    parse_kwargs: dict[str, Any] = {"errors": "coerce"}
    if ts_format:
        parse_kwargs["format"] = ts_format
    else:
        parse_kwargs["format"] = "mixed"
    start_ts = pd.to_datetime(chunk[cols["start_time"]].astype(str).str.strip(), **parse_kwargs)
    end_ts = pd.to_datetime(chunk[cols["end_time"]].astype(str).str.strip(), **parse_kwargs)

    if ts_kind == "utc":
        # Interpret naive stamps as UTC, convert to the city's clock, drop tzinfo:
        # everything downstream buckets by local wall time.
        start_ts = start_ts.dt.tz_localize("UTC").dt.tz_convert(tz).dt.tz_localize(None)
        end_ts = end_ts.dt.tz_localize("UTC").dt.tz_convert(tz).dt.tz_localize(None)

    valid = start_id.notna() & end_id.notna() & start_ts.notna() & end_ts.notna()
    valid &= end_ts >= start_ts
    valid &= (end_ts - start_ts).dt.total_seconds() <= 24 * 3600

    month_to_end = _month_to_end(month_to)
    start_date = start_ts.dt.date
    valid &= (start_date >= month_from) & (start_date <= month_to_end)

    kept = pd.DataFrame(
        {
            "start_id": start_id[valid].astype(str).to_numpy(),
            "end_id": end_id[valid].astype(str).to_numpy(),
            "start_ts": start_ts[valid].to_numpy(),
            "end_ts": end_ts[valid].to_numpy(),
        }
    )
    kept.attrs["n_in"] = n_in
    kept.attrs["n_dropped"] = n_in - len(kept)
    return kept


def _iter_csv(
    handle: Any,
    cols: dict[str, str],
    month_from: date,
    month_to: date,
    tz: ZoneInfo,
    ts_format: str | None,
    ts_kind: str,
    id_mode: str,
) -> Iterator[pd.DataFrame]:
    wanted = set(cols.values())
    for raw_chunk in pd.read_csv(
        handle,
        usecols=lambda c: c in wanted,
        dtype=str,
        chunksize=CHUNK_SIZE,
        encoding="utf-8",
        encoding_errors="replace",
    ):
        missing = [c for c in sorted(wanted) if c not in raw_chunk.columns]
        if missing:
            raise ValueError(f"unexpected header: missing columns {missing}")
        yield _clean_chunk(raw_chunk, cols, month_from, month_to, tz, ts_format, ts_kind, id_mode)


def fetch_chunks(
    city: dict[str, Any],
    source_cfg: dict[str, Any],
    month_from: date,
    month_to: date,
    cache_dir: Path,
    skip_download: bool,
) -> Iterator[pd.DataFrame]:
    cols = source_cfg.get("columns")
    if not isinstance(cols, dict) or any(k not in cols for k in REQUIRED_COLUMN_KEYS):
        raise ValueError(
            f"generic_csv: trip_source.columns must map all of {REQUIRED_COLUMN_KEYS}"
        )
    tz = ZoneInfo(city["tz"])
    ts_format = source_cfg.get("timestamp_format")
    ts_kind = source_cfg.get("timestamps", "local")
    if ts_kind not in ("local", "utc"):
        raise ValueError(f"generic_csv: timestamps must be 'local' or 'utc', got {ts_kind!r}")
    id_mode = source_cfg.get("id_normalization", "string")
    if id_mode not in ("string", "numeric"):
        raise ValueError(f"generic_csv: id_normalization must be 'string' or 'numeric', got {id_mode!r}")

    paths: list[Path] = []
    for url in source_cfg.get("urls", []):
        dest = cache_dir / url.rstrip("/").rsplit("/", 1)[-1]
        if skip_download:
            if not dest.exists():
                raise FileNotFoundError(f"--skip-download but missing cache file: {dest}")
            paths.append(dest)
        else:
            paths.append(download(url, dest))
    for pattern in source_cfg.get("files", []):
        matches = sorted(cache_dir.glob(pattern))
        if not matches:
            raise FileNotFoundError(f"generic_csv: no files match {pattern!r} under {cache_dir}")
        paths.extend(matches)
    if not paths:
        raise ValueError("generic_csv: trip_source needs at least one of 'urls' or 'files'")

    args = (cols, month_from, month_to, tz, ts_format, ts_kind, id_mode)
    for path in paths:
        if path.suffix.lower() == ".zip":
            with zipfile.ZipFile(path) as zf:
                for name in [n for n in zf.namelist() if n.lower().endswith(".csv")]:
                    with zf.open(name) as fh:
                        text = io.TextIOWrapper(fh, encoding="utf-8", errors="replace")
                        yield from _iter_csv(text, *args)
        else:
            yield from _iter_csv(path, *args)
