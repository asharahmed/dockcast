"""Live trainer progress, persisted into the running train `worker_runs` row.

`worker_run(cfg, "train", ...)` starts a `ProgressRecorder`; `memory.log_memory` (called at every
trainer phase marker) forwards each marker to whichever recorder is active. The recorder writes
`summary.progress = {phase, phases: [{phase, ts, rss_mib, peak_rss_mib}], attempt, updated_at}` on
its own autocommit connection, so the status page (`GET /api/v1/status`) sees it immediately and
the trainer's main transaction is never involved. A daemon thread refreshes `updated_at` every
`HEARTBEAT_S` seconds so a long phase with no marker (the boosting fit) is not mistaken for a dead
process. Every database failure here is logged and swallowed; progress must never break training.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import UTC, datetime
from typing import Any

import psycopg

logger = logging.getLogger(__name__)

HEARTBEAT_S = 30.0
MAX_PHASES = 64

_active: ProgressRecorder | None = None


def _env_int(name: str) -> int | None:
    try:
        return int(os.environ[name])
    except (KeyError, ValueError):
        return None


class ProgressRecorder:
    def __init__(self, database_url: str, run_id: int, heartbeat_s: float = HEARTBEAT_S) -> None:
        self._database_url = database_url
        self._run_id = run_id
        self._heartbeat_s = heartbeat_s
        self._lock = threading.Lock()
        self._conn: psycopg.Connection | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._state: dict[str, Any] = {
            "phase": "start",
            "phases": [],
            "attempt": _env_int("TRAIN_ATTEMPT"),
            "max_attempts": _env_int("TRAIN_MAX_ATTEMPTS"),
            "updated_at": _now(),
        }

    def start(self) -> None:
        self._write()
        if self._heartbeat_s > 0:
            self._thread = threading.Thread(target=self._beat, name="train-progress", daemon=True)
            self._thread.start()

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return json.loads(json.dumps(self._state))

    def record(self, phase: str, rss_mib: float | None, peak_rss_mib: float | None) -> None:
        entry = {"phase": phase, "ts": _now(), "rss_mib": rss_mib, "peak_rss_mib": peak_rss_mib}
        with self._lock:
            phases: list[dict[str, Any]] = self._state["phases"]
            if phases and phases[-1]["phase"] == phase:
                phases[-1] = entry  # a phase that reports repeatedly (feature_build) keeps one row
            elif len(phases) < MAX_PHASES:
                phases.append(entry)
            self._state["phase"] = phase
            self._state["updated_at"] = entry["ts"]
        self._write()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        with self._lock:
            conn, self._conn = self._conn, None
        if conn is not None:
            try:
                conn.close()
            except Exception:
                logger.debug("progress connection close failed", exc_info=True)

    def _beat(self) -> None:
        while not self._stop.wait(self._heartbeat_s):
            with self._lock:
                self._state["updated_at"] = _now()
            self._write()

    def _write(self) -> None:
        try:
            with self._lock:
                payload = json.dumps(self._state)
                if self._conn is None or self._conn.closed:
                    self._conn = psycopg.connect(
                        self._database_url,
                        autocommit=True,
                        application_name="dockcast_ml_train_progress",
                        connect_timeout=5,
                    )
                self._conn.execute(
                    "UPDATE worker_runs SET summary = jsonb_set(coalesce(summary, '{}'::jsonb), "
                    "'{progress}', %s::jsonb) WHERE id = %s AND finished_at IS NULL",
                    (payload, self._run_id),
                )
        except Exception:
            logger.warning("could not persist train progress", exc_info=True)
            with self._lock:
                conn, self._conn = self._conn, None
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def activate(recorder: ProgressRecorder | None) -> None:
    global _active
    _active = recorder


def record_phase(phase: str, rss_mib: float | None, peak_rss_mib: float | None) -> None:
    """Forward a phase marker to the active recorder, if any. Never raises."""
    rec = _active
    if rec is None:
        return
    try:
        rec.record(phase, rss_mib, peak_rss_mib)
    except Exception:
        logger.warning("could not record train progress", exc_info=True)


__all__ = ["ProgressRecorder", "activate", "record_phase"]
