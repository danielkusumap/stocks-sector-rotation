"""B12 (tengah hari) — compute `midday`: return intraday, RRG, metrik, dan `computed:true`."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import pytest

from backend.app import db, jobs
from backend.app.compute import index, midday
from backend.app.config import get_settings
from backend.app.ingest import prices

TODAY = datetime.now(ZoneInfo("Asia/Jakarta")).date().isoformat()
STAMP = f"{TODAY}T00:00:00+07:00"
DATES = pd.bdate_range(end=pd.Timestamp(TODAY) - pd.Timedelta(days=1), periods=80).strftime("%Y-%m-%d").tolist()


def _series(rate: float):
    steps = np.arange(len(DATES))
    return 1_000 * np.cumprod(1 + rate + 0.00001 * steps) + 40 * np.sin(steps / 4)


@pytest.fixture
def midday_db(tmp_db):
    conn = db.connect(tmp_db)
    try:
        sector_id = conn.execute("SELECT id FROM sector WHERE code = 'IDXFINANCE'").fetchone()[0]
        for ticker, series in (("AAAA", _series(0.003)), ("BBBB", _series(0.001)), ("CCCC", _series(0.0005))):
            conn.execute(
                "INSERT INTO stock (ticker, yahoo_symbol, sector_id, shares_outstanding, is_active, updated_at) VALUES (?,?,?,1000000,1,?)",
                (ticker, f"{ticker}.JK", sector_id, STAMP),
            )
            for date, close in zip(DATES, series):
                conn.execute(
                    "INSERT INTO price_daily (ticker,date,open,high,low,close,adj_close,volume,value_idr,source,ingested_at)"
                    " VALUES (?,?,?,?,?,?,?,?,?,'test',?)",
                    (ticker, date, close, close, close, close, close, 1_000_000, int(close * 1_000_000), STAMP),
                )
        # IHSG: seri harian sendiri (benchmark)
        for date, close in zip(DATES, _series(0.0002)):
            conn.execute(
                "INSERT INTO price_daily (ticker,date,open,high,low,close,adj_close,volume,value_idr,source,ingested_at)"
                " VALUES ('IHSG',?,?,?,?,?,?,0,0,'test',?)",
                (date, close, close, close, close, close, STAMP),
            )
        conn.commit()
    finally:
        conn.close()

    index.compute_index(db_path=tmp_db, weightings=["equal"])

    # bar intraday hari ini: AAAA datar, BBBB −1%, CCCC +1%
    conn = db.connect(tmp_db)
    try:
        previous = {r[0]: r[1] for r in conn.execute("SELECT ticker, close FROM price_daily WHERE date = ?", (DATES[-1],))}
        for ticker, change in (("AAAA", 0.0), ("BBBB", -0.01), ("CCCC", 0.01), ("IHSG", 0.002)):
            for clock in ("09:00", "11:35"):
                conn.execute(
                    "INSERT INTO price_intraday (ticker, ts, interval, open, high, low, close, volume, session, ingested_at)"
                    " VALUES (?,?, '5m', ?, ?, ?, ?, 1000, 'regular', ?)",
                    (ticker, f"{TODAY}T{clock}:00+07:00", previous[ticker], previous[ticker], previous[ticker],
                     previous[ticker] * (1 + change), STAMP),
                )
        conn.commit()
    finally:
        conn.close()
    return tmp_db


def test_return_intraday_dan_arah(midday_db):
    conn = db.connect(midday_db)
    try:
        per_stock, per_sector = midday.intraday_returns(conn, TODAY)
        sector_id = conn.execute("SELECT id FROM sector WHERE code = 'IDXFINANCE'").fetchone()[0]
    finally:
        conn.close()

    assert per_stock["BBBB"] == pytest.approx(-0.01)
    assert per_stock["CCCC"] == pytest.approx(0.01)
    assert per_stock["IHSG"] == pytest.approx(0.002)
    assert per_sector[sector_id] == pytest.approx(0.0, abs=1e-9)  # rata-rata (0 −1% +1%)/3
    assert all(abs(v) > 0.0015 for k, v in per_stock.items() if k != "AAAA")

    cfg = get_settings()
    flat = cfg.midday["move_flat_pct"]
    assert midday.direction(0.0, flat) == "datar"
    assert midday.direction(0.004, flat) == "naik"
    assert midday.direction(-0.004, flat) == "turun"
    assert midday.direction(None, flat) is None


def test_compute_midday_menulis_rrg_dan_metrik(midday_db, monkeypatch):
    monkeypatch.setattr(db, "db_path", lambda: midday_db)
    result = midday.compute_midday(db_path=midday_db)

    assert result["as_of"] == TODAY and result["sectors"] >= 1
    conn = db.connect(midday_db)
    try:
        rrg_rows = [dict(r) for r in conn.execute(
            "SELECT * FROM rrg_daily WHERE timeframe = 'midday' AND scope = 'sector' AND as_of_date = ?", (TODAY,)
        )]
        metric = dict(
            conn.execute(
                "SELECT * FROM sector_metrics WHERE timeframe = 'midday' AND as_of_date = ?", (TODAY,)
            ).fetchone()
        )
    finally:
        conn.close()

    assert rrg_rows and rrg_rows[0]["bench_ref"] == "IHSG"
    assert rrg_rows[0]["quadrant"] in ("leading", "weakening", "lagging", "improving")
    assert metric["ret_intraday"] == pytest.approx(0.0, abs=1e-9)
    assert metric["intraday_move"] == "datar"  # ambang config, bukan nol keras
    assert metric["projected_quadrant"] == rrg_rows[0]["quadrant"]
    assert metric["rrg_rs_ratio"] == pytest.approx(rrg_rows[0]["rs_ratio"])


def test_briefing_midday_terisi_setelah_compute(midday_db, monkeypatch):
    """Setelah compute, blok `midday` briefing ikut terisi (rantai tombol 6 → halaman)."""
    from fastapi.testclient import TestClient

    monkeypatch.setattr(db, "db_path", lambda: midday_db)
    midday.compute_midday(db_path=midday_db)
    from backend.app.main import app

    body = TestClient(app).get("/api/v1/briefing/morning").json()
    assert body["midday"]["available"] is True
    assert body["midday"]["as_of"] == TODAY
    moves = [m for m in body["midday"]["moves"] if m["code"] == "IDXFINANCE"]
    assert moves and moves[0]["direction"] == "datar" and moves[0]["projected_quadrant"]


def test_jobs_midday_computed_true_saat_gate_lolos(midday_db, monkeypatch):
    """Gate lolos → `computed:true` dan baris `midday` tertulis (docs/05 §4.1 tombol 6)."""
    monkeypatch.setattr(db, "db_path", lambda: midday_db)
    cfg = get_settings()
    monkeypatch.setattr(cfg, "freshness_probe_tickers", ["AAAA.JK"], raising=False)
    monkeypatch.setattr(prices, "ingest_intraday", lambda **k: {"rows": 0, "intervals": ["5m", "60m"]})

    def fake_fetch(symbols, *args, **kwargs):
        """Tiruan `yf.download(interval='5m')`: satu bar hari ini jam 11:35 WIB dengan volume."""
        index = pd.DatetimeIndex([pd.Timestamp(f"{TODAY} 11:35", tz="Asia/Jakarta")])
        return pd.DataFrame({("AAAA.JK", "Close"): [100.5], ("AAAA.JK", "Volume"): [1_000]}, index=index)

    monkeypatch.setattr(prices, "fetch", fake_fetch)

    result = jobs.midday({}, lambda **k: None)
    assert result["gate"] == "ok", result
    assert result["last_bar_at"] == f"{TODAY}T11:35:00+07:00"
    assert result["computed"] is True
    assert result["sectors"] >= 1 and result["as_of"] == TODAY
