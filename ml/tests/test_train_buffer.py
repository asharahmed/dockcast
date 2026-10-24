"""`train._SplitBuffer` fills preallocated arrays day by day; the result must equal the old
concatenate-the-parts assembly, in order, whether the expected row count is exact, too small
or too large.
"""

from __future__ import annotations

import numpy as np
import pytest

from dockcast_ml.features import FEATURE_NAMES
from dockcast_ml.train import _SplitBuffer


def _parts(rng: np.random.Generator, sizes: list[int]):
    return [
        (
            rng.normal(size=(n, len(FEATURE_NAMES))).astype(np.float32),
            rng.integers(0, 2, n).astype(np.int8),
            rng.integers(0, 2, n).astype(np.int8),
            rng.normal(size=n).astype(np.float32),
        )
        for n in sizes
    ]


@pytest.mark.parametrize("expected_delta", [0, -7, 25])
def test_buffer_equals_concatenate(expected_delta: int) -> None:
    sizes = [5, 0, 12, 1, 30]
    parts = _parts(np.random.default_rng(0), sizes)
    buf = _SplitBuffer(sum(sizes) + expected_delta)
    for x, yb, yd, yc in parts:
        buf.append(x, yb, yd, yc)
    assert buf.n == sum(sizes)
    x, y = buf.finish()

    np.testing.assert_array_equal(x, np.concatenate([p[0] for p in parts]))
    np.testing.assert_array_equal(y["bike"], np.concatenate([p[1] for p in parts]))
    np.testing.assert_array_equal(y["dock"], np.concatenate([p[2] for p in parts]))
    np.testing.assert_array_equal(y["cnt"], np.concatenate([p[3] for p in parts]))
    assert x.dtype == np.float32 and y["bike"].dtype == np.int8 and y["cnt"].dtype == np.float32


def test_empty_buffer_finishes_empty() -> None:
    x, y = _SplitBuffer(0).finish()
    assert x.shape == (0, len(FEATURE_NAMES))
    assert len(y["bike"]) == 0
