"""Online metrics DB test (docs/ml-spec.md §5.4, docs/worker-spec.md §8.3): `persistence`
and `bd_raw` are scored on the same row set; every seeded tier gets `model_metrics_daily`
rows for both the 1-day and 7-day windows; reliability bins are written at horizon 0.
"""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import psycopg
import pytest

from dockcast_ml import db as dbmod
from dockcast_ml.metrics_online import compute
from dockcast_ml.timeutil import local_midnight, tz_of


@pytest.mark.db
def test_metrics_online_windows_and_rel_bins(db_conn: psycopg.Connection, synthetic_city: int) -> None:
    city = dbmod.fetch_df(db_conn, "SELECT * FROM cities WHERE id=%(c)s", {"c": synthetic_city}).iloc[0].to_dict()
    tz = tz_of(city["tz"])
    t = date(2026, 6, 15)
    t0_base = local_midnight(t, tz) - timedelta(hours=12)

    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO stations (city_id, station_id, name, lat, lon, capacity, is_active) "
            "VALUES (%s,%s,%s,%s,%s,%s,true) RETURNING id",
            (synthetic_city, "s1", "Station 1", 43.65, -79.38, 20),
        )
        row = cur.fetchone()
        assert row is not None
        pk = row[0]

        rng = np.random.default_rng(1)
        n = 40
        rows_hist: list[tuple] = []
        rows_labels: list[tuple] = []
        for i in range(n):
            t0 = t0_base - timedelta(minutes=15 * i)
            horizon = 15 if i % 2 == 0 else 30
            bikes0 = int(rng.integers(0, 21))
            docks0 = 20 - bikes0
            y_bike = bool(bikes0 >= 1)
            y_dock = bool(docks0 >= 1)
            y_cnt = bikes0
            p_bike_raw = float(np.clip(rng.normal(0.6, 0.2), 0, 1))
            p_dock_raw = float(np.clip(rng.normal(0.6, 0.2), 0, 1))
            exp_bikes = float(bikes0)
            rows_labels.append((pk, t0, horizon, bikes0, docks0, y_bike, y_dock, y_cnt))
            for tier, p_bike, p_dock in (
                ("bd_raw", p_bike_raw, p_dock_raw),
                ("bd_cal", min(1.0, p_bike_raw * 0.9 + 0.05), min(1.0, p_dock_raw * 0.9 + 0.05)),
                ("gbm_active", min(1.0, p_bike_raw * 0.95), min(1.0, p_dock_raw * 0.95)),
            ):
                rows_hist.append((pk, t0, horizon, tier, p_bike, p_dock, exp_bikes, None, None, None, None, None))

        dbmod.copy_rows(
            cur, "forecast_labels",
            ["station_pk", "t0", "horizon", "bikes0", "docks0", "y_bike", "y_dock", "y_cnt"],
            rows_labels,
        )
        dbmod.copy_rows(
            cur, "forecast_history",
            ["station_pk", "t0", "horizon", "tier", "p_bike", "p_dock", "exp_bikes", "model_version_id", "bd_a", "bd_d", "lam_in", "lam_out"],
            rows_hist,
        )
    db_conn.commit()

    summary = compute(db_conn, city, t, windows=(1, 7))
    assert summary["windows"][1]["n_rows"] > 0
    assert "persistence" in summary["windows"][1]["tiers"]
    assert "bd_raw" in summary["windows"][1]["tiers"]

    metrics = dbmod.fetch_df(
        db_conn, "SELECT * FROM model_metrics_daily WHERE city_id=%(c)s AND day=%(d)s", {"c": synthetic_city, "d": t}
    )
    assert not metrics.empty
    tiers_present = set(metrics["tier"].unique())
    for tier in ("persistence", "bd_raw", "bd_cal", "gbm_active"):
        assert tier in tiers_present, f"missing tier {tier}"

    for w in (1, 7):
        assert not metrics[metrics["window_days"] == w].empty

    rel = metrics[(metrics["horizon"] == 0) & (metrics["metric"].str.startswith("rel_bin_"))]
    assert not rel.empty

    def _n(tier: str) -> int:
        sub = metrics[
            (metrics["tier"] == tier)
            & (metrics["target"] == "bike")
            & (metrics["horizon"] == 0)
            & (metrics["slice"] == "all")
            & (metrics["metric"] == "brier")
            & (metrics["window_days"] == 1)
        ]
        return int(sub["n"].iloc[0])

    assert _n("persistence") == _n("bd_raw"), "persistence and bd_raw must be scored on the same base row set"
