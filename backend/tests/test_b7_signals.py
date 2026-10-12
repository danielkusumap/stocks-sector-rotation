"""B7 — sinyal mingguan: aturan §6.1/§6.2, level harga, streak, minggu final saja."""

from __future__ import annotations

import json
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app import db
from backend.app.compute import index, metrics, rrg, signals
from backend.app.config import get_settings

STAMP = "2026-10-13T00:00:00+07:00"


def _row(**overrides) -> dict:
    base = {
        "ticker": "AAAA",
        "name": "Saham Uji",
        "board": "Utama",
        "sector_code": "IDXFINANCE",
        "close": 1_500.0,
        "ret_5d": 0.02,
        "sma20": 1_400.0,
        "sma50": 1_300.0,
        "rsi14": 60.0,
        "atr14": 40.0,
        "median_turnover_20d_idr": 5_000_000_000,
        "rs_ratio": 105.0,
        "rs_momentum": 101.0,
    }
    base.update(overrides)
    return base


# --- aturan saham §6.2 (fixture 6 saham seperti docs/03 §9) --------------------


def test_weekly_rules_six_fixture_stocks():
    cfg = get_settings()
    week, cutoff = "2026-10-09", "2026-10-05"

    cases = {
        "likuid_naik": _row(),
        "tren_turun": _row(ticker="BBBB", close=1_100.0),  # close < SMA20 → trend gagal
        "tipis": _row(ticker="CCCC", median_turnover_20d_idr=5_000_000),  # < Rp 1 M
        "harga_50": _row(ticker="DDDD", close=50.0, sma20=40.0, sma50=30.0),  # < min_price_idr (100)
        "rsi_80": _row(ticker="EEEE", rsi14=80.0),  # >= max_rsi (75)
        "suspend": _row(ticker="FFFF"),  # tanpa bar di 5 hari terakhir
    }
    results = {
        name: signals.evaluate_stock(
            row,
            close=row["close"],
            last_bar=None if name == "suspend" else "2026-10-09",
            cutoff=cutoff,
            cfg=cfg,
        )
        for name, row in cases.items()
    }

    assert [name for name, r in results.items() if r["ok"]] == ["likuid_naik"]  # hanya saham pertama lolos
    assert results["tren_turun"]["rule_hits"]["trend_ok"] is False
    assert results["tipis"]["rule_hits"]["liquidity_ok"] is False
    assert results["harga_50"]["rule_hits"]["price_ok"] is False
    assert results["rsi_80"]["rule_hits"]["rsi_ok"] is False
    assert results["suspend"]["rule_hits"]["no_suspension"] is False
    assert results["likuid_naik"]["rule_hits"]["rs_ratio"] == 105.0  # nilai ikut dicatat untuk audit


def test_papan_pemantauan_khusus_ikut_dikecualikan():
    cfg = get_settings()
    result = signals.evaluate_stock(
        _row(board="Pemantauan Khusus"), close=1_500.0, last_bar="2026-10-09", cutoff="2026-10-05", cfg=cfg
    )
    assert result["ok"] is False
    assert result["rule_hits"]["board_ok"] is False


