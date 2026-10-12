"""Satu jalur eksekusi job pipeline untuk CLI dan API (docs/07 B12, docs/05 §4).

Sinkron (CLI/curl): hasil job dikembalikan langsung.
Asinkron (`?async=true`, dipakai tombol UI): job jalan di thread terpisah, pemanggil
menerima `run_id` dan memantau progres lewat `GET /api/v1/admin/runs/{run_id}`.
"""

from __future__ import annotations

import sqlite3
import threading
from typing import Callable

from . import db
from .repo import run as runs

# fn(params, report) -> dict hasil. `report(rows=…, rows_total=…, message=…, phase=…)` menulis progres.
JobFn = Callable[[dict, Callable[..., None]], dict]


def execute(
    kind: str,
    params: dict,
    fn: JobFn,
    *,
    async_: bool = False,
    triggered_by: str = "cli",
) -> tuple[int, dict | None]:
    """Catat run di `ingest_run`, jalankan `fn`. Hasil `None` berarti job masih jalan (async)."""
    conn = db.connect()
    try:
        run_id = runs.start(conn, kind, params, triggered_by)
    finally:
        conn.close()

    if async_:
        threading.Thread(target=_worker, args=(run_id, params, fn, False), daemon=True).start()
        return run_id, None
    return run_id, _worker(run_id, params, fn, True)


def _worker(run_id: int, params: dict, fn: JobFn, raise_errors: bool) -> dict | None:
    conn = db.connect()
    try:
        runs.mark_running(conn, run_id)
        result = fn(params, lambda **kw: runs.report(conn, run_id, **kw))
        failed = result.get("failed_tickers") or []
        runs.finish(
            conn,
            run_id,
            "partial" if failed else "ok",
            rows=int(result.get("rows", 0)),
            message=result.get("message"),
            result=result,
        )
        return result
    except Exception as exc:
        try:
            runs.finish(conn, run_id, "failed", message=f"{type(exc).__name__}: {exc}"[:500])
        except sqlite3.Error:
            pass  # baris run tetap ada (status `running`) sehingga kegagalan terlihat di UI
        if raise_errors:
            raise
        return None
    finally:
        conn.close()
