"""Trip-history flow rates for the `bd` baseline (docs/ml-spec.md §2.1,
docs/worker-spec.md §4.3).
"""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd
import psycopg

from dockcast_ml import db
from dockcast_ml.timeutil import day_type_array

BETA = 5.0
N_DAY_TYPES = 3
N_BUCKETS = 96


def _build_arrays(
    counts: pd.DataFrame, span: pd.DataFrame, hol: set[date]
) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict[str, int]]:
    """Returns (n_out, n_in, N, sid_pos): n_out/n_in shape (S,3,96), N shape (S,3)."""
    sid_list = sorted(set(counts["station_id"]) | set(span["station_id"]))
    sid_pos = {sid: i for i, sid in enumerate(sid_list)}
    s = len(sid_list)

    n_out = np.zeros((s, N_DAY_TYPES, N_BUCKETS), dtype=np.float64)
    n_in = np.zeros((s, N_DAY_TYPES, N_BUCKETS), dtype=np.float64)
    for row in counts.itertuples(index=False):
        i = sid_pos[row.station_id]
        n_out[i, int(row.day_type), int(row.bucket)] = row.n_start
        n_in[i, int(row.day_type), int(row.bucket)] = row.n_end

    n = np.zeros((s, N_DAY_TYPES), dtype=np.float64)
    for row in span.itertuples(index=False):
        i = sid_pos[row.station_id]
        dates = pd.date_range(row.first_seen, row.last_seen, freq="D")
        dow = dates.dayofweek.to_numpy()
        is_hol = pd.Series(dates.date).isin(hol).to_numpy()
        k = day_type_array(dow, is_hol).astype(np.int64)
        counts_by_k = np.bincount(k, minlength=N_DAY_TYPES)
        n[i, :] = counts_by_k

    return n_out, n_in, n, sid_pos


def _smooth_lambda(n: np.ndarray, big_n: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """n: (S,3,96), big_n: (S,3). Returns (lam, has_data): (S,3,96), (S,3) bool."""
    has_data = big_n > 0
    n_safe = np.where(has_data, big_n, 1.0)[:, :, None]
    r = np.where(has_data[:, :, None], n / n_safe, 0.0)
    r_smooth = 0.25 * np.roll(r, 1, axis=2) + 0.5 * r + 0.25 * np.roll(r, -1, axis=2)
    mu = np.where(has_data, n.sum(axis=2) / (N_BUCKETS * np.where(has_data, big_n, 1.0)), 0.0)
    lam = (big_n[:, :, None] * r_smooth + BETA * mu[:, :, None]) / (big_n[:, :, None] + BETA)
    return lam, has_data


def _fallback(lam: np.ndarray, has_data: np.ndarray) -> np.ndarray:
    fb = np.zeros((N_DAY_TYPES, N_BUCKETS), dtype=np.float64)
    for k in range(N_DAY_TYPES):
        mask = has_data[:, k]
        if mask.any():
            fb[k] = np.median(lam[mask, k, :], axis=0)
    return fb


def compute_rates(
    counts: pd.DataFrame, span: pd.DataFrame, stations: pd.DataFrame, hol: set[date]
) -> pd.DataFrame:
    """Returns station_pk, day_type, bucket, lam_in_per_min, lam_out_per_min, source.

    `stations` must already be filtered to active stations (ml-spec §2.1:
    "Map GBFS station_id -> station_pk (stations, active only)"). Logs
    `n_trips_stations`/`n_fallback_stations` via `df.attrs`.
    """
    n_out, n_in, big_n, sid_pos = _build_arrays(counts, span, hol)
    lam_out, has_data = _smooth_lambda(n_out, big_n)
    lam_in, _ = _smooth_lambda(n_in, big_n)
    fb_out = _fallback(lam_out, has_data)
    fb_in = _fallback(lam_in, has_data)

    active = stations[stations["is_active"]]
    frames: list[pd.DataFrame] = []
    n_trips_stations = 0
    n_fallback_stations = 0
    for srow in active.itertuples(index=False):
        gbfs_id = str(srow.station_id)
        pk = int(srow.id)
        i = sid_pos.get(gbfs_id)
        station_has_trips = False
        for k in range(N_DAY_TYPES):
            if i is not None and big_n[i, k] > 0:
                lo = lam_out[i, k, :]
                li = lam_in[i, k, :]
                source = "trips"
                station_has_trips = True
            else:
                lo = fb_out[k, :]
                li = fb_in[k, :]
                source = "fallback"
            frames.append(
                pd.DataFrame(
                    {
                        "station_pk": pk,
                        "day_type": k,
                        "bucket": np.arange(N_BUCKETS),
                        "lam_in_per_min": li / 15.0,
                        "lam_out_per_min": lo / 15.0,
                        "source": source,
                    }
                )
            )
        if station_has_trips:
            n_trips_stations += 1
        else:
            n_fallback_stations += 1

    out = (
        pd.concat(frames, ignore_index=True)
        if frames
        else pd.DataFrame(
            columns=[
                "station_pk",
                "day_type",
                "bucket",
                "lam_in_per_min",
                "lam_out_per_min",
                "source",
            ]
        )
    )
    out["lam_in_per_min"] = out["lam_in_per_min"].astype("float32")
    out["lam_out_per_min"] = out["lam_out_per_min"].astype("float32")
    out.attrs["n_trips_stations"] = n_trips_stations
    out.attrs["n_fallback_stations"] = n_fallback_stations
    return out


def write_rates(conn: psycopg.Connection, city_id: int, df: pd.DataFrame, fitted_at: object) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM station_flow_rates WHERE station_pk IN "
            "(SELECT id FROM stations WHERE city_id=%s)",
            (city_id,),
        )
        rows = [
            (
                int(r.station_pk),
                int(r.day_type),
                int(r.bucket),
                float(r.lam_in_per_min),
                float(r.lam_out_per_min),
                r.source,
                fitted_at,
            )
            for r in df.itertuples(index=False)
        ]
        db.copy_rows(
            cur,
            "station_flow_rates",
            ["station_pk", "day_type", "bucket", "lam_in_per_min", "lam_out_per_min", "source", "fitted_at"],
            rows,
        )
    conn.commit()


__all__ = ["compute_rates", "write_rates"]
