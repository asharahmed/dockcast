"""T17 (docs/ml-spec.md §8): gate truth table -- each of the 7 checks failing alone
implies `passed=False`; all passing implies `passed=True`; no `active` omits the two
`_vs_active` checks; JSON shape matches docs/api.md §4's `Gate` type exactly.
"""

from __future__ import annotations

import pytest

from dockcast_ml.gate import evaluate_gate

_CHECK_NAMES = [
    "brier_bike_vs_ref",
    "brier_dock_vs_ref",
    "ece_bike",
    "ece_dock",
    "mae_vs_ref",
    "brier_bike_vs_active",
    "brier_dock_vs_active",
]


def _base() -> tuple[dict, dict, dict]:
    ref = {"brier_bike": 0.20, "brier_dock": 0.20, "ece_bike": 0.02, "ece_dock": 0.02, "mae": 2.0}
    cand = {
        "brier_bike": 0.9 * ref["brier_bike"],
        "brier_dock": 0.9 * ref["brier_dock"],
        "ece_bike": 0.02,
        "ece_dock": 0.02,
        "mae": 0.9 * ref["mae"],
    }
    active = {"brier_bike": cand["brier_bike"], "brier_dock": cand["brier_dock"]}
    return cand, ref, active


def test_all_pass() -> None:
    cand, ref, active = _base()
    result = evaluate_gate(cand, ref, active, "bd_cal")
    assert result.passed is True
    for check in result.checks:
        assert check.ok is True

    json_ = result.to_json()
    assert set(json_.keys()) == {"passed", "checks"}
    assert json_["passed"] is True
    assert [c["name"] for c in json_["checks"]] == _CHECK_NAMES
    for c in json_["checks"]:
        assert set(c.keys()) == {"name", "value", "threshold", "ok"}


def test_no_active_omits_vs_active_checks() -> None:
    cand, ref, _active = _base()
    result = evaluate_gate(cand, ref, None, "bd_raw")
    assert result.passed is True
    names = [c.name for c in result.checks]
    assert "brier_bike_vs_active" not in names
    assert "brier_dock_vs_active" not in names
    assert len(names) == 5


def _mutate(check_name: str) -> tuple[dict, dict, dict]:
    cand, ref, active = _base()
    if check_name == "brier_bike_vs_ref":
        cand["brier_bike"] = ref["brier_bike"] * 0.96
        active["brier_bike"] = cand["brier_bike"]
    elif check_name == "brier_dock_vs_ref":
        cand["brier_dock"] = ref["brier_dock"] * 0.96
        active["brier_dock"] = cand["brier_dock"]
    elif check_name == "ece_bike":
        cand["ece_bike"] = 0.06
    elif check_name == "ece_dock":
        cand["ece_dock"] = 0.06
    elif check_name == "mae_vs_ref":
        cand["mae"] = ref["mae"] * 1.01
    elif check_name == "brier_bike_vs_active":
        active["brier_bike"] = cand["brier_bike"] * 0.9
    elif check_name == "brier_dock_vs_active":
        active["brier_dock"] = cand["brier_dock"] * 0.9
    else:
        raise ValueError(check_name)
    return cand, ref, active


@pytest.mark.parametrize("check_name", _CHECK_NAMES)
def test_each_check_fails_alone(check_name: str) -> None:
    cand, ref, active = _mutate(check_name)
    result = evaluate_gate(cand, ref, active, "bd_cal")
    assert result.passed is False
    by_name = {c.name: c.ok for c in result.checks}
    assert by_name[check_name] is False
    for name, ok in by_name.items():
        if name != check_name:
            assert ok is True, f"{name} should still pass when only {check_name} fails"
