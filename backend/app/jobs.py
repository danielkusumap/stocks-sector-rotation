"""Satu jalur eksekusi job pipeline untuk CLI dan API (docs/07 B12, docs/05 §4).

Sinkron (CLI/curl): hasil job dikembalikan langsung.
Asinkron (`?async=true`, dipakai tombol UI): job jalan di thread terpisah, pemanggil
menerima `run_id` dan memantau progres lewat `GET /api/v1/admin/runs/{run_id}`.
"""

from __future__ import annotations

import sqlite3
import threading
import time
from typing import Callable

from . import db
from .compute import index, metrics, rrg
from .ingest import freshness, prices
from .repo import run as runs

# fn(params, report) -> dict hasil. `report(rows=…, rows_total=…, message=…, phase=…)` menulis progres.
JobFn = Callable[[dict, Callable[..., None]], dict]


def midday(params: dict, report: Callable[..., None]) -> dict:
    """Job tengah hari (docs/02 §5): cek gate → kalau lolos, ingest intraday hari berjalan.

    Gate gagal bukan error: hasilnya `{"gate": "stale", "computed": false}` dengan HTTP 200.
    """
    conn = db.connect()
    try:
        gate = freshness.probe(conn)
        if gate["gate"] != "ok":
            return {
                "gate": "stale",
                "last_bar_at": gate["last_bar_at"],
                "required_bar_time": gate["required_bar_time"],
                "computed": False,
            }
        report(phase="ingest_intraday")
        intraday = prices.ingest_intraday(report=report)
        return {
            "gate": "ok",
            "last_bar_at": gate["last_bar_at"],
            "computed": False,  # compute rrg midday menyusul di B5 (gate-nya sudah terbuka)
            "intraday_rows": intraday["rows"],
            "message": "ingest intraday selesai; compute midday menyusul di B5",
        }
    finally:
        conn.close()


def compute(params: dict, report: Callable[..., None]) -> dict:
    """Stage hitung pipa (docs/05 §4.1): `index` → `rrg`; metrik & sinyal menyusul (B6/B7)."""
    started = time.monotonic()
    stage = params.get("stage", "index")
    timeframe = params.get("timeframe", "d1")
    result: dict = {"stage": stage, "timeframe": timeframe}
    rows = 0

    if stage in ("index", "all"):
        index_result = index.compute_index(report=report)
        rows += index_result["rows"]
        result["sectors"] = index_result["sectors"]
        result["weightings"] = index_result["weightings"]
    if stage in ("rrg", "all"):
        timeframes_list = ["d1", "w1"] if stage == "all" else [timeframe]
        rrg_result = rrg.compute_rrg(timeframes=timeframes_list, report=report)
        rows += rrg_result["rows"]
        result["timeframes"] = rrg_result["timeframes"]
        metrics_result = metrics.compute_metrics(timeframes=timeframes_list, report=report)
        rows += metrics_result["rows"]
        result["metrics_rows"] = metrics_result["rows"]
        scores_result = metrics.compute_scores(timeframes=timeframes_list)
        rows += scores_result["rows"]
        result["score_rows"] = scores_result["rows"]

    result["rows"] = rows
    result["duration_s"] = round(time.monotonic() - started, 2)
    return result


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
