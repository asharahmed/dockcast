"""Environment configuration (docs/worker-spec.md §1.2).

All config comes from environment variables, validated once at boot into a
frozen `Config`. Never read `os.environ` directly outside `load()` — pass an
explicit `env` mapping in tests instead of relying on process environment.
"""

from __future__ import annotations

import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Config:
    database_url: str
    log_level: str = "INFO"
    predict_interval_sec: int = 300
    trips_cache_dir: Path = Path("/data/trips")
    healthchecks_trainer_url: str | None = None
    git_sha: str = "unknown"


def load(env: Mapping[str, str] | None = None) -> Config:
    """Build a `Config` from environment variables (or an injected mapping for tests).

    Missing `DATABASE_URL`, or a `PREDICT_INTERVAL_SEC` that does not divide
    3600, is fatal: prints a message to stderr and raises `SystemExit(2)`.
    """
    import os

    source = os.environ if env is None else env

    database_url = source.get("DATABASE_URL")
    if not database_url:
        print("dockcast_ml: DATABASE_URL is required", file=sys.stderr)
        raise SystemExit(2)

    predict_interval_raw = source.get("PREDICT_INTERVAL_SEC", "300")
    try:
        predict_interval_sec = int(predict_interval_raw)
    except ValueError:
        print(
            f"dockcast_ml: PREDICT_INTERVAL_SEC must be an integer, got {predict_interval_raw!r}",
            file=sys.stderr,
        )
        raise SystemExit(2) from None
    if predict_interval_sec <= 0 or 3600 % predict_interval_sec != 0:
        print("dockcast_ml: PREDICT_INTERVAL_SEC must divide 3600", file=sys.stderr)
        raise SystemExit(2)

    healthchecks_trainer_url = source.get("HEALTHCHECKS_TRAINER_URL") or None

    return Config(
        database_url=database_url,
        log_level=source.get("LOG_LEVEL", "INFO"),
        predict_interval_sec=predict_interval_sec,
        trips_cache_dir=Path(source.get("TRIPS_CACHE_DIR", "/data/trips")),
        healthchecks_trainer_url=healthchecks_trainer_url,
        git_sha=source.get("GIT_SHA", "unknown"),
    )
