"""Trip-source adapter registry + generic_csv adapter (docs/add-a-city.md)."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pandas as pd
import pytest

from dockcast_ml.bootstrap import trip_sources, trips
from dockcast_ml.bootstrap.trip_sources import generic_csv

CITY = {"id": 1, "slug": "testville", "tz": "America/Toronto"}
WINDOW = (date(2026, 1, 1), date(2026, 1, 31))


def test_unknown_adapter_raises() -> None:
    with pytest.raises(ValueError, match="unknown trip-source adapter"):
        trip_sources.get_adapter("nope")


def test_known_adapters_resolve() -> None:
    assert trip_sources.get_adapter("toronto_ckan") is not None
    assert trip_sources.get_adapter("generic_csv") is not None


def test_trips_run_requires_adapter(tmp_path: Path) -> None:
    city = {**CITY, "trip_source": {}}
    with pytest.raises(ValueError, match="no trip_source.adapter"):
        trips.run(None, None, city, *WINDOW, tmp_path)  # type: ignore[arg-type]


def _write_csv(tmp_path: Path, name: str, body: str) -> None:
    (tmp_path / name).write_text(body, encoding="utf-8")


BASE_CFG = {
    "files": ["trips-*.csv"],
    "columns": {
        "start_id": "start_station_id",
        "end_id": "end_station_id",
        "start_time": "started_at",
        "end_time": "ended_at",
    },
}


def _collect(cfg: dict, tmp_path: Path) -> pd.DataFrame:
    chunks = list(generic_csv.fetch_chunks(CITY, cfg, *WINDOW, tmp_path, skip_download=True))
    return pd.concat(chunks, ignore_index=True) if chunks else pd.DataFrame()


def test_generic_csv_parses_and_applies_drop_rules(tmp_path: Path) -> None:
    _write_csv(
        tmp_path,
        "trips-jan.csv",
        "ride_id,start_station_id,started_at,end_station_id,ended_at\n"
        # kept
        "a,S1,2026-01-05 08:00:00,S2,2026-01-05 08:20:00\n"
        # dropped: end before start
        "b,S1,2026-01-05 09:00:00,S2,2026-01-05 08:59:00\n"
        # dropped: > 24 h
        "c,S1,2026-01-05 09:00:00,S2,2026-01-07 09:00:01\n"
        # dropped: start outside window
        "d,S1,2025-12-31 09:00:00,S2,2025-12-31 09:10:00\n"
        # dropped: unparseable id
        "e,,2026-01-05 09:00:00,S2,2026-01-05 09:10:00\n",
    )
    out = _collect(dict(BASE_CFG), tmp_path)
    assert len(out) == 1
    assert out.loc[0, "start_id"] == "S1"
    assert out.loc[0, "end_id"] == "S2"


def test_generic_csv_utc_conversion(tmp_path: Path) -> None:
    # 2026-01-05T13:00Z = 08:00 in Toronto (EST): local bucketing must see 08:00.
    _write_csv(
        tmp_path,
        "trips-utc.csv",
        "start_station_id,started_at,end_station_id,ended_at\n"
        "S1,2026-01-05 13:00:00,S2,2026-01-05 13:30:00\n",
    )
    cfg = {**BASE_CFG, "files": ["trips-utc.csv"], "timestamps": "utc"}
    out = _collect(cfg, tmp_path)
    ts = pd.Timestamp(out.loc[0, "start_ts"])
    assert (ts.hour, ts.minute) == (8, 0)
    assert ts.tzinfo is None


def test_generic_csv_numeric_id_normalization(tmp_path: Path) -> None:
    _write_csv(
        tmp_path,
        "trips-num.csv",
        "start_station_id,started_at,end_station_id,ended_at\n"
        "7021.0,2026-01-05 08:00:00,7022,2026-01-05 08:20:00\n",
    )
    cfg = {**BASE_CFG, "files": ["trips-num.csv"], "id_normalization": "numeric"}
    out = _collect(cfg, tmp_path)
    assert out.loc[0, "start_id"] == "7021"
    assert out.loc[0, "end_id"] == "7022"


def test_generic_csv_config_validation(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="columns"):
        _collect({"files": ["x.csv"]}, tmp_path)
    with pytest.raises(ValueError, match="urls.*files|files.*urls|at least one"):
        _collect({"columns": BASE_CFG["columns"]}, tmp_path)
    with pytest.raises(FileNotFoundError):
        _collect(dict(BASE_CFG), tmp_path)  # glob matches nothing


def test_generic_csv_missing_column_raises(tmp_path: Path) -> None:
    _write_csv(tmp_path, "trips-bad.csv", "start_station_id,started_at\nS1,2026-01-05 08:00:00\n")
    with pytest.raises(ValueError, match="missing columns"):
        _collect(dict(BASE_CFG, files=["trips-bad.csv"]), tmp_path)
