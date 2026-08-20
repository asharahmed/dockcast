"""`python -m dockcast_ml add-city` — register a city from its GBFS feed.

Fetches the auto-discovery `gbfs.json`, reads `system_information` (name,
timezone) and `station_information` (centroid = mean station lat/lon), and
inserts the `cities` row with `forecasting_enabled=false` (the map serves
live-only until a bootstrap succeeds — docs/add-a-city.md). Also refreshes
the holiday calendar for the city's region so API day-typing works
immediately.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import psycopg

from dockcast_ml import holiday_calendar


def _feeds(discovery: dict[str, Any]) -> list[dict[str, Any]]:
    """Feed list across GBFS versions: v3 `data.feeds`, v1/v2 `data.<lang>.feeds` (prefer en*)."""
    data = discovery.get("data") or {}
    if isinstance(data.get("feeds"), list):
        return data["feeds"]  # type: ignore[no-any-return]
    languages = [k for k in data if isinstance(data.get(k), dict) and "feeds" in data[k]]
    if not languages:
        raise ValueError("gbfs.json has no feeds")
    lang = next((k for k in languages if k.lower().startswith("en")), languages[0])
    return data[lang]["feeds"]  # type: ignore[no-any-return]


def _feed_url(feeds: list[dict[str, Any]], name: str) -> str:
    match = next((f for f in feeds if f.get("name") == name), None)
    if match is None:
        raise ValueError(f"gbfs.json lists no {name!r} feed")
    return str(match["url"])


def discover(gbfs_url: str, client: httpx.Client) -> dict[str, Any]:
    """Name, timezone, and station centroid straight from the city's own feed."""
    feeds = _feeds(client.get(gbfs_url, timeout=30).raise_for_status().json())

    sysinfo = client.get(_feed_url(feeds, "system_information"), timeout=30).raise_for_status().json()
    info = sysinfo.get("data") or {}

    stations_doc = client.get(_feed_url(feeds, "station_information"), timeout=30).raise_for_status().json()
    stations = (stations_doc.get("data") or {}).get("stations") or []
    coords = [
        (float(s["lat"]), float(s["lon"]))
        for s in stations
        if s.get("lat") is not None and s.get("lon") is not None
    ]
    if not coords:
        raise ValueError("station_information has no stations with coordinates")

    return {
        "name": str(info.get("name") or ""),
        "tz": str(info.get("timezone") or ""),
        "lat": sum(lat for lat, _ in coords) / len(coords),
        "lon": sum(lon for _, lon in coords) / len(coords),
        "n_stations": len(coords),
    }


def run(
    conn: psycopg.Connection,
    args: dict[str, Any],
    client: httpx.Client | None = None,
) -> dict[str, Any]:
    """Insert the city row (error if the slug exists) and refresh its holiday region."""
    own_client = client is None
    client = client or httpx.Client(follow_redirects=True)
    try:
        found = discover(args["gbfs_url"], client)
    finally:
        if own_client:
            client.close()

    name = args.get("name") or found["name"]
    tz = args.get("tz") or found["tz"]
    if not name or not tz:
        raise ValueError("feed did not provide name/timezone; pass --name/--tz explicitly")

    trip_source: dict[str, Any] = json.loads(args.get("trip_config") or "{}")
    if args.get("trip_adapter"):
        trip_source["adapter"] = args["trip_adapter"]

    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM cities WHERE slug=%s", (args["slug"],))
        if cur.fetchone():
            raise ValueError(f"city slug already exists: {args['slug']}")
        cur.execute(
            """INSERT INTO cities
                 (slug, name, gbfs_url, tz, lat, lon, country_code, holiday_country,
                  holiday_subdiv, is_active, forecasting_enabled, trip_source)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,true,false,%s::jsonb)
               RETURNING id""",
            (
                args["slug"],
                name,
                args["gbfs_url"],
                tz,
                found["lat"],
                found["lon"],
                args["country_code"],
                args["holiday_country"],
                args.get("holiday_subdiv"),
                json.dumps(trip_source),
            ),
        )
        row = cur.fetchone()
        assert row is not None
        city_id = int(row[0])
    conn.commit()

    n_holidays = holiday_calendar.refresh(
        conn,
        [{"holiday_country": args["holiday_country"], "holiday_subdiv": args.get("holiday_subdiv")}],
    )

    return {
        "city_id": city_id,
        "slug": args["slug"],
        "name": name,
        "tz": tz,
        "lat": round(found["lat"], 5),
        "lon": round(found["lon"], 5),
        "n_stations_in_feed": found["n_stations"],
        "trip_source": trip_source,
        "holiday_rows": n_holidays,
        "next_steps": (
            "collector picks the city up automatically; run bootstrap once trips config is set "
            "(bootstrap enables forecasting on success)"
        ),
    }
