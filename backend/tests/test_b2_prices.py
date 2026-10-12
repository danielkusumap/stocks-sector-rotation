"""B2 — ingest harga harian: upsert, `value_idr`, benchmark IHSG, `failed_tickers`, prasyarat.

Yahoo tidak dipanggil: `yfinance.download`/`Ticker` diganti data palsu (deterministik, tanpa jaringan).
"""

from __future__ import annotations

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app import db, jobs
from backend.app.config import get_settings
from backend.app.ingest import excel, prices
from backend.tests.fixtures import FIXTURE_SHEETS, write_xlsx

DATES = ["2026-10-08", "2026-10-09", "2026-10-12"]
BARS = {  # close, volume per tanggal
    "BBCA": [(100.0, 1_000), (101.0, 2_000), (102.0, 3_000)],
    "BBRI": [(200.0, 10_000), (205.0, 20_000), (210.0, 30_000)],
    "^JKSE": [(6_000.0, 0), (6_010.0, 0), (6_020.0, 0)],
}
FIELDS = ["Open", "High", "Low", "Close", "Adj Close", "Volume"]


def _frame(symbols: list[str]) -> pd.DataFrame:
    """Tiruan keluaran `yf.download(group_by='ticker')` untuk simbol yang dikenal saja."""
    known = [s for s in symbols if s.removesuffix(".JK") in BARS]
    if not known:
        return pd.DataFrame()
    idx = pd.DatetimeIndex([pd.Timestamp(f"{d} 09:00", tz="Asia/Jakarta") for d in DATES])
    data = {}
    for sym in known:
        rows = [
            {"Open": c - 1, "High": c + 1, "Low": c - 2, "Close": c, "Adj Close": c, "Volume": v}
            for c, v in BARS[sym.removesuffix(".JK")]
        ]
        data.update({(sym, f): [r[f] for r in rows] for f in FIELDS})
    return pd.DataFrame(data, index=idx).sort_index(axis=1)


def _patch_download(monkeypatch, fn=None):
    monkeypatch.setattr(prices.yf, "download", fn or (lambda symbols, **kw: _frame(symbols)))
    monkeypatch.setitem(get_settings().ingest, "sleep_seconds", 0)
    monkeypatch.setitem(get_settings().ingest, "backoff_seconds", 0)


@pytest.fixture
def db_with_universe(tmp_db):
    data = write_xlsx(tmp_db.parent / "kecil.xlsx", FIXTURE_SHEETS)
    excel.import_excel(data, "kecil.xlsx", db_path=tmp_db)
    return tmp_db


def test_ingest_daily_upsert_value_idr_and_benchmark(db_with_universe, monkeypatch):
    _patch_download(monkeypatch)
    r = prices.ingest_daily(
        tickers=["BBCA", "BBRI"], from_date=DATES[0], to_date=DATES[-1], db_path=db_with_universe
    )

    assert r["failed_tickers"] == []
    assert r["tickers_ok"] == 3  # BBCA, BBRI, + IHSG
    assert r["rows"] == 9  # 3 simbol × 3 bar
    assert r["from"] == DATES[0] and r["to"] == DATES[-1]

    conn = db.connect(db_with_universe)
    try:
        assert conn.execute("SELECT COUNT(*) FROM price_daily").fetchone()[0] == 9
        assert conn.execute("SELECT COUNT(*) FROM price_daily WHERE ticker = 'IHSG'").fetchone()[0] == 3
        assert conn.execute("SELECT COUNT(*) FROM price_daily WHERE ticker = '^JKSE'").fetchone()[0] == 0

        close, volume, value = conn.execute(
            "SELECT close, volume, value_idr FROM price_daily WHERE ticker = 'BBCA' ORDER BY date DESC LIMIT 1"
        ).fetchone()
        assert (close, volume, value) == (102.0, 3_000, 306_000)  # value_idr = close × volume

        shares, cap, last = conn.execute(
            "SELECT shares_outstanding, market_cap_idr, last_bar_date FROM stock WHERE ticker = 'BBCA'"
        ).fetchone()
        assert cap == int(shares * 102.0)
        assert last == DATES[-1]

        # ingest ulang rentang yang sama → baris tidak bertambah
        r2 = prices.ingest_daily(
            tickers=["BBCA", "BBRI"], from_date=DATES[0], to_date=DATES[-1], db_path=db_with_universe
        )
        assert r2["rows"] == 9
        assert conn.execute("SELECT COUNT(*) FROM price_daily").fetchone()[0] == 9
    finally:
        conn.close()


