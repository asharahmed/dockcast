"""Continuous (online) scoring (docs/ml-spec.md §5.4, docs/worker-spec.md §8.3).

Rolling 1-day and 7-day metrics per tier/target/horizon/slice, written to
`model_metrics_daily`, powering the public `/model` page. `persistence` is
computed on the fly from the `bd_raw` rows (the base row set); every other
tier is scored on its own rows, inner-joined back to the base set so its
labels (`bikes0`, `docks0`, `y_*`) are always the base's.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import numpy as np
import psycopg

from dockcast_ml import db
from dockcast_ml.evaluate import Preds, metric_rows
from dockcast_ml.timeutil import local_midnight, tz_of

_WINDOW_SQL = """
SELECT h.station_pk, h.t0, h.horizon, h.tier, h.p_bike, h.p_dock, h.exp_bikes,
       l.bikes0, l.docks0, l.y_bike, l.y_dock, l.y_cnt
FROM forecast_history h
JOIN forecast_labels l USING (station_pk, t0, horizon)
JOIN stations s ON s.id = h.station_pk
WHERE s.city_id = %(city_id)s AND h.t0 >= %(t_from)s AND h.t0 < %(t_to)s
"""

_UPSERT_COLS = ["city_id", "day", "window_days", "tier", "target", "horizon", "slice", "metric", "value", "n"]
_CONFLICT_COLS = ["city_id", "day", "window_days", "tier", "target", "horizon", "slice", "metric"]
_UPDATE_COLS = ["value", "n"]


def _score_tier(tier: str, rows: Any) -> list[dict]:
    preds = Preds(
        p_bike=rows["p_bike"].to_numpy(dtype=np.float64),
        p_dock=rows["p_dock"].to_numpy(dtype=np.float64),
        y_cnt_hat=rows["exp_bikes"].to_numpy(dtype=np.float64),
    )
    return metric_rows(
        tier,
        preds,
        rows["y_bike"].to_numpy(),
        rows["y_dock"].to_numpy(),
        rows["y_cnt"].to_numpy(),
        rows["bikes0"].to_numpy(),
        rows["docks0"].to_numpy(),
        rows["horizon"].to_numpy(),
    )


def compute(conn: psycopg.Connection, city: dict[str, Any], t: date, windows: tuple[int, ...] = (1, 7)) -> dict:
    """Compute rolling `windows`-day online metrics for `city` ending (exclusive) on local
    date `t`, and upsert them into `model_metrics_daily`. Returns `{'windows': {w: {'n_rows':
    ..., 'tiers': [...]}}}`.
    """
    city_id = int(city["id"])
    tz = tz_of(city["tz"])
    summary: dict[str, Any] = {"windows": {}}

    for w in windows:
        t_from = local_midnight(t - timedelta(days=w), tz)
        t_to = local_midnight(t, tz)
        df = db.fetch_df(conn, _WINDOW_SQL, {"city_id": city_id, "t_from": t_from, "t_to": t_to})

        if df.empty:
            summary["windows"][w] = {"n_rows": 0, "tiers": []}
            continue

        base = df[df["tier"] == "bd_raw"][
            ["station_pk", "t0", "horizon", "bikes0", "docks0", "y_bike", "y_dock", "y_cnt"]
        ]

        all_rows: list[dict] = []

        if not base.empty:
            persistence_preds = Preds(
                p_bike=(base["bikes0"].to_numpy() >= 1).astype(np.float64),
                p_dock=(base["docks0"].to_numpy() >= 1).astype(np.float64),
                y_cnt_hat=base["bikes0"].to_numpy(dtype=np.float64),
            )
            all_rows.extend(
                metric_rows(
                    "persistence",
                    persistence_preds,
                    base["y_bike"].to_numpy(),
                    base["y_dock"].to_numpy(),
                    base["y_cnt"].to_numpy(),
                    base["bikes0"].to_numpy(),
                    base["docks0"].to_numpy(),
                    base["horizon"].to_numpy(),
                )
            )

        tiers_scored = ["persistence"] if not base.empty else []
        for tier in sorted(df["tier"].unique()):
            tier_rows = df[df["tier"] == tier]
            joined = tier_rows.merge(base, on=["station_pk", "t0", "horizon"], how="inner", suffixes=("", "_base"))
            if joined.empty:
                continue
            all_rows.extend(_score_tier(tier, joined))
            tiers_scored.append(tier)

        eval_rows = [
            (
                city_id,
                t,
                w,
                r["tier"],
                r["target"],
                r["horizon"],
                r["slice"],
                r["metric"],
                r["value"],
                r["n"],
            )
            for r in all_rows
        ]
        with conn.cursor() as cur:
            db.upsert_rows(cur, "model_metrics_daily", _UPSERT_COLS, _CONFLICT_COLS, _UPDATE_COLS, eval_rows)
        conn.commit()

        summary["windows"][w] = {"n_rows": len(df), "tiers": tiers_scored}

    return summary


__all__ = ["compute"]
