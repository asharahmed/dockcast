"""Forecast horizons (docs/architecture.md §5, docs/worker-spec.md §2.1).

MUST equal `HORIZONS` on the Node side (`packages/shared`); a test
(`tests/test_horizons.py`) asserts the two are identical by regex-extracting
the TS constant.
"""

from __future__ import annotations

HORIZONS: tuple[int, ...] = (15, 30, 45, 60, 90, 120)
MAX_HORIZON = 120