def test_failed_ticker_recorded_and_run_partial(db_with_universe, monkeypatch):
    _patch_download(monkeypatch)
    monkeypatch.setattr(db, "db_path", lambda: db_with_universe)

    _, result = jobs.execute(
        "prices_daily",
        {"mode": "daily"},
        lambda p, report: prices.ingest_daily(
            tickers=["BBCA", "ZZZZ"], from_date=DATES[0], to_date=DATES[-1], report=report
        ),
        triggered_by="api",
    )
    assert result["failed_tickers"] == ["ZZZZ"]
    assert result["tickers_ok"] == 2  # BBCA + IHSG

    conn = db.connect(db_with_universe)
    try:
        row = conn.execute("SELECT status, rows, result_json FROM ingest_run").fetchone()
        assert conn.execute("SELECT COUNT(*) FROM price_daily WHERE ticker = 'ZZZZ'").fetchone()[0] == 0
    finally:
        conn.close()
    assert row["status"] == "partial"  # ada emiten gagal → bukan 'ok'
    assert row["rows"] == 6
    assert '"ZZZZ"' in row["result_json"]


def test_fetch_retries_then_succeeds_and_then_gives_up(monkeypatch):
    calls = []

    def boom(symbols, **kw):
        calls.append(symbols)
        raise RuntimeError("429 too many requests")

    monkeypatch.setattr(prices.yf, "download", boom)
    assert prices.fetch(["BBCA.JK"], "2026-10-08", "2026-10-13", retries=3, backoff=0) is None
    assert len(calls) == 3  # dicoba 3× lalu menyerah (tidak melempar ke pemanggil, data lama dibiarkan)

    flaky = {"n": 0}

    def flaky_then_ok(symbols, **kw):
        flaky["n"] += 1
        if flaky["n"] == 1:
            raise RuntimeError("sementara")
        return _frame(symbols)

    monkeypatch.setattr(prices.yf, "download", flaky_then_ok)
    assert prices.fetch(["BBCA.JK"], "2026-10-08", "2026-10-13", retries=3, backoff=0) is not None
    assert flaky["n"] == 2  # percobaan 1 gagal, percobaan 2 berhasil


def test_refresh_info_is_opt_in_and_throttled(db_with_universe, monkeypatch):
    _patch_download(monkeypatch)

    class FakeTicker:
        calls = 0

        def __init__(self, symbol):
            self.symbol = symbol

        @property
        def info(self):
            FakeTicker.calls += 1
            return {"sector": "Financial Services"}

    monkeypatch.setattr(prices.yf, "Ticker", FakeTicker)

    prices.ingest_daily(tickers=["BBCA"], from_date=DATES[0], to_date=DATES[-1], db_path=db_with_universe)
    conn = db.connect(db_with_universe)
    try:
        assert conn.execute("SELECT yahoo_sector FROM stock WHERE ticker = 'BBCA'").fetchone()[0] is None
    finally:
        conn.close()
    assert FakeTicker.calls == 0  # default: `.info` tidak dipanggil sama sekali

    prices.ingest_daily(
        tickers=["BBCA"], from_date=DATES[0], to_date=DATES[-1], refresh_info=True, db_path=db_with_universe
    )
    conn = db.connect(db_with_universe)
    try:
        row = conn.execute("SELECT yahoo_sector, yahoo_sector_at FROM stock WHERE ticker = 'BBCA'").fetchone()
    finally:
        conn.close()
    assert row["yahoo_sector"] == "Financial Services"
    assert row["yahoo_sector_at"] is not None
    assert FakeTicker.calls == 1

    # dijalankan lagi dalam rentang refresh_market_cap_days → tidak memanggil `.info` dua kali
    prices.ingest_daily(
        tickers=["BBCA"], from_date=DATES[0], to_date=DATES[-1], refresh_info=True, db_path=db_with_universe
    )
    assert FakeTicker.calls == 1


# --- endpoint -----------------------------------------------------------------


def test_endpoint_requires_universe(tmp_db, monkeypatch):
    monkeypatch.setattr(db, "db_path", lambda: tmp_db)
    from backend.app.main import app

    r = TestClient(app).post("/api/v1/admin/ingest/prices", json={"mode": "daily", "tickers": ["BBCA"]})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "prereq_no_universe"


def test_endpoint_async_run_records_progress(db_with_universe, monkeypatch):
    _patch_download(monkeypatch)
    monkeypatch.setattr(db, "db_path", lambda: db_with_universe)
    from backend.app.main import app

    client = TestClient(app)
    body = {"mode": "daily", "tickers": ["BBCA"], "from": DATES[0], "to": DATES[-1]}
    r = client.post("/api/v1/admin/ingest/prices?async=true", json=body)
    assert r.status_code == 202, r.text
    assert r.json()["status"] == "queued"
    run_id = r.json()["run_id"]

    for _ in range(200):
        run = client.get(f"/api/v1/admin/runs/{run_id}").json()["run"]
        if run["status"] in {"ok", "partial", "failed", "skipped"}:
            break
    assert run["status"] == "ok", run
    assert run["kind"] == "prices_daily"
    assert run["rows"] == 6
    assert run["percent"] == 100.0
    assert run["params_json"]["tickers"] == ["BBCA"]
    assert run["result_json"]["from"] == DATES[0]
