"""Memory observability and release helpers for the nightly trainer.

`log_memory` writes one `train_memory` line per training phase with the process's current and
peak resident set size, so a nightly peak can be attributed to a phase from the container logs.
`release` forces a garbage collection and, on glibc, hands freed heap pages back to the OS: after
a large numpy/pandas free the allocator otherwise keeps them mapped, and they still count
against the container's memory limit.
"""

from __future__ import annotations

import ctypes
import gc
import logging
import resource
import sys


def _mib(n_bytes: int) -> float:
    return round(n_bytes / 1048576, 1)


def _peak_rss_bytes() -> int:
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return peak if sys.platform == "darwin" else peak * 1024  # KiB on Linux, bytes on macOS


def _current_rss_bytes() -> int | None:
    """VmRSS from /proc/self/status (Linux only); `None` where it is unavailable."""
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        pass
    return None


def log_memory(logger: logging.Logger, phase: str) -> None:
    """Log the current and peak RSS (MiB) of this process after `phase`."""
    rss = _current_rss_bytes()
    logger.info(
        "train_memory",
        extra={
            "phase": phase,
            "rss_mib": None if rss is None else _mib(rss),
            "peak_rss_mib": _mib(_peak_rss_bytes()),
        },
    )


def release() -> None:
    """`gc.collect()`, then `malloc_trim(0)` on Linux/glibc (a no-op elsewhere)."""
    gc.collect()
    if not sys.platform.startswith("linux"):
        return
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except (OSError, AttributeError):
        pass  # not glibc (e.g. musl): nothing to trim


__all__ = ["log_memory", "release"]
