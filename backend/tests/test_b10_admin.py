"""B10 — runs baku, backup streaming, dan job retention."""

from __future__ import annotations


import sqlite3
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from backend.app import db, jobs, maintenance
from backend.app.config import get_settings

TODAY = datetime.now(ZoneInfo("Asia/Jakarta")).date()


@pytest.fixture
def client(tmp_db, monkeypatch):
    monkeypatch.setattr(db, "db_path", lambda: tmp_db)
    from backend.app.main import app

    return TestClient(app)


# --- nama kind baku (docs/05 §4.6) -------------------------------------------


def test_kind_baku_enam_nilai():
    """docs/05 §4.6 — hanya enam nilai; `compute_index`/`compute_rrg` dilipat ke `compute_all`."""
    baku = {"import_excel", "prices_daily", "prices_intraday", "compute_all", "compute_signals", "midday"}
    assert jobs.kind_of("excel") == "import_excel"
    assert jobs.kind_of("compute_index") == "compute_all"
    assert jobs.kind_of("compute_rrg") == "compute_all"
    for stage in ("index", "rrg", "signals", "all"):  # nilai yang dikirim UI/CLI
        assert jobs.kind_of(f"compute_{stage}") in baku
    for raw in ("prices_daily", "prices_intraday", "compute_signals", "midday"):
        assert jobs.kind_of(raw) == raw and raw in baku


def test_run_mencatat_kind_baku(tmp_db, monkeypatch):
    monkeypatch.setattr(db, "db_path", lambda: tmp_db)
    jobs.execute("excel", {"x": 1}, lambda p, report: {"rows": 1, "message": "ok"}, triggered_by="cli")
    jobs.execute("compute_rrg", {"stage": "rrg"}, lambda p, report: {"rows": 2}, triggered_by="api")

    conn = db.connect(tmp_db)
    try:
        kinds = [r[0] for r in conn.execute("SELECT kind FROM ingest_run ORDER BY id")]
    finally:
        conn.close()
    assert kinds == ["import_excel", "compute_all"]
    assert set(kinds) <= {"import_excel", "prices_daily", "prices_intraday", "compute_all", "compute_signals", "midday"}


def test_amplop_daftar_run_pakai_kunci_runs(client, tmp_db):
    jobs.execute("midday", {}, lambda p, report: {"rows": 0}, triggered_by="api")

    body = client.get("/api/v1/admin/runs?limit=5").json()
    assert body["api_version"] == "1.1"  # docs/05 §4.6
    assert "runs" in body and "items" not in body
    assert body["total"] == 1
    row = body["runs"][0]
    assert row["kind"] == "midday" and row["status"] in ("ok", "partial")
    assert set(row) >= {"run_id", "kind", "status", "started_at", "finished_at", "rows", "rows_total", "percent", "phase", "message", "failed_tickers"}


# --- backup ------------------------------------------------------------------


def test_backup_terunduh_dan_utuh(client, tmp_db):
    """AC docs/07 B10: backup terunduh dan bisa dibuka (`PRAGMA integrity_check` = ok)."""
    conn = db.connect(tmp_db)
    try:
        conn.execute(
            "INSERT INTO stock (ticker, yahoo_symbol, sector_id, is_active, updated_at) VALUES ('AAAA','AAAA.JK',1,1,'2026-10-13T00:00:00+07:00')"
        )
        conn.commit()
    finally:
        conn.close()

    response = client.get("/api/v1/admin/export/backup")
    assert response.status_code == 200
    assert "attachment" in response.headers["content-disposition"]
    assert response.headers["content-type"] == "application/octet-stream"

    dest = Path(tempfile.gettempdir()) / "b10-backup-check.db"
    dest.write_bytes(response.content)
    check = sqlite3.connect(dest)
    try:
        assert check.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert check.execute("SELECT COUNT(*) FROM stock WHERE ticker = 'AAAA'").fetchone()[0] == 1
        assert check.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0] == 13
    finally:
        check.close()
        dest.unlink(missing_ok=True)


def test_backup_bisa_dimatikan(client, monkeypatch):
    monkeypatch.setattr(get_settings().api, "backup_enabled", False)
    response = client.get("/api/v1/admin/export/backup")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "backup_disabled"


# --- retention ---------------------------------------------------------------


def test_retention_memangkas_data_lama(client, tmp_db):
    cfg = get_settings()
    intraday_old = (TODAY - timedelta(days=cfg.retention["intraday_days"] + 5)).isoformat()
    midday_old = (TODAY - timedelta(days=cfg.retention["midday_rrg_days"] + 5)).isoformat()
    fresh = TODAY.isoformat()

    conn = db.connect(tmp_db)
    try:
        for day in (intraday_old, fresh):
            conn.execute(
                "INSERT INTO price_intraday (ticker, ts, interval, close, volume, session, ingested_at)"
                " VALUES ('AAAA', ?, '5m', 100, 1000, 'regular', 'x')",
                (f"{day}T09:00:00+07:00",),
            )
        for day in (midday_old, fresh):
            conn.execute(
                "INSERT INTO rrg_daily (as_of_date, scope, ref_id, timeframe, weighting, rs_ratio, rs_momentum,"
                " quadrant, bench_ref, computed_at) VALUES (?, 'sector', 'IDXFINANCE', 'midday', 'equal', 100, 100,"
                " 'leading', 'IHSG', 'x')",
                (day,),
            )
            conn.execute(
                "INSERT INTO sector_metrics (sector_id, as_of_date, timeframe, weighting, data_status, computed_at)"
                " VALUES (1, ?, 'midday', 'equal', 'ok', 'x')",
                (day,),
            )
        conn.commit()
    finally:
        conn.close()

    body = client.post("/api/v1/admin/retention").json()
    assert body["intraday_deleted"] == 1
    assert body["midday_rrg_deleted"] == 1
    assert body["midday_metrics_deleted"] == 1
    assert body["vacuumed"] is False  # file uji jauh di bawah `vacuum_min_file_mb`
    assert body["intraday_cutoff"] < fresh and body["size_mb"] > 0

    conn = db.connect(tmp_db)
    try:
        assert conn.execute("SELECT COUNT(*) FROM price_intraday").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM rrg_daily WHERE timeframe = 'midday'").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM sector_metrics WHERE timeframe = 'midday'").fetchone()[0] == 1
        kept = conn.execute("SELECT ts FROM price_intraday").fetchone()[0]
    finally:
        conn.close()
    assert kept.startswith(fresh)  # bar hari ini tidak dipangkas
    assert maintenance.retention(db_path=tmp_db)["intraday_deleted"] == 0  # idempoten
