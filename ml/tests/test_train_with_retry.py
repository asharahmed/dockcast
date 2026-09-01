"""ml/scripts/train-with-retry.sh state machine, against a fake cgroup dir and a fake Docker
Engine API on a unix socket (docs/infra.md §3.4). Needs bash + curl; skipped otherwise."""

from __future__ import annotations

import json
import os
import shutil
import socketserver
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "train-with-retry.sh"
GIB = 1024**3

pytestmark = pytest.mark.skipif(
    shutil.which("bash") is None or shutil.which("curl") is None, reason="needs bash and curl"
)


class _FakeDockerApi(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    """Records `POST /containers/<id>/update` bodies and mirrors `Memory` into the fake cgroup."""

    daemon_threads = True

    def __init__(self, path: str, cgroup: Path) -> None:
        self.updates: list[tuple[str, dict]] = []
        self.cgroup = cgroup
        super().__init__(path, _Handler)


class _Handler(BaseHTTPRequestHandler):
    server: _FakeDockerApi

    def do_POST(self) -> None:  # noqa: N802 (http.server API)
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length) or b"{}")
        self.server.updates.append((self.path, body))
        (self.server.cgroup / "memory.max").write_text(f"{body['Memory']}\n")
        payload = b'{"Warnings":[]}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_: object) -> None:
        return


@pytest.fixture
def harness(tmp_path: Path):
    cgroup = tmp_path / "cg"
    cgroup.mkdir()
    (cgroup / "memory.max").write_text(f"{6 * GIB}\n")
    (cgroup / "memory.peak").write_text(f"{3 * GIB}\n")
    (cgroup / "memory.stat").write_text(f"anon {2 * GIB}\nfile {GIB}\n")
    (cgroup / "memory.events").write_text("low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\noom_group_kill 0\n")
    # AF_UNIX paths are capped at ~104 bytes on macOS; pytest's tmp_path is too deep for that.
    sock = Path(tempfile.mkdtemp(prefix="twr")) / "d.sock"
    api = _FakeDockerApi(str(sock), cgroup)
    threading.Thread(target=api.serve_forever, daemon=True).start()
    state_file = tmp_path / "state" / "train_mem_limit"

    def run(train_script: str, env_extra: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
        fake = tmp_path / "fake_train.sh"
        fake.write_text("#!/usr/bin/env bash\n" + train_script)
        fake.chmod(0o755)
        env = {
            **os.environ,
            "CGROUP_DIR": str(cgroup),
            "DOCKER_SOCK": str(sock),
            "CONTAINER_ID": "abc123",
            "TRAIN_MEM_STEP": "2g",
            "TRAIN_MEM_MAX": "8g",
            "TRAIN_MEM_STATE_FILE": str(state_file),
            "TRAIN_CMD": str(fake),
            "COUNTER": str(tmp_path / "counter"),
            **(env_extra or {}),
        }
        return subprocess.run(["bash", str(SCRIPT), "train", "--city", "x"], env=env, capture_output=True, text=True, timeout=60)

    yield api, cgroup, state_file, run
    api.shutdown()
    api.server_close()
    shutil.rmtree(sock.parent, ignore_errors=True)


# A "trainer" that is OOM-killed once (exit 137 + oom_kill event), then succeeds.
_OOM_ONCE = """
n=$(cat "$COUNTER" 2>/dev/null || echo 0); echo $((n+1)) > "$COUNTER"
if [ "$n" -eq 0 ]; then
  sed -i.bak 's/^oom_kill .*/oom_kill 1/' "$CGROUP_DIR/memory.events"
  echo "$(cat "$CGROUP_DIR/memory.max")" > "$CGROUP_DIR/memory.peak"
  exit 137
fi
echo "trained $*"
"""


def test_oom_kill_raises_limit_and_retries(harness) -> None:
    api, cgroup, state_file, run = harness
    res = run(_OOM_ONCE)
    assert res.returncode == 0, res.stderr
    assert "trained train --city x" in res.stdout
    assert [u[0] for u in api.updates] == ["/containers/abc123/update"]
    assert api.updates[0][1] == {"Memory": 8 * GIB, "MemorySwap": 16 * GIB}
    assert cgroup.joinpath("memory.max").read_text().strip() == str(8 * GIB)
    assert state_file.read_text().strip() == str(8 * GIB)
    assert "OOM-killed" in res.stderr and "raising memory limit 6144 -> 8192 MiB" in res.stderr


def test_oom_at_ceiling_gives_up_with_137(harness) -> None:
    api, cgroup, _state_file, run = harness
    (cgroup / "memory.max").write_text(f"{8 * GIB}\n")
    res = run(_OOM_ONCE)
    assert res.returncode == 137
    assert api.updates == []
    assert "already at TRAIN_MEM_MAX" in res.stderr


def test_non_oom_failure_is_not_retried(harness) -> None:
    api, _cgroup, state_file, run = harness
    res = run('echo $(( $(cat "$COUNTER" 2>/dev/null || echo 0) + 1 )) > "$COUNTER"; exit 3')
    assert res.returncode == 3
    assert api.updates == []
    assert not state_file.exists()


def test_exit_137_without_oom_event_is_not_retried(harness) -> None:
    api, _cgroup, _state_file, run = harness
    res = run("exit 137")  # e.g. an external `docker kill`; oom_kill stays 0
    assert res.returncode == 137
    assert api.updates == []
    assert "not an OOM kill" in res.stderr


def test_persisted_limit_is_reapplied_before_running(harness) -> None:
    api, cgroup, state_file, run = harness
    state_file.parent.mkdir(parents=True)
    state_file.write_text(f"{8 * GIB}\n")  # left by an earlier escalation; container came back at 6g
    res = run('echo trained')
    assert res.returncode == 0
    assert api.updates[0][1]["Memory"] == 8 * GIB
    assert cgroup.joinpath("memory.max").read_text().strip() == str(8 * GIB)
    assert "re-applying persisted limit 8192 MiB" in res.stderr


def test_high_anon_peak_raises_limit_preemptively(harness) -> None:
    api, cgroup, state_file, run = harness
    (cgroup / "memory.stat").write_text(f"anon {5 * GIB}\nfile {GIB}\n")  # 83% of 6g
    res = run("echo trained")
    assert res.returncode == 0
    assert api.updates[0][1]["Memory"] == 8 * GIB
    assert state_file.read_text().strip() == str(8 * GIB)
    assert "headroom threshold" in res.stderr


def test_low_anon_peak_leaves_limit_alone(harness) -> None:
    """Page cache is not counted: cgroup peak is 100% of the limit here, anon only 33%."""
    api, cgroup, state_file, run = harness
    (cgroup / "memory.peak").write_text(f"{6 * GIB}\n")
    res = run("echo trained")
    assert res.returncode == 0
    assert api.updates == []
    assert not state_file.exists()
    assert "peak anon 2048 MiB = 33% of the 6144 MiB limit (cgroup peak incl. cache 6144 MiB)" in res.stderr
