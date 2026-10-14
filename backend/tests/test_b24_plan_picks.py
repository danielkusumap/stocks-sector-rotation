"""B24 — `GET /plan/picks`: picks terkurasi + blok validitas (docs/05 §2, aturan 14 Okt 2026)."""

from __future__ import annotations

import json

import pytest

from backend.app import db
from backend.app.compute import plan
from backend.app.config import get_settings

AS_OF = "2026-10-13"
CFG = get_settings()
WAKTU = "2026-10-14T00:00:00+07:00"


def _sector(conn, code="IDXAAA", sector_id=901):
    conn.execute(
        "INSERT OR REPLACE INTO sector (id, code, name_id, name_en, color_hex, sort_order, is_active)"
        " VALUES (?,?,?,?,?,?,1)",
        (sector_id, code, code, code, "#111111", 1),
    )


def _stock(conn, ticker, sector_id):
    conn.execute(
        "INSERT OR REPLACE INTO stock (ticker, name, yahoo_symbol, sector_id, is_active, updated_at) VALUES (?,?,?,?,1,?)",
        (ticker, ticker, f"{ticker}.JK", sector_id, WAKTU),
    )


def _metrics(conn, ticker, close, atr, turnover=5e9):
    conn.execute(
        "INSERT OR REPLACE INTO stock_metrics"
        " (ticker, as_of_date, timeframe, close, atr14, rsi14, median_turnover_20d_idr, computed_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (ticker, AS_OF, "d1", close, atr, 55.0, turnover, WAKTU),
    )


def _plan_row(conn, ticker, zona=(96.5, 98.0), regime="range", plan_ok=0):
    body = {
        "entry_zone": {"low": zona[0], "high": zona[1], "reason": "uji"},
        "stop": {"level": 91.4, "pct": -0.06, "basis": "uji", "reason": "uji"},
        "tp1": {"level": 105.0, "pct": 0.08, "rr": 1.4, "basis": "uji", "reason": "uji"},
        "tp2": {"level": 115.0, "pct": 0.18, "rr": 3.2, "basis": "uji", "reason": "uji"},
        "notes": [],
    }
    conn.execute(
        "INSERT OR REPLACE INTO stock_plan (as_of_date, ticker, regime, entry_mode, plan_ok, plan_json, computed_at)"
        " VALUES (?,?,?,?,?,?,?)",
        (AS_OF, ticker, regime, "pullback", plan_ok, json.dumps(body), WAKTU),
    )


def _gate(conn, code="IDXAAA"):
    """2 dari 3 bobot `leading` → gerbang sektor lolos."""
    for weighting, quadrant in (("equal", "leading"), ("turnover", "leading"), ("captier", "weakening")):
        conn.execute(
            "INSERT OR REPLACE INTO rrg_daily (as_of_date, scope, ref_id, timeframe, weighting, rs_ratio,"
            " rs_momentum, quadrant, quadrant_age_periods, bench_ref, computed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (AS_OF, "sector", code, "w1_fri", weighting, 101.0, 101.0, quadrant, 3, "IHSG", WAKTU),
        )


@pytest.fixture
def picks_db(tmp_db):
    conn = db.connect(tmp_db)
    try:
        _sector(conn)
        for ticker in ("AAAA", "BBBB", "CCCC", "DDDD", "EEEE"):
            _stock(conn, ticker, 901)
        _gate(conn)
        _metrics(conn, "AAAA", close=100.0, atr=3.0)  # lolos semua aturan
        _plan_row(conn, "AAAA")
        _metrics(conn, "BBBB", close=100.0, atr=9.0)  # ATR 9% → ditolak
        _plan_row(conn, "BBBB")
        _metrics(conn, "CCCC", close=100.0, atr=3.0, turnover=1e9)  # likuiditas kurang
        _plan_row(conn, "CCCC")
        _metrics(conn, "DDDD", close=100.0, atr=3.0)  # zona 5 ATR di bawah harga → ditolak
        _plan_row(conn, "DDDD", zona=(80.0, 85.0))
        _metrics(conn, "EEEE", close=100.0, atr=3.0)  # lolos semua aturan (pasangan AAAA)
        _plan_row(conn, "EEEE", regime="tren_naik")
        conn.commit()
    finally:
        conn.close()
    return tmp_db


def _screen(path, **kwargs):
    conn = db.connect(path)
    try:
        return plan.screen_picks(conn, CFG, **kwargs)
    finally:
        conn.close()


def test_label_zona_ambang_sentuh():
    """Harga 0,1 ATR di atas zona = `di_zona` (menempel), bukan `mendekati` (temuan 14 Okt 2026)."""
    assert plan._zone_status(101.0, 100.0, 10.0, CFG) == "di_zona"
    assert plan._zone_status(103.0, 100.0, 10.0, CFG) == "mendekati"
    assert plan._zone_status(125.0, 100.0, 10.0, CFG) == "jauh"
    assert plan._zone_status(140.0, 100.0, 10.0, CFG) == "sangat_jauh"


def test_saring_hanya_yang_lolos_aturan(picks_db):
    res = _screen(picks_db)
    assert {pick["ticker"] for pick in res["picks"]} == {"AAAA", "EEEE"}  # BBBB/CCCC/DDDD tersaring
    assert res["screened"] == 2
    assert res["min_turnover_idr"] == CFG.weekly["plan"]["min_turnover_idr"]
    assert res["as_of"] == AS_OF and res["rules"]


def test_pick_memuat_blok_validitas_dan_target_cepat(picks_db):
    pick = _screen(picks_db)["picks"][0]
    assert set(pick["validity"]) == {"valid_until", "valid_if", "invalidate_below", "expires_if", "done_if"}
    assert pick["validity"]["invalidate_below"] == 96.5
    assert pick["zone_status"] == "mendekati"
    assert pick["stop"]["level"] == 91.4
    assert pick["tp0"]["level"] == pytest.approx(pick["entry"] + CFG.weekly["plan"]["tp1_fallback_atr"] * 3.0)
    assert pick["sector_pass"] == 2 and pick["tp1_artefak"] is False


def test_limit_dipotong_screened_tetap(picks_db):
    res = _screen(picks_db, limit=1)
    assert len(res["picks"]) == 1 and res["screened"] == 2 and res["limit"] == 1


def test_min_turnover_bisa_di_override(picks_db):
    """Ambang likuiditas longgar → nama tipis (CCCC) ikut masuk; default tetap Rp2 M."""
    assert "CCCC" not in {pick["ticker"] for pick in _screen(picks_db)["picks"]}
    longgar = _screen(picks_db, min_turnover=1e6)
    assert "CCCC" in {pick["ticker"] for pick in longgar["picks"]}
    assert longgar["min_turnover_idr"] == 1e6
