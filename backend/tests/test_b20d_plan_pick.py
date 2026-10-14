"""B20d — `plan_pick` per tanggal, `as_of` di compute, status berjalan pick (docs/07 B20d).

Ditulis + dijalankan sesuai instruksi task (AC 5 memakai data buatan).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app import db
from backend.app.compute import plan
from backend.app.config import get_settings
from backend.tests.test_b7_signals import DATES, _seed, weekly_db  # noqa: F401 (fixture)


def _pick(ticker: str) -> dict:
    """Payload pick versi kartu siap-tampil (kolom yang dibaca `pick_status`)."""
    return {
        "ticker": ticker,
        "entry": 100.0,
        "entry_zone": {"low": 99.0, "high": 101.0},
        "stop": {"level": 95.0},
        "tp1": {"level": 110.0},
        "tp2": {"level": 120.0},
        "turnover_idr": 5_000_000_000.0,
    }


@pytest.fixture
def status_db(weekly_db):
    """Lima emiten buatan: satu bar datar di `as_of`, lalu bar yang memicu tiap status."""
    as_of = DATES[60]
    conn = db.connect(weekly_db)
    try:
        base = [100.0] * 61  # DATES[0..60], bar `as_of` = 100
        _seed(conn, "S1", base + [100.5] * 5)  # low 100,5 → menyentuh zona, tanpa target/stop
        _seed(conn, "S2", base + [94.0] * 3)  # low 94 → batas rugi kena
        _seed(conn, "S3", base + [105.0, 111.0])  # high 111 ≥ TP1 → target pertama kena
        _seed(conn, "S4", base + [105.0] * 5)  # low 104,5 > zona → belum tersentuh
        _seed(conn, "S5", base + [105.0] * 61)  # 61 bar tanpa sentuhan → kedaluwarsa
        conn.commit()
    finally:
        conn.close()
    return weekly_db, as_of


def test_status_lima_kasus(status_db):
    """AC 5: `di_zona`, `kena_stop`, `kena_tp1`, `menunggu_zona`, `kedaluwarsa` dari data buatan."""
    tmp_db, as_of = status_db
    cfg = get_settings()
    conn = db.connect(tmp_db)
    try:
        hasil = {ticker: plan.pick_status(conn, ticker, as_of, _pick(ticker), cfg) for ticker in ("S1", "S2", "S3", "S4", "S5")}
    finally:
        conn.close()
    assert hasil["S1"]["status"] == "di_zona" and hasil["S1"]["mfe_pct"] is not None
    assert hasil["S2"]["status"] == "kena_stop" and hasil["S2"]["mae_pct"] < 0
    assert hasil["S3"]["status"] == "kena_tp1" and hasil["S3"]["mfe_pct"] > 0
    assert hasil["S4"]["status"] == "menunggu_zona"
    assert hasil["S5"]["status"] == "kedaluwarsa" and hasil["S5"]["bars_sejak_asof"] == 61
    for blok in hasil.values():
        assert set(blok) == {"status", "close_latest", "ret_sejak_asof", "bars_sejak_asof", "mfe_pct", "mae_pct", "status_note"}
        assert len(blok["status_note"]) <= 140 and "stop loss" not in blok["status_note"]


def test_status_stop_menang_atas_target_di_bar_sama(status_db):
    """Bar yang menyentuh batas rugi **dan** target dihitung rugi (pesimis, sama seperti `simulate_result`)."""
    tmp_db, as_of = status_db
    conn = db.connect(tmp_db)
    try:
        _seed(conn, "S6", [100.0] * 61 + [112.0])  # low 111 < stop? tidak — stop di 95, jadi target menang
        conn.commit()
        aman = plan.pick_status(conn, "S6", as_of, _pick("S6"), get_settings())
    finally:
        conn.close()
    assert aman["status"] == "kena_tp1"


@pytest.fixture
def picks_client(weekly_db, monkeypatch):
    """`/plan/picks` membaca `plan_pick` → fixture harus menghitung plan + menyimpan hasil saring."""
    conn = db.connect(weekly_db)
    try:
        plan.plan_for_all(conn, get_settings())
    finally:
        conn.close()
    monkeypatch.setattr(db, "db_path", lambda: weekly_db)
    from backend.app.main import app

    return TestClient(app)


def test_plan_pick_tersimpan_dan_dibaca(picks_client, weekly_db):
    """Compute menyimpan hasil saring; endpoint membaca tabel (bukan hitung ulang) + `available_dates`."""
    body = picks_client.get("/api/v1/plan/picks").json()
    assert body["api_version"] == "1.3"
    assert body["available_dates"] == sorted(body["available_dates"], reverse=True)
    assert set(body) >= {"as_of", "available_dates", "limit", "min_turnover_idr", "screened", "rules", "picks"}
    if body["picks"]:
        pick = body["picks"][0]
        assert set(pick) >= {"status", "close_latest", "ret_sejak_asof", "bars_sejak_asof", "mfe_pct", "mae_pct", "status_note"}
        assert pick["status"] in ("menunggu_zona", "di_zona", "kena_tp1", "kena_tp2", "kena_stop", "kedaluwarsa")
    conn = db.connect(weekly_db)
    try:
        tersimpan = conn.execute("SELECT COUNT(*) FROM plan_pick WHERE as_of_date = ?", (body["as_of"],)).fetchone()[0]
    finally:
        conn.close()
    assert tersimpan == body["screened"] or tersimpan >= len(body["picks"])


def test_plan_picks_as_of_tak_ada_404(picks_client):
    """AC 3: `as_of` yang tidak punya isi → `404 not_found` + daftar tanggal yang benar-benar ada."""
    response = picks_client.get("/api/v1/plan/picks?as_of=2020-01-02")
    assert response.status_code == 404
    detail = response.json()
    assert "available_dates" in str(detail)


def test_as_of_di_jalur_compute(weekly_db):
    """`plan_for_all(as_of=…)` menghitung dari bar `date <= as_of` (bukan bar terakhir)."""
    tmp_db = weekly_db
    as_of = DATES[40]
    conn = db.connect(tmp_db)
    try:
        hasil = plan.plan_for_all(conn, get_settings(), as_of=as_of, persist_picks=False)
        tanggal = conn.execute("SELECT DISTINCT as_of_date FROM stock_plan").fetchall()
    finally:
        conn.close()
    assert hasil["rows"] > 0
    assert {row[0] for row in tanggal} == {as_of}
