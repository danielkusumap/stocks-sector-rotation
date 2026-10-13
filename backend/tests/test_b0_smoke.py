"""B0 — skeleton, config, db-init."""

from __future__ import annotations

import pytest

import json
import subprocess
import sys

from fastapi.testclient import TestClient

from backend.app import db
from backend.app.config import ROOT, get_settings

# DDL docs/04 — daftar eksplisit, bukan cuma jumlah, supaya skema yang hilang ketahuan.
TABLES = {
    "sector",
    "stock",
    "excel_import",
    "excel_import_error",
    "price_daily",
    "price_intraday",
    "data_freshness",
    "sector_index_daily",
    "rrg_daily",
    "sector_metrics",
    "stock_metrics",
    "signal_weekly",
    "ingest_run",
    "ta_breakout",
    "stock_plan",
}
VIEWS = {"v_sector_latest", "v_stock_latest"}


def _objects(conn, kind):
    return {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type=?", (kind,))}


def test_config_reads_default_yaml():
    s = get_settings()
    assert s.app.api_version == "1.0"
    assert s.app.timezone == "Asia/Jakarta"
    assert s.database.path == "data/rotation.db"
    assert "http://localhost:5173" in s.api.cors_origins
    assert s.universe["min_turnover_idr"] == 1000000000  # section belum di-typed, tetap terbaca


def test_db_init_creates_schema_and_is_idempotent(tmp_path):
    f = tmp_path / "rotation.db"
    first = db.init_db(f)
    second = db.init_db(f)  # AC: dua kali jalan tidak error
    conn = db.connect(f)
    try:
        assert _objects(conn, "table") == TABLES
        assert _objects(conn, "view") == VIEWS
        assert first["tables"] == second["tables"] == len(TABLES)
    finally:
        conn.close()


def test_health_ok_when_db_initialized(tmp_path, monkeypatch):
    f = tmp_path / "rotation.db"
    db.init_db(f)
    monkeypatch.setattr(db, "db_path", lambda: f)

    from backend.app.main import app

    r = TestClient(app).get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["db"] == "ok"
    assert body["tables"] == len(TABLES)
    assert body["api_version"] == "1.0"


@pytest.mark.slow
def test_cli_db_init_runs_twice():
    for _ in range(2):
        r = subprocess.run(
            [sys.executable, "-m", "backend.cli", "db-init"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        assert r.returncode == 0, r.stderr
        assert json.loads(r.stdout)["tables"] == len(TABLES)
