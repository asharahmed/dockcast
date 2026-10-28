"""Database primitives (docs/worker-spec.md §2.3): connections, COPY, upsert, worker_runs."""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from typing import Any

import pandas as pd
import psycopg
from psycopg.rows import dict_row, tuple_row

from dockcast_ml import progress
from dockcast_ml.config import Config


def connect(
    cfg: Config, autocommit: bool = False, application_name: str = "dockcast_ml"
) -> psycopg.Connection:
    """A psycopg connection with dict rows and an `application_name` (visible in `pg_stat_activity`;
    the trainer passes its own so its sessions can be told apart from the predictor's).
    """
    return psycopg.connect(
        cfg.database_url,
        autocommit=autocommit,
        row_factory=dict_row,
        application_name=application_name,
    )


def copy_rows(
    cur: psycopg.Cursor, table: str, cols: list[str], rows: Iterable[Sequence[Any]]
) -> int:
    """COPY `rows` (plain tuples/sequences) into `table` via the COPY protocol. Returns row count."""
    n = 0
    col_list = ",".join(cols)
    with cur.copy(f"COPY {table} ({col_list}) FROM STDIN") as cp:
        for row in rows:
            cp.write_row(row)
            n += 1
    return n


def _copy_value(value: Any) -> Any:
    """NaN -> NULL for COPY (Postgres would otherwise accept the literal 'NaN')."""
    if isinstance(value, float) and pd.isna(value):
        return None
    if value is pd.NaT:
        return None
    return value


def copy_df(cur: psycopg.Cursor, table: str, df: pd.DataFrame) -> int:
    """COPY a DataFrame into `table`; columns must equal `df.columns`. NaN -> NULL."""
    cols = list(df.columns)
    rows = (tuple(_copy_value(v) for v in row) for row in df.itertuples(index=False, name=None))
    return copy_rows(cur, table, cols, rows)


def copy_records(
    cur: psycopg.Cursor, table: str, cols: list[str], records: Iterable[Mapping[str, Any]]
) -> int:
    """COPY dict records into `table` in `cols` order, straight from the Python values.

    Use this instead of `copy_df` when a column mixes `None` and ints (e.g. `model_version_id`):
    a DataFrame upcasts such a column to float64 and COPY then rejects "19.0" for an integer
    column. NaN -> NULL as in `copy_df`.
    """
    return copy_rows(cur, table, cols, (tuple(_copy_value(r[c]) for c in cols) for r in records))


def upsert_rows(
    cur: psycopg.Cursor,
    table: str,
    cols: list[str],
    conflict_cols: list[str],
    update_cols: list[str],
    rows: Iterable[Sequence[Any]],
) -> int:
    """INSERT ... ON CONFLICT (conflict_cols) DO UPDATE SET c=EXCLUDED.c for each of update_cols."""
    col_list = ",".join(cols)
    placeholders = ",".join(["%s"] * len(cols))
    conflict_list = ",".join(conflict_cols)
    set_list = ",".join(f"{c}=EXCLUDED.{c}" for c in update_cols)
    sql = (
        f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) "
        f"ON CONFLICT ({conflict_list}) DO UPDATE SET {set_list}"
    )
    materialised = list(rows)
    if materialised:
        cur.executemany(sql, materialised)
    return len(materialised)


