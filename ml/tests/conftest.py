"""Shared pytest fixtures for dockcast_ml tests (docs/worker-spec.md §9)."""

from __future__ import annotations

import os
import random
import time
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import psycopg
import pytest

# db/migrations lives at the repo root: ml/tests/conftest.py -> ml/tests -> ml -> <repo root>
MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "db" / "migrations"


@pytest.fixture(autouse=True)
def _deterministic_seed() -> None:
    """Deterministic seeds for every test (docs/worker-spec.md §9).

    Seeds the legacy global numpy RandomState deliberately (not a
    `np.random.Generator`): scipy/sklearn/statsmodels code under test relies
    on the global state for reproducibility, not an injected Generator.
    """
    random.seed(0)
    np.random.seed(0)  # noqa: NPY002


@pytest.fixture
def db_conn() -> Iterator[psycopg.Connection]:
    """A psycopg connection to a freshly migrated DATABASE_URL_TEST database.

    Skips the test when DATABASE_URL_TEST is unset. Resets the public schema
    and re-applies every db/migrations/*.sql file in order, matching the
    fixture used by test_db_predict_once.py / test_db_train_synthetic.py.
    """
    database_url = os.environ.get("DATABASE_URL_TEST")
    if not database_url:
        pytest.skip("DATABASE_URL_TEST not set")

    conn = _connect_with_fresh_schema(database_url)
    try:
        with conn.cursor() as cur:
            for migration_file in sorted(MIGRATIONS_DIR.glob("*.sql")):
                cur.execute(migration_file.read_text())
        yield conn
    finally:
        conn.close()


def _connect_with_fresh_schema(database_url: str, attempts: int = 5) -> psycopg.Connection:
    """Connect and reset the public schema, retrying when Postgres aborts the DROP as a deadlock.

    `DROP SCHEMA public CASCADE` takes exclusive locks on every hypertable while TimescaleDB
    background workers (the policy jobs the migrations create, plus the built-in telemetry and
    job-history jobs) hold catalog locks and want share locks on those same tables. Postgres
    resolves the cycle by aborting one side, and in CI it sometimes picks us. The worker finishes
    within moments, so a short wait and a fresh connection is all the retry needs.
    """
    for attempt in range(1, attempts + 1):
        conn = psycopg.connect(database_url, autocommit=True)
        try:
            with conn.cursor() as cur:
                cur.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
            return conn
        except psycopg.errors.DeadlockDetected:
            conn.close()
            if attempt == attempts:
                raise
            time.sleep(0.5 * attempt)
    raise AssertionError("unreachable")


@pytest.fixture
def synthetic_city(db_conn: psycopg.Connection) -> int:
    """Inserts one deterministic synthetic city row and returns its id."""
    with db_conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO cities (
                slug, name, gbfs_url, tz, lat, lon, country_code,
                holiday_country, holiday_subdiv, is_active, forecasting_enabled
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                "testville",
                "Test City",
                "https://example.invalid/gbfs.json",
                "America/Toronto",
                43.6532,
                -79.3832,
                "CA",
                "CA",
                "ON",
                True,
                True,
            ),
        )
        row = cur.fetchone()
    assert row is not None
    return row[0]
