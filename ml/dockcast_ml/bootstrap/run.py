"""Bootstrap orchestration (docs/worker-spec.md §4.6): trips -> weather_history -> rates ->
weather_glm -> neighbors, all under one `worker_run(kind='bootstrap')`.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import psycopg

from dockcast_ml import db, gbfs_ids, holiday_calendar, neighbors, rates, weather_glm
from dockcast_ml.bootstrap import trips, weather_history
from dockcast_ml.config import Config
from dockcast_ml.timeutil import holiday_set


def run_bootstrap(
    cfg: Config,
    conn: psycopg.Connection,
    city: dict[str, Any],
    month_from: date,
    month_to: date,
    cache_dir: Path,
    skip_download: bool = False,
    trips_csv_sources: Any = None,
    weather_http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    """Run the full bootstrap pipeline for one city.

    `trips_csv_sources`/`weather_http_client` are test seams threaded through
    to `bootstrap.trips.run`/`bootstrap.weather_history.run` (see their
    docstrings); left `None` for the real, network-dependent production path.
    """
    with db.worker_run(cfg, "bootstrap", city["id"]) as summary:
        stations = gbfs_ids.load_stations(conn, city["id"], active_only=False)
        if stations.empty:
            raise RuntimeError("run the collector first: no stations for city")

        summary["holiday_rows"] = holiday_calendar.refresh(conn, [city])

        hol_years = range(month_from.year, month_to.year + 1)
        hol = holiday_set(city["holiday_country"], city["holiday_subdiv"], hol_years)

        trips_result = trips.run(
            cfg,
            conn,
            city,
            month_from,
            month_to,
            cache_dir,
            skip_download=skip_download,
            csv_sources=trips_csv_sources,
        )
        summary["n_trips"] = trips_result["n_trips"]
        summary["n_dropped"] = trips_result["n_dropped"]

        weather_history_result = weather_history.run(
            cfg, conn, city, month_from, month_to, client=weather_http_client
        )
        summary["weather_history_rows"] = weather_history_result["n_rows"]

        counts = db.fetch_df(conn, "SELECT * FROM trip_bucket_counts WHERE city_id=%(c)s", {"c": city["id"]})
        span = db.fetch_df(conn, "SELECT * FROM trip_station_span WHERE city_id=%(c)s", {"c": city["id"]})
        active_stations = gbfs_ids.load_stations(conn, city["id"], active_only=True)
        rates_df = rates.compute_rates(counts, span, active_stations, hol)
        rates.write_rates(conn, city["id"], rates_df, datetime.now(UTC))
        summary["n_stations_rates"] = int(rates_df.attrs.get("n_trips_stations", 0))
        summary["n_fallback"] = int(rates_df.attrs.get("n_fallback_stations", 0))

        hourly = db.fetch_df(conn, "SELECT * FROM system_hourly_trips WHERE city_id=%(c)s", {"c": city["id"]})
        weather = db.fetch_df(conn, "SELECT * FROM weather_history WHERE city_id=%(c)s", {"c": city["id"]})
        tz = ZoneInfo(city["tz"])
        mult_df, diagnostics = weather_glm.fit_multipliers(hourly, weather, tz, hol)
        weather_glm.write_multipliers(conn, city["id"], mult_df, datetime.now(UTC))
        summary["glm"] = diagnostics

        neighbors_result = neighbors.rebuild(conn, city["id"])
        summary["neighbors"] = neighbors_result

        # Rates + GLM + profile inputs all exist now: the predictor can serve
        # this city, so flip it on (docs/add-a-city.md step 4).
        with conn.cursor() as cur:
            cur.execute("UPDATE cities SET forecasting_enabled=true WHERE id=%s", (city["id"],))
        conn.commit()
        summary["forecasting_enabled"] = True

        return summary
