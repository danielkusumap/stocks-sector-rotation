"""B20 — `stock_plan` untuk semua emiten + `/plan/stock/{ticker}` (docs/03 §6.5, §10.9)."""

from __future__ import annotations

import json

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app import db
from backend.app.compute import plan, signals
from backend.app.config import get_settings
from backend.tests.test_b18_plan import RAW_TERMS, _cfg_with, make_bars, metrics
from backend.tests.test_b7_signals import DATES, _seed, _wiggle, signal_inputs, weekly_db  # noqa: F401 (fixture)


def _events(entry_dates: list[str], entry_price: float = 100.0) -> list[dict]:
    """Event `ta_breakout` versi uji (kolom yang dibaca `scenario`) — satu per tanggal."""
    return [{"entry_date": date, "entry_price": entry_price, "result": "win"} for date in entry_dates]


def _ramp_bars(start: float = 100.0, step: float = 0.5, count: int = 70) -> pd.DataFrame:
    return make_bars([start + step * index for index in range(count)])


# --- §10.9 `first_touch` (urutan, bukan MFE) ---------------------------------


def test_first_touch_urutan():
    """Bar 3 menyentuh target lalu bar 5 menyentuh batas rugi → yang lebih dulu = target, periode 3."""
    closes = [100.0, 100.0, 100.0, 106.0, 103.0, 94.0, 95.0]
    bars = make_bars(closes)
    touch, periods = plan.first_touch(bars, bars["date"].iloc[0], 0.05, 0.05, 60, entry_price=100.0)
    assert (touch, periods) == ("up", 3)
    touch, periods = plan.first_touch(bars, bars["date"].iloc[0], 0.20, 0.05, 60, entry_price=100.0)
    assert (touch, periods) == ("down", 5)


def test_first_touch_timeout_dan_open():
    """Bar habis tanpa sentuhan → `timeout`; data belum cukup → `open` (bukan tebakan)."""
    bars = make_bars([100.0] * 12)
    assert plan.first_touch(bars, bars["date"].iloc[0], 0.05, 0.05, 5) == ("timeout", 5)
    assert plan.first_touch(bars, "2099-01-01", 0.05, 0.05, 5) == ("open", None)


# --- §6.5.2 skenario & §6.5.1 ringkasan --------------------------------------


def test_scenario_first_touch_bukan_mfe(tmp_path, monkeypatch):
    """Target kena di bar 3 lalu batas rugi di bar 5 → `p_tp1_first = 1,0` (MFE akan menyesatkan)."""
    cfg = _cfg_with(tmp_path, monkeypatch, plan_overrides={"min_events_scenario": 1})
    bars = make_bars([100.0, 100.0, 100.0, 106.0, 103.0, 94.0, 96.0])
    events = _events([bars["date"].iloc[0]])
    stats = plan.scenario(events, bars, {"tp1_pct": 0.05, "tp2_pct": 0.2, "stop_pct": 0.05}, cfg)
    assert stats["p_tp1_first"] == 1.0 and stats["p_sl_first"] == 0.0 and stats["p_tp2_first"] == 0.0
    assert stats["median_periods_tp1"] == 3 and stats["n_events"] == 1
    get_settings.cache_clear()


def test_scenario_null_kalau_sampel_kecil(tmp_config):
    """`n_events < min_events_scenario` → seluruh `scenario` `None` + ringkasan memuat alasannya."""
    cfg = get_settings()
    bars = _ramp_bars()
    events = _events([bars["date"].iloc[10], bars["date"].iloc[30]])
    assert plan.scenario(events, bars, {"tp1_pct": 0.05, "tp2_pct": 0.1, "stop_pct": 0.05}, cfg) is None
    lines = plan.summary_lines(bars, metrics(130.0, sma20=125.0, sma50=120.0), "tren_naik", None, None, cfg)
    assert any("Belum cukup riwayat" in line for line in lines)


def test_summary_urut_dan_pendek(tmp_config):
    """Maksimum 3 kalimat, tiap kalimat ≤ 140 char, tanpa istilah mentah (docs/03 §6.5.1)."""
    cfg = get_settings()
    bars = make_bars([100.0] * 60, lows=[80.0] * 60)
    built = plan.plan_levels(bars, metrics(100.0, sma20=100.0, sma50=95.0, atr=4.0), "tren_naik", {"n_events": 9}, cfg)
    stats = {
        "n_events": 29, "p_tp1_first": 0.62, "p_sl_first": 0.24, "p_timeout": 0.14, "p_tp2_first": 0.34,
        "median_periods_tp1": 7, "median_periods_sl": 4, "n_open_dikeluarkan": 1,
    }
    lines = plan.summary_lines(bars, {"sma20": 100.0, "sma50": 95.0}, "tren_naik", built, stats, cfg)
    assert 1 <= len(lines) <= 3 and all(len(line) <= 140 for line in lines)
    assert lines[0].startswith("Harga ") and "penembusan sebelumnya" in lines[2]
    for term in RAW_TERMS:
        assert all(term not in line for line in lines)


