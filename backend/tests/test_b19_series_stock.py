"""B19 — `GET /series/stock/{ticker}`: candle + overlay TA, satu sumber dengan `/plan/stock`.

Ditulis lebih dulu (belum dijalankan — lihat ADR-054).
"""

from __future__ import annotations

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app import db
from backend.app.compute import plan
from backend.app.config import get_settings
from backend.tests.test_b7_signals import DATES, _seed, weekly_db  # noqa: F401 (fixture)

TICKER = "AAAA"


@pytest.fixture
def series_db(weekly_db):
    """`weekly_db` + baris `stock_plan` (mesin yang sama dengan pick mingguan)."""
    conn = db.connect(weekly_db)
    try:
        plan.plan_for_all(conn, get_settings())
    finally:
        conn.close()
    return weekly_db


@pytest.fixture
def client(series_db, monkeypatch):
    monkeypatch.setattr(db, "db_path", lambda: series_db)
    from backend.app.main import app

    return TestClient(app)


def test_candle_overlay_dan_lapisan(client):
    """`candles` urut lama→baru, OHLC penyesuaian, MA tanpa `null`, lapisan `indicators` menyala."""
    body = client.get(f"/api/v1/series/stock/{TICKER}?window=3m&bars=60").json()
    assert body["price_basis"] == "adj_close"
    assert body["ticker"] == TICKER
    assert len(body["candles"]) == 60
    dates = [candle["date"] for candle in body["candles"]]
    assert dates == sorted(dates)
    assert all(candle["open"] is not None and candle["close"] is not None for candle in body["candles"])
    ma20 = body["overlays"]["ma"]["20"]
    assert ma20 and all(point["value"] is not None for point in ma20)
    assert set(body["overlays"]) == {"ma", "donchian", "channels", "volume_ma"}
    assert set(body["overlays"]["donchian"]) == {"fast", "slow"}
    assert body["layers"] == ["indicators"]
    assert set(body["indicators"]) == {"ursi", "vwap", "poc"}
    assert body["smc"] is None and body["elliott"] is None
    assert body["data_status"]["timeframe"] == "d1"


def test_ma_dan_donchian_sama_dengan_hitungan_manual(series_db, client):
    """Uji silang AC 2–3: MA20 & puncak 20 hari dihitung ulang dari `price_daily` (pandas)."""
    conn = db.connect(series_db)
    try:
        rows = pd.read_sql(
            "SELECT date, adj_close AS close, high, low, adj_close / close AS scale FROM price_daily"
            " WHERE ticker = ? ORDER BY date",
            conn,
            params=(TICKER,),
        )
    finally:
        conn.close()
    highs = rows["high"].astype(float) * rows["scale"].astype(float)  # `high` penyesuaian (ADR-040)

    body = client.get(f"/api/v1/series/stock/{TICKER}?window=6m&bars=60").json()
    expected_ma = rows["close"].astype(float).rolling(20).mean().iloc[-1]
    expected_high = highs.rolling(20).max().iloc[-1]
    last = body["candles"][-1]
    assert last["date"] == str(rows["date"].iloc[-1])
    assert last["close"] == pytest.approx(float(rows["close"].iloc[-1]), abs=0.01)
    assert body["overlays"]["ma"]["20"][-1]["date"] == last["date"]
    assert body["overlays"]["ma"]["20"][-1]["value"] == pytest.approx(float(expected_ma), abs=0.05)
    assert body["overlays"]["donchian"]["fast"]["high"][-1]["value"] == pytest.approx(float(expected_high), abs=0.05)


def test_levels_dan_regime_sama_dengan_plan_stock(client):
    """Satu sumber: `levels`/`regime` di grafik = baris `stock_plan` yang dibaca `/plan/stock`."""
    series = client.get(f"/api/v1/series/stock/{TICKER}").json()
    detail = client.get(f"/api/v1/plan/stock/{TICKER}").json()
    assert series["regime"] == detail["regime"]["code"]
    assert series["regime_reason"] == detail["regime"]["reason"]
    assert series["active_tools"] == detail["regime"]["active_tools"]
    if detail["plan"] is None:
        assert series["levels"] is None
    else:
        assert series["levels"]["stop"] == detail["plan"]["stop"]["level"]
        assert series["levels"]["tp1"] == detail["plan"]["tp1"]["level"]
        assert series["levels"]["tp2"] == detail["plan"]["tp2"]["level"]
        assert series["levels"]["plan_ok"] == detail["plan"]["plan_ok"]


def test_lapisan_tidak_mengubah_plan(client):
    """Lapisan §11 tidak boleh mengubah `regime`/`levels`/`plan` (docs/03 §11.6 no. 9)."""
    base = client.get(f"/api/v1/series/stock/{TICKER}?layers=").json()
    full = client.get(f"/api/v1/series/stock/{TICKER}?layers=indicators&layers=smc&layers=elliott").json()
    assert base["layers"] == [] and base["indicators"] is None
    assert full["smc"] is not None and full["elliott"] is not None
    for key in ("regime", "active_tools", "regime_reason", "levels"):
        assert base[key] == full[key]
    assert base["candles"] == full["candles"]
    assert base["overlays"] == full["overlays"]


def test_series_stock_errors(client, series_db):
    """AC 8: ticker tak ada → `404`; `bars`/`events`/lapisan di luar batas → `422`; tanpa bar → `200` kosong."""
    assert client.get("/api/v1/series/stock/ZZZZ").status_code == 404
    assert client.get(f"/api/v1/series/stock/{TICKER}?bars=500").status_code == 422
    assert client.get(f"/api/v1/series/stock/{TICKER}?events=200").status_code == 422
    assert client.get(f"/api/v1/series/stock/{TICKER}?layers=foo").status_code == 422

    conn = db.connect(series_db)
    try:
        sector = conn.execute("SELECT id FROM sector LIMIT 1").fetchone()[0]
        conn.execute(
            "INSERT INTO stock (ticker, yahoo_symbol, sector_id, is_active, updated_at)"
            " VALUES ('NOSH', 'NOSH.JK', ?, 1, ?)",
            (sector, DATES[-1]),
        )
        conn.commit()
    finally:
        conn.close()
    body = client.get("/api/v1/series/stock/NOSH").json()
    assert body["candles"] == [] and body["levels"] is None
