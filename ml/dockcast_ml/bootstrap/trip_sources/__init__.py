"""Trip-history source adapters (docs/add-a-city.md).

An adapter turns a city's published ridership data into the normalized chunk
stream `bootstrap.trips.aggregate` consumes: pandas frames with columns

    start_id, end_id   -- str, matching GBFS `stations.station_id`
    start_ts, end_ts   -- naive datetimes in the CITY'S LOCAL TIME

plus `attrs["n_in"]` / `attrs["n_dropped"]` for the drop accounting, having
already applied the docs/ml-spec.md §1.5 drop rules (unparseable rows,
end < start, duration > 24 h, start outside the bootstrap window).

Which adapter a city uses comes from `cities.trip_source` (jsonb), e.g.
`{"adapter": "toronto_ckan"}` — the remaining keys are adapter-specific
config passed through verbatim.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Any, Protocol

import httpx
import pandas as pd


class TripSourceAdapter(Protocol):
    def __call__(
        self,
        city: dict[str, Any],
        source_cfg: dict[str, Any],
        month_from: date,
        month_to: date,
        cache_dir: Path,
        skip_download: bool,
    ) -> Iterator[pd.DataFrame]: ...


def download(url: str, dest: Path) -> Path:
    """Stream `url` to `dest` (skip if it already exists and is non-empty)."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    with httpx.stream("GET", url, timeout=60, follow_redirects=True) as resp:
        resp.raise_for_status()
        with part.open("wb") as fh:
            for chunk in resp.iter_bytes():
                fh.write(chunk)
    part.rename(dest)
    return dest


def get_adapter(name: str) -> TripSourceAdapter:
    # Imports are local so the registry, trips.py, and the adapters (which
    # import trips.py helpers) don't form an import cycle.
    from dockcast_ml.bootstrap.trip_sources import generic_csv, toronto_ckan

    adapters: dict[str, TripSourceAdapter] = {
        "toronto_ckan": toronto_ckan.fetch_chunks,
        "generic_csv": generic_csv.fetch_chunks,
    }
    if name not in adapters:
        raise ValueError(f"unknown trip-source adapter {name!r}; known: {sorted(adapters)}")
    return adapters[name]
