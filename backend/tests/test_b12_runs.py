"""B12 — pipeline API: `ingest_run`, endpoint runs, pola async (docs/05 §4)."""

from __future__ import annotations

import json
import sqlite3
import time

import pytest
from fastapi.testclient import TestClient

from backend import cli
from backend.app import db, jobs
from backend.app.db import MIGRATIONS_DIR
from backend.app.ingest import excel
from backend.app.repo import run as runs
from backend.tests.fixtures import FIXTURE_SHEETS, write_xlsx

# semua migrasi dijalankan dari db lama → user_version sama dengan nomor migrasi terakhir
LATEST_VERSION = max(int(p.name.split("_", 1)[0]) for p in MIGRATIONS_DIR.glob("[0-9]*_*.sql"))

OLD_INGEST_RUN = """
CREATE TABLE ingest_run (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  rows INTEGER NOT NULL DEFAULT 0,
  message TEXT
);
"""
NEW_COLUMNS = {"phase", "rows_total", "percent", "params_json", "result_json", "triggered_by"}
FINAL = {"ok", "partial", "failed", "skipped"}


def _cols(conn) -> set[str]:
    return {r["name"] for r in conn.execute("PRAGMA table_info(ingest_run)")}


def _client(tmp_db, monkeypatch) -> TestClient:
    monkeypatch.setattr(db, "db_path", lambda: tmp_db)
    from backend.app.main import app

    return TestClient(app)


