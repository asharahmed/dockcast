"""Materialize python-holidays dates into the `holiday_calendar` table.

The API day-types against this table (apps/api/src/forecast/holidays.ts), so
the worker — the side that owns the `holidays` library — is responsible for
keeping it populated for every (holiday_country, holiday_subdiv) region any
city declares. Refreshed during bootstrap, nightly train, and `add-city`.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

import psycopg

from dockcast_ml.timeutil import holiday_set


def default_years(now: datetime | None = None) -> list[int]:
    """Previous year through two years out — covers labels of old forecasts and long-range typicals."""
    year = (now or datetime.now(UTC)).year
    return [year - 1, year, year + 1, year + 2]


def refresh(conn: psycopg.Connection, cities: list[dict[str, Any]], years: list[int] | None = None) -> int:
    """Rewrite the calendar rows for every region used by `cities` over `years`.

    Delete-then-insert per region (bounded to the year span) so removed
    observances don't linger. Returns the number of rows written.
    """
    years = years or default_years()
    regions = sorted({(str(c["holiday_country"]), str(c["holiday_subdiv"] or "")) for c in cities})
    span = (date(min(years), 1, 1), date(max(years), 12, 31))

    rows: list[tuple[str, str, date]] = []
    for country, subdiv in regions:
        for day in sorted(holiday_set(country, subdiv or None, years)):
            if span[0] <= day <= span[1]:
                rows.append((country, subdiv, day))

    with conn.cursor() as cur:
        for country, subdiv in regions:
            cur.execute(
                "DELETE FROM holiday_calendar WHERE holiday_country=%s AND holiday_subdiv=%s AND day BETWEEN %s AND %s",
                (country, subdiv, span[0], span[1]),
            )
        cur.executemany(
            "INSERT INTO holiday_calendar (holiday_country, holiday_subdiv, day) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
            rows,
        )
    conn.commit()
    return len(rows)
