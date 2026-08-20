"""add-city: GBFS discovery + city insert + holiday-calendar refresh."""

from __future__ import annotations

import json
from typing import Any

import httpx
import psycopg
import pytest

from dockcast_ml import add_city, holiday_calendar


def _mock_client(gbfs: dict[str, Any]) -> httpx.Client:
    sysinfo = {"data": {"name": "Mock Bikes", "timezone": "America/Montreal"}}
    stations = {
        "data": {
            "stations": [
                {"station_id": "A", "lat": 45.50, "lon": -73.55},
                {"station_id": "B", "lat": 45.52, "lon": -73.57},
            ]
        }
    }
    routes = {
        "https://x.test/gbfs.json": gbfs,
        "https://x.test/system_information.json": sysinfo,
        "https://x.test/station_information.json": stations,
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=routes[str(request.url)])

    return httpx.Client(transport=httpx.MockTransport(handler))


V3_GBFS = {
    "data": {
        "feeds": [
            {"name": "system_information", "url": "https://x.test/system_information.json"},
            {"name": "station_information", "url": "https://x.test/station_information.json"},
        ]
    }
}

V2_GBFS = {"data": {"en": V3_GBFS["data"], "fr": {"feeds": []}}}


@pytest.mark.parametrize("gbfs", [V3_GBFS, V2_GBFS], ids=["v3", "v2-en"])
def test_discover_reads_feed(gbfs: dict[str, Any]) -> None:
    with _mock_client(gbfs) as client:
        found = add_city.discover("https://x.test/gbfs.json", client)
    assert found["name"] == "Mock Bikes"
    assert found["tz"] == "America/Montreal"
    assert found["n_stations"] == 2
    assert abs(found["lat"] - 45.51) < 1e-9


def test_add_city_inserts_and_refreshes_holidays(db_conn: psycopg.Connection) -> None:
    with _mock_client(V3_GBFS) as client:
        summary = add_city.run(
            db_conn,
            {
                "slug": "montreal",
                "gbfs_url": "https://x.test/gbfs.json",
                "country_code": "CA",
                "holiday_country": "CA",
                "holiday_subdiv": "QC",
                "trip_adapter": "generic_csv",
                "trip_config": json.dumps({"files": ["*.csv"]}),
            },
            client=client,
        )

    assert summary["slug"] == "montreal"
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT name, tz, forecasting_enabled, is_active, trip_source FROM cities WHERE slug='montreal'"
        )
        row = cur.fetchone()
    assert row is not None
    name, tz, forecasting_enabled, is_active, trip_source = row
    assert (name, tz) == ("Mock Bikes", "America/Montreal")
    assert forecasting_enabled is False and is_active is True
    assert trip_source == {"adapter": "generic_csv", "files": ["*.csv"]}

    # Quebec's Fête nationale (June 24) is in CA/QC but not CA/ON.
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM holiday_calendar WHERE holiday_country='CA' AND holiday_subdiv='QC'"
        )
        n_row = cur.fetchone()
    assert n_row is not None and n_row[0] > 0

    # duplicate slug -> clean error
    with _mock_client(V3_GBFS) as client:
        with pytest.raises(ValueError, match="already exists"):
            add_city.run(
                db_conn,
                {
                    "slug": "montreal",
                    "gbfs_url": "https://x.test/gbfs.json",
                    "country_code": "CA",
                    "holiday_country": "CA",
                    "holiday_subdiv": "QC",
                },
                client=client,
            )


def test_holiday_refresh_writes_regions(db_conn: psycopg.Connection) -> None:
    n = holiday_calendar.refresh(
        db_conn,
        [{"holiday_country": "CA", "holiday_subdiv": "ON"}],
        years=[2026, 2027],
    )
    assert n > 0
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM holiday_calendar WHERE holiday_country='CA' AND holiday_subdiv='ON' "
            "AND day BETWEEN '2026-01-01' AND '2027-12-31'"
        )
        row = cur.fetchone()
    assert row is not None and row[0] == n
    # idempotent
    assert holiday_calendar.refresh(
        db_conn, [{"holiday_country": "CA", "holiday_subdiv": "ON"}], years=[2026, 2027]
    ) == n
