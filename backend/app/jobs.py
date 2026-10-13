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
from .compute import index, metrics, midday as midday_compute, plan, rrg, signals, ta
from .config import get_settings
from .ingest import excel, freshness, prices
from .repo import run as runs

# fn(params, report) -> dict hasil. `report(rows=…, rows_total=…, message=…, phase=…)` menulis progres.
JobFn = Callable[[dict, Callable[..., None]], dict]

# docs/05 §4.6: `ingest_run.kind` hanya enam nilai ini (chip status & prasyarat tombol di UI
# bergantung pada nama persisnya). `compute_index`/`compute_rrg` bukan kind berdiri sendiri.
KIND_ALIASES = {"excel": "import_excel", "compute_index": "compute_all", "compute_rrg": "compute_all"}


def kind_of(raw: str) -> str:
    """Nama kind baku (docs/05 §4.6)."""
    return KIND_ALIASES.get(raw, raw)


def _universe_counts() -> tuple[int, int]:
    """(jumlah sektor aktif, jumlah emiten aktif) untuk bentuk `result_json` compute_all."""
    conn = db.connect()
    try:
        sectors = conn.execute("SELECT COUNT(*) FROM sector WHERE is_active = 1").fetchone()[0]
        tickers = conn.execute("SELECT COUNT(*) FROM stock WHERE is_active = 1").fetchone()[0]
    finally:
        conn.close()
    return sectors, tickers


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
        computed = midday_compute.compute_midday(report=report)
        return {
            "gate": "ok",
            "last_bar_at": gate["last_bar_at"],
            "computed": computed["sectors"] > 0,
            "intraday_rows": intraday["rows"],
            "midday_rows": computed["rows"],
            "sectors": computed["sectors"],
            "as_of": computed["as_of"],
            "message": computed.get("message") or "RRG & metrik midday dihitung ulang",
        }
    finally:
        conn.close()


def compute(params: dict, report: Callable[..., None]) -> dict:
    """Stage hitung pipa (docs/05 §4.1): `index` → `rrg` (+ metrik & skor) → `signals` (mingguan)."""
    started = time.monotonic()
    stage = params.get("stage", "index")
    timeframe = params.get("timeframe", "d1")
    result: dict = {"stage": stage, "timeframe": timeframe}
    rows = 0
    result["sectors"], result["tickers"] = _universe_counts()

    if stage in ("index", "all"):
        index_result = index.compute_index(report=report)
        rows += index_result["rows"]
        result["sectors"] = index_result["sectors"]
        result["weightings"] = index_result["weightings"]
    if stage in ("rrg", "all", "signals"):
        if stage == "signals":
            # Tombol 5 bisa ditekan sebelum tombol 4: sinyal saham butuh indikator & RS harian.
            conn = db.connect()
            try:
                needs_daily = conn.execute("SELECT COUNT(*) FROM stock_metrics WHERE timeframe = 'd1'").fetchone()[0] == 0
            finally:
                conn.close()
            if needs_daily:
                rows += rrg.compute_rrg(timeframes=["d1"], report=report)["rows"]
                rows += metrics.compute_metrics(timeframes=["d1"], report=report)["rows"]
                rows += metrics.compute_scores(timeframes=["d1"])["rows"]
        timeframes_list = ["d1", "w1"] if stage == "all" else (["w1_fri"] if stage == "signals" else [timeframe])
        scopes = ("sector",) if stage == "signals" else ("sector", "stock")
        rrg_result = rrg.compute_rrg(timeframes=timeframes_list, scopes=scopes, report=report)
        rows += rrg_result["rows"]
        result["timeframes"] = list(rrg_result["timeframes"])
        metrics_result = metrics.compute_metrics(timeframes=timeframes_list, report=report)
        rows += metrics_result["rows"]
        result["metrics_rows"] = metrics_result["rows"]
        scores_result = metrics.compute_scores(timeframes=timeframes_list)
        rows += scores_result["rows"]
        result["score_rows"] = scores_result["rows"]

        if stage == "all":
            # Tombol 4 juga menghasilkan sinyal mingguan, jadi prasyarat `w1_fri` (RRG/metrik/skor
            # sektor) harus dihitung di sini — sektor saja, supaya tidak menambah beban saham.
            rows += rrg.compute_rrg(timeframes=["w1_fri"], scopes=("sector",), report=report)["rows"]
            rows += metrics.compute_metrics(timeframes=["w1_fri"], report=report)["rows"]
            rows += metrics.compute_scores(timeframes=["w1_fri"])["rows"]
            result["timeframes"].append("w1_fri")

    if stage in ("signals", "all"):
        signals_result = signals.compute_signals(report=report)
        rows += signals_result["rows"]
        result["signal_weeks"] = signals_result["weeks"]
        result["signal_rows"] = signals_result["rows"]
        if stage == "signals":  # bentuk result_json compute_signals (docs/05 §4.6)
            result["sectors"], result["stocks"] = signals_result["sectors"], signals_result["stocks"]
            result["week_end"] = signals_result["week_end"]

    if stage in ("ta", "all"):
        # docs/05 §4.1: `stage=all` (tombol 4) **ikut** menghitung analisa teknikal.
        ta_result = ta.compute_ta(report=report)
        rows += ta_result["rows"]
        result["ta_rows"], result["ta_refs"] = ta_result["rows"], ta_result["refs"]
        if stage == "ta":  # bentuk result_json compute_ta (docs/05 §4.6)
            result.update({key: ta_result[key] for key in ("events", "refs", "ma_periods", "variants", "win_rate")})
        # (b) plan + skenario untuk **semua** emiten aktif → `stock_plan` (docs/03 §6.5, B20).
        conn = db.connect()
        try:
            plan_result = plan.plan_for_all(conn, get_settings(), report=report)
        finally:
            conn.close()
        rows += plan_result["rows"]
        result["plan_rows"], result["plan_refs"] = plan_result["rows"], plan_result["refs"]
        result["plan_skipped_short_history"] = plan_result["skipped_short_history"]
        result["scenario_null_refs"] = plan_result["scenario_null_refs"]

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
    kind = kind_of(kind)
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
    except excel.AlreadyImported as exc:
        # "file sudah pernah diimport" = prasyarat terpenuhi, bukan kegagalan (docs/05 §4.3 `skipped`).
        # HTTP tetap 409 lewat pemanggil (API), dan UI tidak boleh mengunci tombol import gara-gara ini.
        try:
            runs.finish(conn, run_id, "skipped", message=f"file sudah pernah diimport (import_id={exc.import_id})")
        except sqlite3.Error:
            pass
        if raise_errors:
            raise
        return None
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