def _upload(client: TestClient, data: bytes, query: str = ""):
    files = {"file": ("kecil.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    return client.post(f"/api/v1/admin/import/excel{query}", files=files)


# --- migrasi & skema ----------------------------------------------------------


def test_migration_adds_progress_columns_to_old_db(tmp_path):
    p = tmp_path / "old.db"
    conn = sqlite3.connect(p)
    conn.executescript(OLD_INGEST_RUN)
    conn.commit()
    conn.close()

    info = db.init_db(p)  # migrasi 001 jalan: kolom baru ditambahkan ke tabel lama
    assert info["user_version"] == LATEST_VERSION

    conn = db.connect(p)
    try:
        assert NEW_COLUMNS <= _cols(conn)
        stock_cols = {r["name"] for r in conn.execute("PRAGMA table_info(stock)")}
        assert "yahoo_sector_at" in stock_cols
    finally:
        conn.close()
    assert db.init_db(p)["user_version"] == LATEST_VERSION  # idempoten


def test_fresh_db_already_has_progress_columns(tmp_path):
    p = tmp_path / "fresh.db"
    info = db.init_db(p)  # schema.sql sudah memuat kolomnya → migrasi dilewati tanpa error
    assert info["tables"] == 13
    assert info["user_version"] == LATEST_VERSION

    conn = db.connect(p)
    try:
        assert NEW_COLUMNS <= _cols(conn)
        idx = conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_ingest_run_started'"
        ).fetchone()[0]
        assert idx == 1
    finally:
        conn.close()


# --- repo run -----------------------------------------------------------------


def test_run_lifecycle_and_progress(tmp_db):
    conn = db.connect(tmp_db)
    try:
        run_id = runs.start(conn, "prices_daily", {"mode": "daily"}, "api")
        assert runs.get(conn, run_id)["status"] == "queued"

        runs.mark_running(conn, run_id)
        runs.report(conn, run_id, rows=40, rows_total=100, message="batch 1/2", phase="ingest")
        run = runs.get(conn, run_id)
        assert (run["status"], run["rows"], run["rows_total"], run["percent"], run["phase"]) == (
            "running",
            40,
            100,
            40.0,
            "ingest",
        )
        assert run["params_json"] == {"mode": "daily"}
        assert run["triggered_by"] == "api"

        runs.finish(conn, run_id, "ok", rows=100, result={"rows": 100, "failed_tickers": ["MAP"]})
        run = runs.get(conn, run_id)
        assert run["status"] == "ok"
        assert run["percent"] == 100.0
        assert run["finished_at"] is not None
        assert run["failed_tickers"] == ["MAP"]
    finally:
        conn.close()


def test_failed_job_marks_run_failed(tmp_db, monkeypatch):
    monkeypatch.setattr(db, "db_path", lambda: tmp_db)

    def boom(_params, _report):
        raise RuntimeError("yahoo tidak menjawab")

    with pytest.raises(RuntimeError):
        jobs.execute("prices_daily", {"mode": "daily"}, boom, triggered_by="api")

    conn = db.connect(tmp_db)
    try:
        row = conn.execute("SELECT status, message, finished_at FROM ingest_run").fetchone()
    finally:
        conn.close()
    assert row["status"] == "failed"
    assert "yahoo tidak menjawab" in row["message"]
    assert row["finished_at"] is not None


# --- endpoint runs ------------------------------------------------------------


def test_sync_import_records_run(tmp_db, fixture_xlsx, monkeypatch):
    client = _client(tmp_db, monkeypatch)

    r = _upload(client, fixture_xlsx)
    assert r.status_code == 200, r.text
    assert r.json()["inserted"] == 5

    listed = client.get("/api/v1/admin/runs?limit=20").json()
    assert listed["api_version"] == "1.1"  # docs/05 §4.6
    assert listed["total"] == 1
    run = listed["runs"][0]
    assert run["kind"] == "import_excel"  # nama kind baku (docs/05 §4.6)
    assert run["status"] == "ok"
    assert run["rows"] == 5
    assert run["triggered_by"] == "api"
    assert run["params_json"]["bytes"] == len(fixture_xlsx)
    assert run["result_json"]["inserted"] == 5
    assert run["failed_tickers"] == []

    detail = client.get(f"/api/v1/admin/runs/{run['run_id']}").json()
    assert detail["api_version"] == "1.0"
    assert detail["run"] == run


def test_async_import_returns_202_then_finishes(tmp_db, fixture_xlsx, monkeypatch):
    client = _client(tmp_db, monkeypatch)

    r = _upload(client, fixture_xlsx, "?async=true")
    assert r.status_code == 202
    body = r.json()
    assert body["api_version"] == "1.0"
    assert body["status"] == "queued"
    run_id = body["run_id"]

    deadline = time.monotonic() + 15
    statuses = []
    while time.monotonic() < deadline:
        run = client.get(f"/api/v1/admin/runs/{run_id}").json()["run"]
        statuses.append(run["status"])
        if run["status"] in FINAL:
            break
        time.sleep(0.05)

    assert statuses[-1] == "ok", statuses
    assert run["rows"] == 5
    assert run["result_json"]["inserted"] == 5

    conn = db.connect(tmp_db)
    try:
        assert conn.execute("SELECT COUNT(*) FROM ingest_run WHERE status = 'running'").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM stock WHERE is_active = 1").fetchone()[0] == 5
    finally:
        conn.close()


def test_run_not_found(tmp_db, monkeypatch):
    client = _client(tmp_db, monkeypatch)
    r = client.get("/api/v1/admin/runs/999")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "run_not_found"


# --- CLI memakai fungsi yang sama ---------------------------------------------


def test_cli_import_records_run(tmp_config, tmp_path, capsys):
    xlsx = tmp_path / "kecil.xlsx"
    write_xlsx(xlsx, FIXTURE_SHEETS)

    assert cli.main(["import-excel", str(xlsx)]) == 0
    assert json.loads(capsys.readouterr().out)["inserted"] == 5

    conn = db.connect()
    try:
        assert conn.execute("SELECT COUNT(*) FROM stock").fetchone()[0] == 5
        rows = conn.execute("SELECT kind, status, rows, triggered_by, result_json FROM ingest_run").fetchall()
    finally:
        conn.close()
    assert len(rows) == 1
    assert (rows[0]["kind"], rows[0]["status"], rows[0]["rows"], rows[0]["triggered_by"]) == ("import_excel", "ok", 5, "cli")
    assert json.loads(rows[0]["result_json"])["inserted"] == 5


def test_cli_import_failure_is_recorded(tmp_config, tmp_path, capsys):
    """Import ulang file yang sama → prasyarat terpenuhi: run `skipped`, exit 1, bukan traceback."""
    xlsx = tmp_path / "kecil.xlsx"
    write_xlsx(xlsx, FIXTURE_SHEETS)

    assert cli.main(["import-excel", str(xlsx)]) == 0
    capsys.readouterr()
    assert cli.main(["import-excel", str(xlsx)]) == 1
    assert "already_imported" in capsys.readouterr().err

    conn = db.connect()
    try:
        rows = conn.execute("SELECT status, message FROM ingest_run ORDER BY id").fetchall()
    finally:
        conn.close()
    assert [r["status"] for r in rows] == ["ok", "skipped"]  # bukan `failed` (docs/05 §4.3)
    assert rows[1]["message"] == "file sudah pernah diimport (import_id=1)"
