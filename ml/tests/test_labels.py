"""Label materialisation DB test (docs/ml-spec.md §5.4, docs/worker-spec.md §6.3): a
gap/stale row produces no label; a fresh row produces the correct
`bikes0/docks0/y_bike/y_dock/y_cnt`.
"""

from __future__ import annotations

from datetime import date, timedelta

import psycopg
import pytest

from dockcast_ml import db as dbmod
from dockcast_ml.labels import materialise_labels
from dockcast_ml.timeutil import local_midnight, tz_of


@pytest.mark.db
def test_stale_row_gets_no_label_fresh_row_gets_correct_label(
    db_conn: psycopg.Connection, synthetic_city: int
) -> None:
    city = dbmod.fetch_df(db_conn, "SELECT * FROM cities WHERE id=%(c)s", {"c": synthetic_city}).iloc[0].to_dict()
    tz = tz_of(city["tz"])
    # A fixed, safely-mid-day origin so day-boundary edge cases don't matter.
    t0 = local_midnight(date(2026, 6, 15), tz) + timedelta(hours=10)

    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO stations (city_id, station_id, name, lat, lon, capacity, is_active) "
            "VALUES (%s,%s,%s,%s,%s,%s,true) RETURNING id",
            (synthetic_city, "s1", "Station 1", 43.65, -79.38, 10),
        )
        row = cur.fetchone()
        assert row is not None
        pk = row[0]

        # Continuous poll_log coverage (60s) so poll freshness is never the limiting factor;
        # staleness in this test comes purely from a station-level last_reported gap.
        poll_rows = [
            (synthetic_city, t0 - timedelta(minutes=15) + timedelta(seconds=60 * i), "station_status", True, 1, 10)
            for i in range(0, int((140 * 60) / 60) + 1)
        ]
        dbmod.copy_rows(cur, "poll_log", ["city_id", "polled_at", "feed", "ok", "n_items", "latency_ms"], poll_rows)

        # Snapshots: fresh coverage up to t0, then a gap [t0, t0+25min) so t0+15 is stale
        # (last_reported > 10 min old), then resumed coverage so t0+30 is fresh again.
        snap_times = [t0 - timedelta(minutes=10), t0 - timedelta(minutes=5), t0]
        snap_times += [t0 + timedelta(minutes=m) for m in range(25, 135, 5)]
        snap_rows = [
            (pk, ts, 5, 5, None, True, True, True, ts - timedelta(seconds=10)) for ts in snap_times
        ]
        dbmod.copy_rows(
            cur, "station_snapshots",
            ["station_pk", "ts", "bikes", "docks", "ebikes", "is_installed", "is_renting", "is_returning", "last_reported"],
            snap_rows,
        )

        hist_rows = [
            (pk, t0, 15, "bd_raw", 0.7, 0.6, 5.2, None, 1.0, 0.8, 0.05, 0.04),
            (pk, t0, 30, "bd_raw", 0.7, 0.6, 5.2, None, 1.0, 0.8, 0.05, 0.04),
        ]
        dbmod.copy_rows(
            cur, "forecast_history",
            ["station_pk", "t0", "horizon", "tier", "p_bike", "p_dock", "exp_bikes", "model_version_id", "bd_a", "bd_d", "lam_in", "lam_out"],
            hist_rows,
        )
    db_conn.commit()

    now = t0 + timedelta(hours=6)
    summary = materialise_labels(db_conn, city, now)
    assert summary["n_rows"] == 1

    labels = dbmod.fetch_df(
        db_conn,
        "SELECT station_pk, t0, horizon, bikes0, docks0, y_bike, y_dock, y_cnt FROM forecast_labels WHERE station_pk=%(pk)s",
        {"pk": pk},
    )
    assert len(labels) == 1
    only = labels.iloc[0]
    assert int(only["horizon"]) == 30
    assert int(only["bikes0"]) == 5
    assert int(only["docks0"]) == 5
    assert bool(only["y_bike"]) is True
    assert bool(only["y_dock"]) is True
    assert int(only["y_cnt"]) == 5

    # idempotent: re-running writes nothing new
    summary2 = materialise_labels(db_conn, city, now)
    assert summary2["n_rows"] == 0
    labels_after = dbmod.fetch_df(db_conn, "SELECT count(*) AS n FROM forecast_labels WHERE station_pk=%(pk)s", {"pk": pk})
    assert int(labels_after["n"].iloc[0]) == 1


def test_multi_day_run_on_non_autocommit_connection(
    db_conn: psycopg.Connection, synthetic_city: int
) -> None:
    """Nightly-train conditions: autocommit=False conn + labels on >1 local day.

    conn.transaction() is then a SAVEPOINT, so ON COMMIT DROP doesn't fire
    between day iterations — without the explicit DROP the second day's
    CREATE TEMP TABLE collides (proving-week day-1 failure).
    """
    import os

    city = dbmod.fetch_df(db_conn, "SELECT * FROM cities WHERE id=%(c)s", {"c": synthetic_city}).iloc[0].to_dict()
    tz = tz_of(city["tz"])

    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO stations (city_id, station_id, name, lat, lon, capacity, is_active) "
            "VALUES (%s,%s,%s,%s,%s,%s,true) RETURNING id",
            (synthetic_city, "s2", "Station 2", 43.65, -79.38, 10),
        )
        row = cur.fetchone()
        assert row is not None
        pk = row[0]

        for day_offset in (0, 1):
            t0 = local_midnight(date(2026, 6, 15) + timedelta(days=day_offset), tz) + timedelta(hours=10)
            poll_rows = [
                (synthetic_city, t0 - timedelta(minutes=15) + timedelta(seconds=60 * i), "station_status", True, 1, 10)
                for i in range(0, 60)
            ]
            dbmod.copy_rows(cur, "poll_log", ["city_id", "polled_at", "feed", "ok", "n_items", "latency_ms"], poll_rows)
            snap_times = [t0 + timedelta(minutes=m) for m in range(-10, 45, 5)]
            snap_rows = [(pk, ts, 5, 5, None, True, True, True, ts - timedelta(seconds=10)) for ts in snap_times]
            dbmod.copy_rows(
                cur, "station_snapshots",
                ["station_pk", "ts", "bikes", "docks", "ebikes", "is_installed", "is_renting", "is_returning", "last_reported"],
                snap_rows,
            )
            dbmod.copy_rows(
                cur, "forecast_history",
                ["station_pk", "t0", "horizon", "tier", "p_bike", "p_dock", "exp_bikes", "model_version_id", "bd_a", "bd_d", "lam_in", "lam_out"],
                [(pk, t0, 30, "bd_raw", 0.7, 0.6, 5.2, None, 1.0, 0.8, 0.05, 0.04)],
            )
    db_conn.commit()

    now = local_midnight(date(2026, 6, 18), tz)
    with psycopg.connect(os.environ["DATABASE_URL_TEST"], autocommit=False) as conn2:
        summary = materialise_labels(conn2, city, now)
        conn2.commit()
    assert summary["n_rows"] == 2
