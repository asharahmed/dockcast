"""Finite-capacity birth-death baseline (docs/ml-spec.md §2.3, docs/worker-spec.md §5).

State space `n in {0,...,C}` (bikes at the station). Generator `Q`:
`Q[n,n+1] = lam_in` for `n < C` (arrival, needs a dock), `Q[n,n-1] = lam_out`
for `n > 0` (departure, needs a bike), diagonal = -(row sum). Transition
matrices for a segment of length `dt` minutes are `expm(Q * dt)`.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from scipy.linalg import expm

from dockcast_ml.horizons import HORIZONS
from dockcast_ml.segments import Segment

TransitionCache = dict[tuple[int, float, float], np.ndarray]


def generator(C: int, lin: float, lout: float) -> np.ndarray:
    """(C+1, C+1) float64 generator matrix Q."""
    if C < 1:
        raise ValueError(f"capacity must be >= 1, got {C}")
    q = np.zeros((C + 1, C + 1), dtype=np.float64)
    if C >= 1:
        idx = np.arange(C)
        q[idx, idx + 1] = lin
        q[idx + 1, idx] = lout
    np.fill_diagonal(q, -q.sum(axis=1))
    return q


def transition(
    C: int, lin: float, lout: float, dt: float, cache: TransitionCache | None = None
) -> np.ndarray:
    """`expm(generator(C, lin, lout) * dt)`, memoised on `(C, round(lin*dt,9), round(lout*dt,9))`."""
    key = (C, round(lin * dt, 9), round(lout * dt, 9))
    if cache is not None and key in cache:
        return cache[key]
    p = expm(generator(C, lin, lout) * dt)
    if cache is not None:
        cache[key] = p
    return p


def transient_distributions(
    n0: int,
    C: int,
    segments: Sequence[tuple[float, float, float]],
    record_at: Sequence[float],
    cache: TransitionCache | None = None,
) -> dict[float, np.ndarray]:
    """Propagate `p = e_{n0}` through piecewise-constant `segments`.

    `segments`: `(dt_min, lam_in_per_min_eff, lam_out_per_min_eff)`, already
    multiplied by the weather multiplier `m`. `record_at`: cumulative minutes;
    each value must coincide (`|delta| < 1e-9`) with some segment's cumulative
    end. Returns `{h: p_h}`, `p_h` shape `(C+1,)`, sums to 1 (renormalised
    after every segment to guard float drift).
    """
    p = np.zeros(C + 1, dtype=np.float64)
    p[min(max(n0, 0), C)] = 1.0
    elapsed = 0.0
    targets = set(record_at)
    results: dict[float, np.ndarray] = {}
    for dt, lin, lout in segments:
        transition_matrix = transition(C, lin, lout, dt, cache)
        p = p @ transition_matrix
        p = np.clip(p, 0.0, None)
        total = p.sum()
        if total > 0:
            p = p / total
        elapsed += dt
        for h in targets:
            if h not in results and abs(elapsed - h) < 1e-9:
                results[h] = p.copy()
    return results


@dataclass
class BdOut:
    p_bike: float
    p_dock: float
    exp: float
    q10: int
    q90: int
    A: float
    D: float


def summarise(p: np.ndarray, C: int, A: float, D: float) -> BdOut:
    p_bike = float(1.0 - p[0])
    p_dock = float(1.0 - p[C])
    exp_val = float((np.arange(C + 1) * p).sum())
    cdf = np.cumsum(p)
    q10 = int(np.searchsorted(cdf, 0.10))
    q90 = int(np.searchsorted(cdf, 0.90))
    return BdOut(p_bike=p_bike, p_dock=p_dock, exp=exp_val, q10=q10, q90=q90, A=A, D=D)


def forecast_station(
    n0: int,
    C: int,
    rates_k_j: np.ndarray,
    segments: list[Segment],
    horizons: Sequence[int] = HORIZONS,
    cache: TransitionCache | None = None,
) -> dict[int, BdOut]:
    """`rates_k_j`: (3,96,2) per-minute [lam_in, lam_out] for this station.

    Effective rates per segment = `rates_k_j[day_type, bucket] * m`. `A_h`/`D_h`
    are cumulative sums of `lin*dt` / `lout*dt` over segments with
    `cum_end <= h`.
    """
    horizon_set = set(horizons)
    seg_tuples: list[tuple[float, float, float]] = []
    a_cum = 0.0
    d_cum = 0.0
    a_at: dict[int, float] = {}
    d_at: dict[int, float] = {}
    for seg in segments:
        lin = float(rates_k_j[seg.day_type, seg.bucket, 0]) * seg.m
        lout = float(rates_k_j[seg.day_type, seg.bucket, 1]) * seg.m
        seg_tuples.append((seg.dt_min, lin, lout))
        a_cum += lin * seg.dt_min
        d_cum += lout * seg.dt_min
        for h in horizon_set:
            if h not in a_at and abs(seg.cum_end - h) < 1e-9:
                a_at[h] = a_cum
                d_at[h] = d_cum

    p_by_h = transient_distributions(n0, C, seg_tuples, [float(h) for h in horizons], cache=cache)
    out: dict[int, BdOut] = {}
    for h in horizons:
        p_h = p_by_h.get(float(h))
        if p_h is None:
            continue
        out[h] = summarise(p_h, C, a_at.get(h, float("nan")), d_at.get(h, float("nan")))
    return out
