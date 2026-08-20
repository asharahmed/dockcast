"""Bike Share Toronto ridership via the city's CKAN open-data portal.

Discovers `bikeshare-ridership-<year>.zip` resources on the CKAN package,
downloads them to the cache dir, and streams the CSV members through the
Toronto/PBSC-schema parser in `bootstrap.trips` (Start_Station_Id/Start_Time/
End_Station_Id/End_Time, local naive timestamps, numeric station ids matching
GBFS station_id).

`trip_source` config: `{"adapter": "toronto_ckan"}` — optionally
`{"package_url": "..."}` to point at a different CKAN package with the same
resource-naming and CSV schema.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pandas as pd

from dockcast_ml.bootstrap.trip_sources import download

DEFAULT_PACKAGE_URL = (
    "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show"
    "?id=bike-share-toronto-ridership-data"
)


def resource_urls(package_url: str, years: list[int]) -> dict[int, str]:
    """CKAN resources whose name == f"bikeshare-ridership-{y}.zip", keyed by year."""
    resp = httpx.get(package_url, timeout=30)
    resp.raise_for_status()
    payload = resp.json()
    resources = payload["result"]["resources"]
    urls: dict[int, str] = {}
    for year in years:
        name = f"bikeshare-ridership-{year}.zip"
        match = next((r for r in resources if r.get("name") == name), None)
        if match is None:
            raise ValueError(f"CKAN resource not found: {name}")
        urls[year] = match["url"]
    return urls


def fetch_chunks(
    city: dict[str, Any],
    source_cfg: dict[str, Any],
    month_from: date,
    month_to: date,
    cache_dir: Path,
    skip_download: bool,
) -> Iterator[pd.DataFrame]:
    from dockcast_ml.bootstrap import trips

    tz = ZoneInfo(city["tz"])
    package_url = source_cfg.get("package_url", DEFAULT_PACKAGE_URL)
    years = sorted({month_from.year, month_to.year})

    zip_paths: list[Path] = []
    if skip_download:
        for year in years:
            dest = cache_dir / f"bikeshare-ridership-{year}.zip"
            if not dest.exists():
                raise FileNotFoundError(f"--skip-download but missing cache file: {dest}")
            zip_paths.append(dest)
    else:
        urls = resource_urls(package_url, years)
        for year in years:
            zip_paths.append(download(urls[year], cache_dir / f"bikeshare-ridership-{year}.zip"))

    for zip_path in zip_paths:
        yield from trips.iter_trip_chunks_from_zip(zip_path, month_from, month_to, tz)
