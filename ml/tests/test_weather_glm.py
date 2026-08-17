"""T7 (docs/ml-spec.md §8): weather multiplier is mean-one over the fitting window (before clip)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from dockcast_ml.segments import PRECIP_EDGES, TEMP_EDGES
from dockcast_ml.weather_glm import fit_multipliers


def _synthetic_hourly_and_weather(n_hours: int, seed: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    start = datetime(2026, 1, 1, tzinfo=UTC)
    hours = [start + timedelta(hours=i) for i in range(n_hours)]

    temp_c = rng.uniform(-15, 35, size=n_hours)
    precip_mm = rng.choice([0.0, 0.05, 0.5, 2.0, 5.0], size=n_hours)

    # base counts modulated by temperature/precip so the GLM has real signal to fit
    tb = np.digitize(temp_c, TEMP_EDGES)
    pb = np.digitize(precip_mm, PRECIP_EDGES)
    temp_effect = np.array([0.5, 0.8, 1.2, 1.0, 0.7])[tb]
    precip_effect = np.array([1.0, 0.9, 0.6, 0.3])[pb]
    base = 20.0
    lam = base * temp_effect * precip_effect
    n_start = rng.poisson(lam)

    hourly = pd.DataFrame({"hour": hours, "n_start": n_start})
    weather = pd.DataFrame({"hour": hours, "temp_c": temp_c, "precip_mm": precip_mm})
    return hourly, weather


def test_multiplier_mean_one() -> None:
    hourly, weather = _synthetic_hourly_and_weather(24 * 60, seed=7)
    df, diagnostics = fit_multipliers(hourly, weather, ZoneInfo("America/Toronto"), hol=set())

    assert len(df) == 20
    assert set(df["temp_bin"]) == set(range(5))
    assert set(df["precip_bin"]) == set(range(4))
    assert diagnostics["Z"] > 0

    # Reconstruct the pre-clip mean-one check directly from returned diagnostics.
    beta_t = np.array(diagnostics["beta_t"])
    beta_p = np.array(diagnostics["beta_p"])
    z = diagnostics["Z"]

    temp_c = weather["temp_c"].to_numpy()
    precip_mm = weather["precip_mm"].to_numpy()
    tb = np.digitize(temp_c, TEMP_EDGES)
    pb = np.digitize(precip_mm, PRECIP_EDGES)
    m_raw = np.exp(beta_t[tb] + beta_p[pb])

    assert abs(float((m_raw / z).mean()) - 1.0) < 1e-6


def test_multiplier_clip_bounds() -> None:
    hourly, weather = _synthetic_hourly_and_weather(24 * 60, seed=11)
    df, _diagnostics = fit_multipliers(hourly, weather, ZoneInfo("America/Toronto"), hol=set())
    assert (df["m"] >= 0.1).all()
    assert (df["m"] <= 3.0).all()
