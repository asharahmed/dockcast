"""T1-T5 (docs/ml-spec.md §8): birth-death baseline."""

from __future__ import annotations

import numpy as np
import pytest

from dockcast_ml.bd import forecast_station, generator, summarise, transient_distributions
from dockcast_ml.horizons import HORIZONS
from dockcast_ml.segments import Segment


def _uniform_segments(dt_min: float, lin: float, lout: float, n: int) -> list[Segment]:
    """`n` equal segments of `dt_min` minutes each, constant rates, for `forecast_station`."""
    segs = []
    cum = 0.0
    for _ in range(n):
        cum += dt_min
        segs.append(Segment(dt_min=dt_min, day_type=0, bucket=0, m=1.0, cum_end=cum))
    return segs


def test_zero_rates_identity() -> None:
    """T1: lam_in = lam_out = 0 => p_h = e_{n0} for all h."""
    n0, capacity = 4, 10
    rates = np.zeros((3, 96, 2))
    segs = _uniform_segments(15.0, 0.0, 0.0, 8)  # tiles 120 minutes
    out = forecast_station(n0, capacity, rates, segs, horizons=HORIZONS)
    for h in HORIZONS:
        bd = out[h]
        expected_p_bike = 1.0  # n0 > 0
        expected_p_dock = 1.0  # n0 < C
        assert bd.p_bike == pytest.approx(expected_p_bike, abs=1e-12)
        assert bd.p_dock == pytest.approx(expected_p_dock, abs=1e-12)
        assert bd.exp == pytest.approx(n0, abs=1e-9)


def test_mass_conservation() -> None:
    """T2: random (C<=88, rates<=2/min) => |sum(p_h) - 1| < 1e-9 for all h."""
    rng = np.random.default_rng(1)
    for _ in range(10):
        capacity = int(rng.integers(1, 89))
        n0 = int(rng.integers(0, capacity + 1))
        lin = float(rng.uniform(0, 2))
        lout = float(rng.uniform(0, 2))
        segs = _uniform_segments(15.0, lin, lout, 8)
        cache: dict = {}
        p_by_h = transient_distributions(
            n0, capacity, [(s.dt_min, lin, lout) for s in segs], [float(h) for h in HORIZONS], cache=cache
        )
        for h in HORIZONS:
            p = p_by_h[float(h)]
            assert abs(p.sum() - 1.0) < 1e-9


def test_unbounded_mean() -> None:
    """T3: C=200, n0=100, lin=0.05, lout=0.03, h=15 => |E[n]-(100+0.3)| < 1e-3."""
    capacity, n0, lin, lout, h = 200, 100, 0.05, 0.03, 15.0
    p_by_h = transient_distributions(n0, capacity, [(h, lin, lout)], [h])
    p = p_by_h[h]
    exp_n = float((np.arange(capacity + 1) * p).sum())
    assert abs(exp_n - (n0 + (lin - lout) * h)) < 1e-3


@pytest.mark.slow
def test_monte_carlo_agreement() -> None:
    """T4: Gillespie MC, 20,000 paths, seed 0, C=20,n0=7,lin=0.4,lout=0.3,h=60."""
    capacity, n0, lin, lout, h = 20, 7, 0.4, 0.3, 60.0
    n_paths = 20_000
    rng = np.random.default_rng(0)

    n = np.full(n_paths, n0, dtype=np.int64)
    t = np.zeros(n_paths, dtype=np.float64)
    active = np.ones(n_paths, dtype=bool)

    while active.any():
        idx = np.nonzero(active)[0]
        cur_n = n[idx]
        birth_rate = np.where(cur_n < capacity, lin, 0.0)
        death_rate = np.where(cur_n > 0, lout, 0.0)
        total_rate = birth_rate + death_rate

        nonzero = total_rate > 0
        dt = np.full(idx.size, np.inf, dtype=np.float64)
        dt[nonzero] = rng.exponential(1.0 / total_rate[nonzero])
        next_t = t[idx] + dt

        crossed = next_t > h
        will_fire = (~crossed) & nonzero

        safe_total = np.where(total_rate > 0, total_rate, 1.0)
        u = rng.random(idx.size)
        is_birth = u < (birth_rate / safe_total)

        new_n = cur_n.copy()
        birth_fire = will_fire & is_birth
        death_fire = will_fire & ~is_birth
        new_n[birth_fire] += 1
        new_n[death_fire] -= 1

        n[idx[will_fire]] = new_n[will_fire]
        t[idx[will_fire]] = next_t[will_fire]

        done_mask = crossed | ~nonzero
        active[idx[done_mask]] = False

    p_bike_mc = float((n >= 1).mean())
    p_dock_mc = float((n < capacity).mean())

    p_by_h = transient_distributions(n0, capacity, [(h, lin, lout)], [h])
    bd_out = summarise(p_by_h[h], capacity, A=float("nan"), D=float("nan"))

    assert abs(bd_out.p_bike - p_bike_mc) < 0.02
    assert abs(bd_out.p_dock - p_dock_mc) < 0.02


def test_boundaries() -> None:
    """T5: n0=C => p_dock<1; n0=0 => p_bike<1 when rates>0."""
    capacity, lin, lout, h = 10, 0.5, 0.5, 15.0

    p_full = transient_distributions(capacity, capacity, [(h, lin, lout)], [h])[h]
    out_full = summarise(p_full, capacity, A=float("nan"), D=float("nan"))
    assert out_full.p_dock < 1.0

    p_empty = transient_distributions(0, capacity, [(h, lin, lout)], [h])[h]
    out_empty = summarise(p_empty, capacity, A=float("nan"), D=float("nan"))
    assert out_empty.p_bike < 1.0


def test_generator_shape_and_rowsums() -> None:
    q = generator(5, 0.3, 0.2)
    assert q.shape == (6, 6)
    assert np.allclose(q.sum(axis=1), 0.0)
    with pytest.raises(ValueError):
        generator(0, 0.1, 0.1)