# --- §6.5.3/§6.5.4 semua emiten, idempoten, satu mesin -----------------------


def test_plan_semua_emiten(weekly_db):
    """Fixture 5 emiten (termasuk riwayat pendek) → semua punya baris `stock_plan`."""
    conn = db.connect(weekly_db)
    try:
        _seed(conn, "PEND", _wiggle(0.001)[:30], volume=2_000_000)  # riwayat pendek (< `ta.min_history`)
        plan.plan_for_all(conn, get_settings())
        rows = [dict(row) for row in conn.execute("SELECT * FROM stock_plan")]
    finally:
        conn.close()
    by_ticker = {row["ticker"]: row for row in rows}
    assert {"AAAA", "BBBB", "CCCC", "PEND"} <= set(by_ticker)
    assert by_ticker["PEND"]["regime"] == "tidak_cukup_data" and by_ticker["PEND"]["stop"] is None
    assert all(by_ticker[ticker]["plan_json"] for ticker in ("AAAA", "BBBB", "CCCC"))
    assert all(row["computed_at"] for row in rows)


def test_plan_idempoten_semua_emiten(weekly_db):
    """`stage=ta` 2× → jumlah baris untuk `as_of_date` terakhir sama (upsert, bukan duplikat)."""
    conn = db.connect(weekly_db)
    try:
        plan.plan_for_all(conn, get_settings())
        first = conn.execute("SELECT COUNT(*) FROM stock_plan").fetchone()[0]
        before = [dict(row) for row in conn.execute("SELECT ticker, stop, tp2, plan_ok FROM stock_plan ORDER BY ticker")]
        plan.plan_for_all(conn, get_settings())
        after = [dict(row) for row in conn.execute("SELECT ticker, stop, tp2, plan_ok FROM stock_plan ORDER BY ticker")]
    finally:
        conn.close()
    assert len(after) == first == len(before)
    assert [row["stop"] for row in before] == [row["stop"] for row in after]


def test_stock_plan_sama_dengan_signal_weekly(signal_inputs):
    """Satu mesin: level & rezim di `stock_plan` = di `signal_weekly` untuk pekan yang sama."""
    tmp_db = signal_inputs
    signals.compute_signals(db_path=tmp_db)
    conn = db.connect(tmp_db)
    try:
        week = conn.execute(
            "SELECT MAX(week_end) FROM signal_weekly WHERE scope = 'stock' AND plan_json IS NOT NULL"
        ).fetchone()[0]
        conn.execute("DELETE FROM price_daily WHERE ticker != 'IHSG' AND date > ?", (week,))  # bar terakhir emiten = week_end
        conn.commit()
        plan.plan_for_all(conn, get_settings(), as_of=week)  # B20e: cutoff eksplisit = pekan yang dibandingkan
        picks = [dict(row) for row in conn.execute(
            "SELECT ref_id, regime, stop, tp1, tp2 FROM signal_weekly"
            " WHERE scope = 'stock' AND week_end = ? AND plan_json IS NOT NULL",
            (week,),
        )]
        plans = {row["ticker"]: dict(row) for row in conn.execute("SELECT * FROM stock_plan WHERE as_of_date = ?", (week,))}
    finally:
        conn.close()
    assert picks, "fixture harus menyisakan minimal satu pick berplan"
    for pick in picks:
        stored = plans[pick["ref_id"]]
        assert stored["regime"] == pick["regime"]
        assert stored["stop"] == pytest.approx(pick["stop"])
        assert stored["tp1"] == pytest.approx(pick["tp1"])
        assert stored["tp2"] == pytest.approx(pick["tp2"])


# --- endpoint `/plan/stock/{ticker}` ----------------------------------------


@pytest.fixture
def plan_client(weekly_db, monkeypatch):
    conn = db.connect(weekly_db)
    try:
        plan.plan_for_all(conn, get_settings())
    finally:
        conn.close()
    monkeypatch.setattr(db, "db_path", lambda: weekly_db)
    from backend.app.main import app

    return TestClient(app)


def test_plan_stock_endpoint(plan_client):
    """AC 7: kunci lengkap sesuai `docs/05` §2, `summary_lines` 1–3 kalimat, `levels_table` urut tetap."""
    body = plan_client.get("/api/v1/plan/stock/AAAA").json()
    assert set(body) >= {
        "api_version", "as_of", "stock", "price", "regime", "summary_lines",
        "plan", "scenario", "levels_table", "coverage", "data_status",
    }
    assert body["stock"]["ticker"] == "AAAA"
    assert body["price"]["price_basis"] == "adj_close"
    assert set(body["regime"]) == {"code", "label", "reason", "active_tools"}
    assert 1 <= len(body["summary_lines"]) <= 3
    labels = [row["label"] for row in body["levels_table"]]
    assert labels[:4] == ["Zona beli", "Batas rugi", "Target 1", "Target 2"]
    assert body["coverage"]["price_basis"] == "adj_close"
    assert plan_client.get("/api/v1/plan/stock/ZZZZ").status_code == 404
