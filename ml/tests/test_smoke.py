"""Smoke test for the WP-0 dockcast_ml scaffold (docs/worker-spec.md §9)."""

from __future__ import annotations

import subprocess
import sys

import dockcast_ml


def test_import() -> None:
    assert dockcast_ml.__version__ == "0.1.0"


def test_cli_predict_once_not_implemented() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "dockcast_ml", "predict", "--once"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 2
