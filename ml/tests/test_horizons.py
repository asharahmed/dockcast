"""T18 (docs/ml-spec.md §8): HORIZONS must be identical to the Node side."""

from __future__ import annotations

import re
from pathlib import Path

from dockcast_ml.horizons import HORIZONS

REPO_ROOT = Path(__file__).resolve().parents[2]
SHARED_CONSTANTS = REPO_ROOT / "packages" / "shared" / "src" / "constants.ts"


def test_horizons_value() -> None:
    assert HORIZONS == (15, 30, 45, 60, 90, 120)


def test_constants_match_ts() -> None:
    text = SHARED_CONSTANTS.read_text()
    match = re.search(r"HORIZONS\s*=\s*\[([^\]]+)\]", text)
    assert match is not None, f"could not find HORIZONS array in {SHARED_CONSTANTS}"
    ts_values = tuple(int(v.strip()) for v in match.group(1).split(",") if v.strip())
    assert ts_values == HORIZONS