def test_levels_stop_target_lots():
    cfg = get_settings()
    stop, target, lots = signals.levels(entry_ref=1_500.0, atr14=40.0, cfg=cfg)

    assert stop == pytest.approx(1_500.0 - 1.5 * 40.0)  # atr_stop_mult 1,5
    assert target == pytest.approx(1_500.0 + 2.0 * 60.0)  # rr_target 2,0
    assert lots == int(2_000_000 // (60.0 * 100))  # risk_per_trade 2 juta
    assert signals.levels(1_500.0, None, cfg) == (None, None, None)


# --- aturan sektor §6.1 -------------------------------------------------------


def test_sector_rules():
    cfg = get_settings()
    ok_row = {
        "code": "IDXFINANCE",
        "sector_id": 1,
        "name_id": "Keuangan",
        "quadrant": "leading",
        "quadrant_prev": "improving",
        "quadrant_age_periods": 3,
        "rs_ratio": 103.0,
        "rs_momentum": 101.5,
        "rs_momentum_change_1p": 0.4,
        "score": 80.0,
        "ret_4w": 0.02,
    }
    assert signals.evaluate_sector(ok_row, constituents=10, cfg=cfg)["ok"] is True

    assert signals.evaluate_sector({**ok_row, "quadrant_age_periods": 1}, 10, cfg)["ok"] is False
    assert signals.evaluate_sector({**ok_row, "rs_momentum_change_1p": -0.2}, 10, cfg)["ok"] is False
    assert signals.evaluate_sector({**ok_row, "ret_4w": -0.01}, 10, cfg)["ok"] is False
    assert signals.evaluate_sector(ok_row, constituents=2, cfg=cfg)["ok"] is False  # < min_constituents
    assert signals.evaluate_sector({**ok_row, "quadrant": "lagging"}, 10, cfg)["ok"] is False


# --- streak (docs/03 §6.3) ----------------------------------------------------


def test_streak_consecutive_and_reset():
    weeks = ["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02"]
    rows = [
        ("2026-09-04", "sector", "IDXFINANCE"),
        ("2026-09-11", "sector", "IDXFINANCE"),  # 2 minggu berurutan
        ("2026-09-25", "sector", "IDXFINANCE"),  # jeda 1 minggu (18 Sep kosong) → reset
        ("2026-09-04", "stock", "AAAA"),
        ("2026-09-11", "stock", "AAAA"),
        ("2026-09-18", "stock", "AAAA"),  # 3 minggu berurutan → 3
    ]
    streaks = signals.compute_streaks(weeks, rows)

    assert streaks[("stock", "AAAA")] == 3
    assert streaks[("sector", "IDXFINANCE")] == 1  # minggu terakhir muncul setelah jeda


def test_gate_final_week_only_after_friday_close():
    cfg = get_settings()
    tz = ZoneInfo("Asia/Jakarta")

    assert signals.gate_final_week(cfg, datetime(2026, 10, 14, 9, 0, tzinfo=tz))["gate"] == "not_final"  # Rabu
    assert signals.gate_final_week(cfg, datetime(2026, 10, 16, 14, 0, tzinfo=tz))["gate"] == "not_final"  # Jumat 14:00
    assert signals.gate_final_week(cfg, datetime(2026, 10, 16, 16, 30, tzinfo=tz))["gate"] == "ok"  # Jumat 16:30
    assert signals.gate_final_week(cfg, datetime(2026, 10, 17, 9, 0, tzinfo=tz))["gate"] == "ok"  # Sabtu


# --- integrasi: 3 saham, 1 sektor, data berakhir tengah minggu ----------------


DATES = pd.bdate_range("2026-01-05", "2026-10-14").strftime("%Y-%m-%d").tolist()  # berakhir Rabu 14 Okt


def _seed(conn, ticker: str, closes: np.ndarray, sector_code: str | None = "IDXFINANCE", volume: int = 2_000_000) -> None:
    if sector_code:
        sector_id = conn.execute("SELECT id FROM sector WHERE code = ?", (sector_code,)).fetchone()[0]
        conn.execute(
            "INSERT INTO stock (ticker, yahoo_symbol, sector_id, shares_outstanding, is_active, updated_at) VALUES (?, ?, ?, 1000000, 1, ?)",
            (ticker, f"{ticker}.JK", sector_id, STAMP),
        )
    for date, close in zip(DATES[: len(closes)], closes):
        conn.execute(
            "INSERT INTO price_daily (ticker, date, open, high, low, close, adj_close, volume, value_idr, source, ingested_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'test', ?)",
            (ticker, date, close, close * 1.01, close * 0.99, close, close, volume, int(close * volume), STAMP),
        )


def _wiggle(rate: float, amplitude: float = 60.0, ramp: float = 0.0) -> np.ndarray:
    """Harga naik dengan laju `rate` (+`ramp` per hari) dan osilasi kecil agar RSI tidak mentok."""
    steps = np.arange(len(DATES))
    growth = 1 + rate + ramp * steps
    return 1_000 * np.cumprod(growth) + amplitude * np.sin(steps / 4)


@pytest.fixture
def weekly_db(tmp_db):
    conn = db.connect(tmp_db)
    try:
        _seed(conn, "IHSG", _wiggle(0.0003, 5.0), sector_code=None, volume=0)
        _seed(conn, "AAAA", _wiggle(0.0035, ramp=0.00002))  # paling kuat & makin cepat
        _seed(conn, "BBBB", _wiggle(0.0008, ramp=0.00001))
        _seed(conn, "CCCC", _wiggle(0.0005))
        conn.commit()
    finally:
        conn.close()

    index.compute_index(db_path=tmp_db, weightings=["equal"])
    rrg.compute_rrg(timeframes=["d1"], weightings=["equal"], db_path=tmp_db)  # sinyal saham butuh RS harian
    rrg.compute_rrg(timeframes=["w1_fri"], weightings=["equal"], scopes=("sector",), db_path=tmp_db)
    metrics.compute_metrics(timeframes=["w1_fri"], weightings=["equal"], db_path=tmp_db)
    metrics.compute_scores(timeframes=["w1_fri"], weightings=["equal"], db_path=tmp_db)
    metrics.compute_metrics(timeframes=["d1"], weightings=["equal"], db_path=tmp_db)
    metrics.compute_scores(timeframes=["d1"], weightings=["equal"], db_path=tmp_db)
    return tmp_db


@pytest.fixture
def signal_inputs(weekly_db):
    """Paksa IDXFINANCE jadi kandidat dan AAAA lolos semua aturan §6.2.

    Harga sintetis tidak pernah menghasilkan RS yang berakselerasi (momentum ≈ 100), jadi input
    aturannya di-seed langsung — yang diuji di sini penyimpanan, peringkat, streak, dan respons.
    """
    conn = db.connect(weekly_db)
    try:
        conn.execute(
            "UPDATE rrg_daily SET quadrant='leading', quadrant_prev='improving', quadrant_age_periods=3,"
            " rs_momentum=101.5, rs_momentum_change_1p=0.4, score=80 WHERE scope='sector'"
            " AND ref_id='IDXFINANCE' AND timeframe='w1_fri'"
        )
        conn.execute(
            "UPDATE sector_metrics SET ret_1m=0.02 WHERE timeframe='w1_fri'"
            " AND sector_id=(SELECT id FROM sector WHERE code='IDXFINANCE')"
        )
        conn.execute(
            "UPDATE stock_metrics SET close=1500, sma20=1400, sma50=1300, rsi14=60, atr14=60, ret_5d=0.02,"
            " median_turnover_20d_idr=5000000000 WHERE ticker='AAAA' AND timeframe='d1'"
        )
        conn.execute("UPDATE rrg_daily SET rs_ratio=105.0 WHERE scope='stock' AND ref_id='AAAA' AND timeframe='d1'")
        conn.commit()
    finally:
        conn.close()
    return weekly_db


def test_compute_signals_only_final_weeks_and_friday_labels(signal_inputs):
    weekly_db = signal_inputs
    info = signals.compute_signals(db_path=weekly_db)

    conn = db.connect(weekly_db)
    try:
        weeks = [r[0] for r in conn.execute("SELECT DISTINCT week_end FROM signal_weekly ORDER BY week_end")]
        sectors = [dict(r) for r in conn.execute("SELECT * FROM signal_weekly WHERE scope = 'sector' ORDER BY week_end DESC LIMIT 1")]
        stocks = [dict(r) for r in conn.execute("SELECT * FROM signal_weekly WHERE scope = 'stock'")]
        total = conn.execute("SELECT COUNT(*) FROM signal_weekly").fetchone()[0]
    finally:
        conn.close()

    assert info["weeks"] > 20  # ± 40 minggu data
    assert all(pd.Timestamp(w).weekday() == 4 for w in weeks)  # week_end selalu Jumat
    assert "2026-10-16" not in weeks  # minggu berjalan (data berakhir Rabu 14 Okt) tidak menghasilkan baris
    assert sectors and sectors[0]["timeframe"] == "w1_fri"
    assert json.loads(sectors[0]["rule_hits"])["quadrant_ok"] is True
    assert sectors[0]["streak_weeks"] >= 1
    assert stocks, "AAAA harus lolos semua aturan §6.2"
    assert {s["ref_id"] for s in stocks} == {"AAAA"}  # BBBB/CCCC tidak memenuhi aturan
    # muncul tiap minggu sejak sektor jadi kandidat → streak = jumlah minggu
    assert max(s["streak_weeks"] for s in stocks) == len(weeks)
    assert stocks[0]["rank"] == 1
    assert stocks[0]["score"] > 0 and sectors[0]["score"] == 80.0
    top = max(stocks, key=lambda s: s["entry_ref"])
    assert top["entry_ref"] > 0 and top["stop"] < top["entry_ref"] < top["target"]
    assert top["lots_hint"] and top["lots_hint"] > 0
    assert "SMA20" in top["rationale"] and "RSI" in top["rationale"]


def test_compute_w1_fri_ditolak_sebelum_penutupan_jumat(monkeypatch, tmp_config):
    """docs/07 B12 AC2: compute `w1_fri` di hari non-Jumat → 409, bukan 200 dengan data kosong."""
    from backend.app.main import app

    monkeypatch.setattr(signals, "gate_final_week", lambda *a, **k: {"gate": "not_final", "weekday": "Tuesday"})
    client = TestClient(app)

    for payload in ({"stage": "signals", "timeframe": "w1_fri"}, {"stage": "rrg", "timeframe": "w1_fri"}):
        response = client.post("/api/v1/admin/compute", json=payload)
        assert response.status_code == 409, payload
        assert response.json()["error"]["code"] == "gate_weekly_not_final"


def test_weekly_picks_endpoint(signal_inputs, monkeypatch):
    weekly_db = signal_inputs
    signals.compute_signals(db_path=weekly_db)
    monkeypatch.setattr(db, "db_path", lambda: weekly_db)
    from backend.app.main import app

    client = TestClient(app)
    body = client.get("/api/v1/weekly/picks").json()

    assert body["api_version"] == "1.0"
    assert body["is_final"] is True
    assert pd.Timestamp(body["week_end"]).weekday() == 4
    assert body["sectors"] and body["stocks"]
    assert set(body["sectors"][0]) >= {"ref_id", "name", "rank", "score", "streak_weeks", "rule_hits", "rationale"}
    assert body["stocks"][0]["rule_hits"]["liquidity_ok"] is True
    assert client.get("/api/v1/weekly/picks?scope=sector&min_streak=1").json()["stocks"] == []
    assert client.get("/api/v1/weekly/picks?min_streak=99").json()["sectors"] == []
