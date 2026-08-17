"""Weather multiplier via Poisson GLM (docs/ml-spec.md §2.2, docs/worker-spec.md §4.4)."""

from __future__ import annotations

from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import psycopg
import statsmodels.api as sm

from dockcast_ml import db
from dockcast_ml.segments import PRECIP_EDGES, TEMP_EDGES
from dockcast_ml.timeutil import day_type_array

REF_TEMP = 2
REF_PRECIP = 0
N_TEMP_BINS = 5
N_PRECIP_BINS = 4
N_DAYTYPE_HOUR = 72


def fit_multipliers(
    hourly: pd.DataFrame, weather: pd.DataFrame, tz: ZoneInfo, hol: set
) -> tuple[pd.DataFrame, dict]:
    """Returns (20-row DataFrame[temp_bin,precip_bin,m], diagnostics dict)."""
    merged = hourly.merge(weather, on="hour", how="inner")
    n_dropped_missing_weather = len(hourly) - len(merged)
    merged = merged.dropna(subset=["temp_c", "precip_mm"]).reset_index(drop=True)

    hour_utc = pd.to_datetime(merged["hour"], utc=True)
    local = hour_utc.dt.tz_convert(tz)
    hod = local.dt.hour.to_numpy()
    dow = local.dt.dayofweek.to_numpy()
    local_date = local.dt.date
    is_hol = pd.Series(local_date).isin(hol).to_numpy()
    k = day_type_array(dow, is_hol)

    temp_c = merged["temp_c"].to_numpy(dtype=np.float64)
    precip_mm = merged["precip_mm"].to_numpy(dtype=np.float64)
    tb = np.digitize(temp_c, TEMP_EDGES)
    pb = np.digitize(precip_mm, PRECIP_EDGES)

    n = len(merged)
    kh = k * 24 + hod
    x_kh = np.zeros((n, N_DAYTYPE_HOUR))
    x_kh[np.arange(n), kh] = 1.0

    x_t = np.zeros((n, N_TEMP_BINS))
    x_t[np.arange(n), tb] = 1.0
    x_t = np.delete(x_t, REF_TEMP, axis=1)

    x_p = np.zeros((n, N_PRECIP_BINS))
    x_p[np.arange(n), pb] = 1.0
    x_p = np.delete(x_p, REF_PRECIP, axis=1)

    x = np.hstack([x_kh, x_t, x_p])
    y = merged["n_start"].to_numpy(dtype=np.float64)

    model = sm.GLM(y, x, family=sm.families.Poisson())
    res = model.fit(maxiter=100)
    params = np.asarray(res.params)

    beta_t = np.zeros(N_TEMP_BINS)
    temp_cols = [i for i in range(N_TEMP_BINS) if i != REF_TEMP]
    beta_t[temp_cols] = params[N_DAYTYPE_HOUR : N_DAYTYPE_HOUR + len(temp_cols)]

    beta_p = np.zeros(N_PRECIP_BINS)
    precip_cols = [i for i in range(N_PRECIP_BINS) if i != REF_PRECIP]
    offset = N_DAYTYPE_HOUR + len(temp_cols)
    beta_p[precip_cols] = params[offset : offset + len(precip_cols)]

    m_raw_per_hour = np.exp(beta_t[tb] + beta_p[pb])
    z = float(m_raw_per_hour.mean()) if n > 0 else 1.0

    rows = []
    for temp_bin_idx in range(N_TEMP_BINS):
        for precip_bin_idx in range(N_PRECIP_BINS):
            raw = float(np.exp(beta_t[temp_bin_idx] + beta_p[precip_bin_idx]))
            m = float(np.clip(raw / z, 0.1, 3.0)) if z > 0 else 1.0
            rows.append((temp_bin_idx, precip_bin_idx, m))
    out = pd.DataFrame(rows, columns=["temp_bin", "precip_bin", "m"])

    diagnostics = {
        "n_hours": n,
        "n_dropped_missing_weather": int(n_dropped_missing_weather),
        "converged": bool(getattr(res, "converged", True)),
        "deviance": float(res.deviance),
        "Z": z,
        "beta_t": beta_t.tolist(),
        "beta_p": beta_p.tolist(),
    }
    return out, diagnostics


def write_multipliers(
    conn: psycopg.Connection, city_id: int, df: pd.DataFrame, fitted_at: object
) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM weather_multipliers WHERE city_id=%s", (city_id,))
        rows = [
            (city_id, int(r.temp_bin), int(r.precip_bin), float(r.m), fitted_at)
            for r in df.itertuples(index=False)
        ]
        db.copy_rows(cur, "weather_multipliers", ["city_id", "temp_bin", "precip_bin", "m", "fitted_at"], rows)
    conn.commit()
