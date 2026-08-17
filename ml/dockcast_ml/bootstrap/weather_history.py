"""Open-Meteo archive fetch for weather-multiplier fitting (docs/ml-spec.md §1.4,
docs/worker-spec.md §4.2).
"""

from __future__ import annotations

import calendar
import time
from datetime import date, timedelta
from zoneinfo import ZoneInfo

import httpx
import pandas as pd
import psycopg

from dockcast_ml import db
from dockcast_ml.config import Config
from dockcast_ml.timeutil import local_midnight

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
PAGE_DAYS = 92
_RETRY_BACKOFFS: tuple[float, ...] = (0, 2, 4, 8)


def parse_archive_response(payload: dict) -> pd.DataFrame:
    """Parse an Open-Meteo archive JSON payload's `hourly` block into a DataFrame
    (columns hour[UTC tz-aware], temp_c, precip_mm, wind_kmh)."""
    hourly = payload["hourly"]
    hours = pd.to_datetime(hourly["time"]).tz_localize("UTC")
    return pd.DataFrame(
        {
            "hour": hours,
            "temp_c": hourly["temperature_2m"],
            "precip_mm": hourly["precipitation"],
            "wind_kmh": hourly["wind_speed_10m"],
        }
    )


def _fetch_page(client: httpx.Client, lat: float, lon: float, start: date, end: date) -> pd.DataFrame:
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "hourly": "temperature_2m,precipitation,wind_speed_10m",
        "timezone": "UTC",
    }
    last_exc: Exception | None = None
    for backoff in _RETRY_BACKOFFS:
        if backoff:
            time.sleep(backoff)
        try:
            resp = client.get(ARCHIVE_URL, params=params, timeout=60)
            resp.raise_for_status()
            return parse_archive_response(resp.json())
        except (httpx.HTTPError, httpx.TimeoutException) as exc:
            last_exc = exc
    assert last_exc is not None
    raise last_exc


def fetch(lat: float, lon: float, start: date, end: date, client: httpx.Client | None = None) -> pd.DataFrame:
    """Fetch `[start, end]` (inclusive, UTC dates) in pages of <= 92 days.

    `client` is injectable (e.g. `httpx.Client(transport=httpx.MockTransport(...))`)
    so tests can serve `fixtures/weather/openmeteo_archive_sample.json` without network.
    """
    owns_client = client is None
    active_client = client if client is not None else httpx.Client()
    try:
        frames: list[pd.DataFrame] = []
        cur = start
        while cur <= end:
            page_end = min(cur + timedelta(days=PAGE_DAYS - 1), end)
            frames.append(_fetch_page(active_client, lat, lon, cur, page_end))
            cur = page_end + timedelta(days=1)
        if not frames:
            return pd.DataFrame(columns=["hour", "temp_c", "precip_mm", "wind_kmh"])
        return pd.concat(frames, ignore_index=True)
    finally:
        if owns_client:
            active_client.close()


def run(
    cfg: Config,
    conn: psycopg.Connection,
    city: dict,
    month_from: date,
    month_to: date,
    client: httpx.Client | None = None,
) -> dict:
    tz = ZoneInfo(city["tz"])
    last_day = calendar.monthrange(month_to.year, month_to.month)[1]
    month_to_end = date(month_to.year, month_to.month, last_day)

    start_dt = local_midnight(month_from, tz) - timedelta(days=1)
    end_dt = local_midnight(month_to_end + timedelta(days=1), tz) + timedelta(days=1)

    df = fetch(city["lat"], city["lon"], start_dt.date(), end_dt.date(), client=client)

    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM weather_history WHERE city_id=%s AND hour BETWEEN %s AND %s",
            (city["id"], start_dt, end_dt),
        )
        rows = [
            (
                city["id"],
                r.hour.to_pydatetime(),
                None if pd.isna(r.temp_c) else float(r.temp_c),
                None if pd.isna(r.precip_mm) else float(r.precip_mm),
                None if pd.isna(r.wind_kmh) else float(r.wind_kmh),
            )
            for r in df.itertuples(index=False)
        ]
        db.copy_rows(cur, "weather_history", ["city_id", "hour", "temp_c", "precip_mm", "wind_kmh"], rows)
    conn.commit()
    return {"n_rows": len(rows)}
