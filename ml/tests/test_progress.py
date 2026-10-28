"""Live trainer progress (dockcast_ml.progress): persisted into the train worker_runs row."""

from __future__ import annotations

import logging
import os

import psycopg
import pytest

from dockcast_ml import db, progress
from dockcast_ml.config import Config
from dockcast_ml.memory import log_memory

logger = logging.getLogger("test_progress")


def _progress_of(conn: psycopg.Connection, run_kind: str) -> dict:
    row = conn.execute(
        "SELECT summary FROM worker_runs WHERE kind=%s ORDER BY id DESC LIMIT 1", (run_kind,)
    ).fetchone()
    assert row is not None
    return row[0]["progress"]


@pytest.mark.db
def test_train_run_persists_phase_progress_live_and_in_final_summary(
    db_conn: psycopg.Connection, synthetic_city: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TRAIN_ATTEMPT", "2")
    monkeypatch.setenv("TRAIN_MAX_ATTEMPTS", "6")
    cfg = Config(database_url=os.environ["DATABASE_URL_TEST"])
    db_conn.autocommit = True

    with db.worker_run(cfg, "train", synthetic_city) as summary:
        summary["marker"] = 1
        live = _progress_of(db_conn, "train")  # written before any phase: visible immediately
        assert live["phases"] == [] and live["attempt"] == 2 and live["max_attempts"] == 6

        log_memory(logger, "labels")
        log_memory(logger, "serving_profile")
        log_memory(logger, "serving_profile")  # repeated marker keeps one row
        live = _progress_of(db_conn, "train")  # visible while the run is still open
        assert [p["phase"] for p in live["phases"]] == ["labels", "serving_profile"]
        assert live["phase"] == "serving_profile"
        assert live["phases"][0]["peak_rss_mib"] > 0
        assert live["updated_at"]

    ok, final = db_conn.execute("SELECT ok, summary FROM worker_runs WHERE kind='train'").fetchone()
    assert ok is True
    assert final["marker"] == 1
    assert [p["phase"] for p in final["progress"]["phases"]] == ["labels", "serving_profile"]
    assert progress._active is None


@pytest.mark.db
def test_failed_train_run_keeps_progress_and_non_train_runs_have_none(
    db_conn: psycopg.Connection, synthetic_city: int
) -> None:
    cfg = Config(database_url=os.environ["DATABASE_URL_TEST"])
    with pytest.raises(ValueError, match="boom"), db.worker_run(cfg, "train", synthetic_city):
        log_memory(logger, "labels")
        raise ValueError("boom")
    ok, final = db_conn.execute("SELECT ok, summary FROM worker_runs WHERE kind='train'").fetchone()
    assert ok is False
    assert [p["phase"] for p in final["progress"]["phases"]] == ["labels"]

    with db.worker_run(cfg, "profile", synthetic_city):
        log_memory(logger, "labels")
    (other,) = db_conn.execute("SELECT summary FROM worker_runs WHERE kind='profile'").fetchone()
    assert "progress" not in other


def test_unreachable_database_never_breaks_training(caplog: pytest.LogCaptureFixture) -> None:
    rec = progress.ProgressRecorder("postgresql://nobody@127.0.0.1:1/none", 1, heartbeat_s=0)
    progress.activate(rec)
    try:
        with caplog.at_level(logging.WARNING):
            rec.start()
            log_memory(logger, "labels")  # must not raise
    finally:
        progress.activate(None)
        rec.stop()
    assert "could not persist train progress" in caplog.text
    assert [p["phase"] for p in rec.snapshot()["phases"]] == ["labels"]


def test_record_phase_without_a_recorder_is_a_noop() -> None:
    progress.activate(None)
    progress.record_phase("labels", 1.0, 2.0)