def fetch_df(conn: psycopg.Connection, sql: str, params: Any = None) -> pd.DataFrame:
    """Run `sql` and return the result as a DataFrame (empty DataFrame if no rows).

    Buffers the whole result set as Python dicts before building the frame, so it is
    only for result sets of at most a few hundred thousand rows; use
    `fetch_df_chunked` for anything larger.
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    return pd.DataFrame(rows)


# Default batch size for `fetch_df_chunked`; callers override it to exercise the
# multi-chunk path in tests.
CHUNK_ROWS = 250_000


def fetch_df_chunked(
    conn: psycopg.Connection,
    sql: str,
    params: Any = None,
    *,
    dtypes: Mapping[str, str] | None = None,
    chunk_rows: int = CHUNK_ROWS,
    name: str = "dockcast_fetch",
) -> pd.DataFrame:
    """Like `fetch_df`, but streams the result through a server-side cursor.

    Fetches `chunk_rows` at a time, narrows each chunk to `dtypes` (a
    `{column: pandas dtype}` map; columns absent from the result are ignored) and
    concatenates. Only the current chunk is ever held as Python objects, so peak
    memory is the size of the narrowed frame rather than of the whole result set as
    boxed dicts -- the difference between ~0.5 GiB and ~7 GiB for the 7-day window
    in `metrics_online` (12.7M rows x 12 columns as of 2026-09).

    The explicit `conn.transaction()` block is what keeps the cursor streaming: on an
    autocommit connection the `DECLARE` would otherwise be committed on its own, taking
    the cursor with it, and declaring it `WITH HOLD` instead would make the server
    materialise the whole result set. Inside an open transaction the block is a
    savepoint, so a caller's pending writes are neither committed nor disturbed.
    """
    frames: list[pd.DataFrame] = []
    cols: list[str] = []
    with conn.transaction(), conn.cursor(name=name, row_factory=tuple_row) as cur:
        cur.itersize = chunk_rows
        cur.execute(sql, params)
        cols = [d.name for d in cur.description or []]
        while True:
            rows = cur.fetchmany(chunk_rows)
            if not rows:
                break
            chunk = pd.DataFrame(rows, columns=cols)
            del rows
            frames.append(_narrow(chunk, dtypes))

    if not frames:
        return pd.DataFrame(columns=cols)
    if len(frames) == 1:
        return frames[0]
    out = pd.concat(frames, ignore_index=True)
    frames.clear()
    return out


def _narrow(df: pd.DataFrame, dtypes: Mapping[str, str] | None) -> pd.DataFrame:
    """Cast the columns of `df` named in `dtypes` (unknown names ignored)."""
    if not dtypes:
        return df
    present = {c: t for c, t in dtypes.items() if c in df.columns}
    return df.astype(present) if present else df


def _finish_progress(recorder: progress.ProgressRecorder, summary: dict[str, Any]) -> None:
    """Stop live progress and keep its last state in the final summary."""
    progress.activate(None)
    recorder.stop()
    summary["progress"] = recorder.snapshot()


@contextmanager
def worker_run(cfg: Config, kind: str, city_id: int | None) -> Iterator[dict[str, Any]]:
    """Record a `worker_runs` row for the lifetime of the `with` block.

    Uses its own autocommit connection (independent of any transaction the
    caller is managing). Yields a mutable `summary` dict; on normal exit
    writes `ok=true, summary=<dict>`; on exception writes `ok=false,
    error=str(exc)[:2000], summary=<dict as far as it got>` and re-raises.
    """
    conn = psycopg.connect(cfg.database_url, autocommit=True)
    summary: dict[str, Any] = {}
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO worker_runs (city_id, kind, started_at) VALUES (%s,%s,now()) RETURNING id",
                (city_id, kind),
            )
            row = cur.fetchone()
            assert row is not None
            run_id = row[0]

        recorder: progress.ProgressRecorder | None = None
        if kind == "train":
            recorder = progress.ProgressRecorder(cfg.database_url, run_id)
            recorder.start()
            progress.activate(recorder)

        try:
            yield summary
        except Exception as exc:
            if recorder is not None:
                _finish_progress(recorder, summary)
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE worker_runs SET finished_at=now(), ok=false, error=%s, "
                    "summary=%s::jsonb WHERE id=%s",
                    (str(exc)[:2000], json.dumps(summary, default=str), run_id),
                )
            raise
        else:
            if recorder is not None:
                _finish_progress(recorder, summary)
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE worker_runs SET finished_at=now(), ok=true, summary=%s::jsonb WHERE id=%s",
                    (json.dumps(summary, default=str), run_id),
                )
    finally:
        conn.close()
