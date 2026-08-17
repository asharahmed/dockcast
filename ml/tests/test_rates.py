"""T6 (docs/ml-spec.md §8): recover known rates from synthetic trip counts."""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

from dockcast_ml.rates import compute_rates

FIRST_SEEN = date(2026, 1, 1)
LAST_SEEN = date(2026, 3, 12)


def _n_weekdays(first: date, last: date) -> int:
    dates = pd.date_range(first, last, freq="D")
    return int((dates.dayofweek < 5).sum())


N_WD = _n_weekdays(FIRST_SEEN, LAST_SEEN)  # exposure the rates module will compute for day_type=0


def _synthetic_counts_and_span(station_id: str, lam_by_bucket: np.ndarray) -> tuple[pd.DataFrame, pd.DataFrame]:
    """`lam_by_bucket`: (96,) trips-per-bucket-per-WD-day rate; n_start/n_end = lam * N_WD exactly."""
    rows = [
        {"station_id": station_id, "day_type": 0, "bucket": j, "n_start": int(round(lam_by_bucket[j] * N_WD)), "n_end": int(round(lam_by_bucket[j] * N_WD))}
        for j in range(96)
    ]
    counts = pd.DataFrame(rows)
    span = pd.DataFrame([{"station_id": station_id, "first_seen": FIRST_SEEN, "last_seen": LAST_SEEN}])
    return counts, span


def test_recover_known_rates() -> None:
    rng = np.random.default_rng(2)
    lam_true = rng.uniform(0.2, 3.0, size=96)
    counts, span = _synthetic_counts_and_span("A", lam_true)

    stations = pd.DataFrame(
        [{"id": 1, "station_id": "A", "name": "A", "lat": 0.0, "lon": 0.0, "capacity": 20, "is_active": True}]
    )
    hol: set[date] = set()

    df = compute_rates(counts, span, stations, hol)
    wd = df[df["day_type"] == 0].sort_values("bucket")
    assert len(wd) == 96
    assert (wd["source"] == "trips").all()

    r_out = wd["lam_out_per_min"].to_numpy() * 15.0  # back to per-bucket-per-day

    # n_start(j)/N == round(lam_true(j)*N)/N ~= lam_true(j): the raw (pre-smoothing) rate
    # recovers lam_true within 5% (rounding to integer trip counts is the only source of error).
    raw = np.array([round(v * N_WD) for v in lam_true]) / N_WD
    assert np.allclose(raw, lam_true, rtol=0.05)

    # post-shrinkage: reproduce the module's kernel + shrinkage formula independently from `raw`
    # (using the *rounded* raw rate, since that is what the module actually smooths) and check
    # the stored per-minute rate matches, and that shrinkage moved values toward the mean mu.
    mu = float(raw.mean())
    kernel = 0.25 * np.roll(raw, 1) + 0.5 * raw + 0.25 * np.roll(raw, -1)
    lam_expected = (N_WD * kernel + 5.0 * mu) / (N_WD + 5.0)
    assert np.allclose(r_out, lam_expected, rtol=1e-4, atol=1e-6)
    assert (np.abs(lam_expected - mu) <= np.abs(kernel - mu) + 1e-9).all()


def test_fallback_for_stations_without_data() -> None:
    rng = np.random.default_rng(3)
    lam_true = rng.uniform(0.5, 1.5, size=96)
    counts, span = _synthetic_counts_and_span("A", lam_true)

    stations = pd.DataFrame(
        [
            {"id": 1, "station_id": "A", "name": "A", "lat": 0.0, "lon": 0.0, "capacity": 20, "is_active": True},
            {"id": 2, "station_id": "B", "name": "B", "lat": 0.0, "lon": 0.0, "capacity": 20, "is_active": True},
        ]
    )
    hol: set[date] = set()
    df = compute_rates(counts, span, stations, hol)

    station_b = df[(df["station_pk"] == 2) & (df["day_type"] == 0)]
    assert len(station_b) == 96
    assert (station_b["source"] == "fallback").all()

    station_a = df[(df["station_pk"] == 1) & (df["day_type"] == 0)]
    b_sorted = station_b.sort_values("bucket")["lam_out_per_min"].to_numpy()
    a_sorted = station_a.sort_values("bucket")["lam_out_per_min"].to_numpy()
    assert np.allclose(b_sorted, a_sorted)  # single station with data => fallback == its own rate

    assert df.attrs["n_trips_stations"] == 1
    assert df.attrs["n_fallback_stations"] == 1
