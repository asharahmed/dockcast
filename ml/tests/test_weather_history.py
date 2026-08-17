"""docs/worker-spec.md §4.2: Open-Meteo archive parsing/paging against the real fixture."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from pathlib import Path

import httpx
import pytest

from dockcast_ml.bootstrap.weather_history import fetch, parse_archive_response

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE = REPO_ROOT / "fixtures" / "weather" / "openmeteo_archive_sample.json"


def test_parse_archive_response() -> None:
    payload = json.loads(FIXTURE.read_text())
    df = parse_archive_response(payload)

    assert len(df) == 48
    assert df["hour"].dt.tz is not None
    assert str(df["hour"].dt.tz) == "UTC"
    assert df["hour"].iloc[0] == datetime(2025, 4, 1, 0, 0, tzinfo=UTC)
    assert df["hour"].iloc[-1] == datetime(2025, 4, 2, 23, 0, tzinfo=UTC)

    hourly = payload["hourly"]
    assert df["temp_c"].tolist() == hourly["temperature_2m"]
    assert df["precip_mm"].tolist() == hourly["precipitation"]
    assert df["wind_kmh"].tolist() == hourly["wind_speed_10m"]


def _mock_transport(payload: dict) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    return httpx.MockTransport(handler)


def test_fetch_single_page_uses_injected_client() -> None:
    payload = json.loads(FIXTURE.read_text())
    client = httpx.Client(transport=_mock_transport(payload))
    df = fetch(43.690685, -79.41174, date(2025, 4, 1), date(2025, 4, 2), client=client)
    assert len(df) == 48


def test_fetch_pages_requests_over_92_days() -> None:
    payload = json.loads(FIXTURE.read_text())
    requested_ranges: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        params = dict(httpx.QueryParams(request.url.query))
        requested_ranges.append((params["start_date"], params["end_date"]))
        return httpx.Response(200, json=payload)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    start = date(2025, 4, 1)
    end = date(2025, 8, 1)  # 122 days -> should page into >= 2 requests of <= 92 days each
    df = fetch(43.690685, -79.41174, start, end, client=client)

    assert len(requested_ranges) >= 2
    for start_str, end_str in requested_ranges:
        span_days = (date.fromisoformat(end_str) - date.fromisoformat(start_str)).days + 1
        assert span_days <= 92
    assert len(df) == 48 * len(requested_ranges)


def test_fetch_retries_on_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("dockcast_ml.bootstrap.weather_history.time.sleep", lambda _seconds: None)
    payload = json.loads(FIXTURE.read_text())
    attempts = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] < 2:
            return httpx.Response(500)
        return httpx.Response(200, json=payload)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    df = fetch(43.690685, -79.41174, date(2025, 4, 1), date(2025, 4, 2), client=client)
    assert attempts["n"] == 2
    assert len(df) == 48


def test_fetch_raises_after_exhausting_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("dockcast_ml.bootstrap.weather_history.time.sleep", lambda _seconds: None)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    with pytest.raises(httpx.HTTPError):
        fetch(43.690685, -79.41174, date(2025, 4, 1), date(2025, 4, 2), client=client)
