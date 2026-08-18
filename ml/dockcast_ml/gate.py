"""Promotion gate (docs/ml-spec.md §5.3, docs/worker-spec.md §7.5).

Decides whether a freshly trained `gbm` candidate is promoted to `active` or
stored as `shadow`, by comparing pooled (`slice='all'`, all horizons pooled)
`val`-split metrics against a reference tier (`bd_cal` if it exists else
`bd_raw`) and, if one exists, the currently `active` gbm.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

_BRIER_VS_REF_THRESHOLD = 0.95
_ECE_THRESHOLD = 0.05
_MAE_VS_REF_THRESHOLD = 1.0
_BRIER_VS_ACTIVE_THRESHOLD = 1.0


@dataclass
class Check:
    name: str
    value: float | None
    threshold: float | None
    ok: bool

    def to_json(self) -> dict:
        return {"name": self.name, "value": self.value, "threshold": self.threshold, "ok": self.ok}


@dataclass
class GateResult:
    passed: bool
    reference_tier: str
    checks: list[Check] = field(default_factory=list)

    def to_json(self) -> dict:
        """docs/api.md §4 `Gate` shape: `{passed, checks}` — `reference_tier` is carried
        separately in `MetricsVal.ref.tier`, not in the stored `gate` JSON (api.md is
        normative for what `model_versions.gate`/the API read).
        """
        return {"passed": self.passed, "checks": [c.to_json() for c in self.checks]}


def _ratio_check(name: str, cand_value: float, ref_value: float, threshold: float) -> Check:
    """`value = cand/ref`; `ok = value <= threshold`. A non-finite or non-positive `ref_value`
    (or a non-finite `cand_value`) makes the ratio meaningless — `value=None, ok=False`
    (conservatively fails the check rather than promoting on undefined grounds).
    """
    if not math.isfinite(ref_value) or ref_value <= 0 or not math.isfinite(cand_value):
        return Check(name=name, value=None, threshold=threshold, ok=False)
    value = cand_value / ref_value
    return Check(name=name, value=value, threshold=threshold, ok=value <= threshold)


def _absolute_check(name: str, value: float, threshold: float) -> Check:
    if not math.isfinite(value):
        return Check(name=name, value=None, threshold=threshold, ok=False)
    return Check(name=name, value=value, threshold=threshold, ok=value <= threshold)


def evaluate_gate(cand: dict, ref: dict, active: dict | None, reference_tier: str) -> GateResult:
    """`cand`/`ref`/`active`: `{'brier_bike','brier_dock','ece_bike','ece_dock','mae'}` pooled
    over horizons, slice `'all'`, on `val`. `active` is `None` when no active gbm exists yet —
    the two `_vs_active` checks are then omitted entirely (not included with null values).
    """
    checks = [
        _ratio_check("brier_bike_vs_ref", cand["brier_bike"], ref["brier_bike"], _BRIER_VS_REF_THRESHOLD),
        _ratio_check("brier_dock_vs_ref", cand["brier_dock"], ref["brier_dock"], _BRIER_VS_REF_THRESHOLD),
        _absolute_check("ece_bike", cand["ece_bike"], _ECE_THRESHOLD),
        _absolute_check("ece_dock", cand["ece_dock"], _ECE_THRESHOLD),
        _ratio_check("mae_vs_ref", cand["mae"], ref["mae"], _MAE_VS_REF_THRESHOLD),
    ]
    if active is not None:
        checks.append(
            _ratio_check("brier_bike_vs_active", cand["brier_bike"], active["brier_bike"], _BRIER_VS_ACTIVE_THRESHOLD)
        )
        checks.append(
            _ratio_check("brier_dock_vs_active", cand["brier_dock"], active["brier_dock"], _BRIER_VS_ACTIVE_THRESHOLD)
        )
    passed = all(c.ok for c in checks)
    return GateResult(passed=passed, reference_tier=reference_tier, checks=checks)


__all__ = ["Check", "GateResult", "evaluate_gate"]
