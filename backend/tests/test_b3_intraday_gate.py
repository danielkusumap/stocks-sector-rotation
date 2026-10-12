"""B3 — ingest intraday + gate kesegaran (docs/02 §5). Yahoo diganti data palsu, tanpa jaringan."""

from __future__ import annotations

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app import db
from backend.app.config import get_settings
from backend.app.ingest import excel, freshness, prices
from backend.tests.fixtures import FIXTURE_SHEETS, write_xlsx

DAY = "2026-10-13"
FIELDS = ["Open", "High", "Low", "Close", "Adj Close", "Volume"]
ZERO_VOLUME = "11:00"  # bar tanpa transaksi → tidak dianggap sebagai bar terakhir


def _frame(minutes: list[str], symbols: list[str] | None = None) -> pd.DataFrame:
    """Tiruan keluaran `yf.download(interval='5m')` untuk jam WIB yang diminta."""
    idx = pd.DatetimeIndex([pd.Timestamp(f"{DAY} {m}", tz="Asia/Jakarta") for m in minutes])
    syms = symbols or ["BBCA.JK", "BBRI.JK", "^JKSE"]
    data = {}
    for sym in syms:
        volumes = [0 if m == ZERO_VOLUME else 1_000 for m in minutes]
        data.update(
            {
                (sym, "Open"): [100.0] * len(minutes),
                (sym, "High"): [101.0] * len(minutes),
                (sym, "Low"): [99.0] * len(minutes),
                (sym, "Close"): [100.5] * len(minutes),
                (sym, "Adj Close"): [100.5] * len(minutes),
                (sym, "Volume"): volumes,
            }
        )
    return pd.DataFrame(data, index=idx).sort_index(axis=1)


@pytest.fixture
def db_with_universe(tmp_db):
    data = write_xlsx(tmp_db.parent / "kecil.xlsx", FIXTURE_SHEETS)
    excel.import_excel(data, "kecil.xlsx", db_path=tmp_db)
    return tmp_db


@pytest.fixture
def small_config(monkeypatch):
    """Probe 2 ticker & satu interval supaya uji tetap kecil."""
    monkeypatch.setattr(get_settings(), "freshness_probe_tickers", ["BBCA.JK", "BBRI.JK"])
    monkeypatch.setitem(get_settings().ingest, "intraday_intervals", ["5m"])
    monkeypatch.setitem(get_settings().ingest, "sleep_seconds", 0)
    return get_settings()


def _patch(monkeypatch, minutes: list[str]):
    monkeypatch.setattr(prices.yf, "download", lambda symbols, **kw: _frame(minutes, list(symbols)))


def _ts(minute: str) -> str:
    return f"{DAY}T{minute}:00+07:00"


# --- sesi & penyaringan bar ---------------------------------------------------


@pytest.mark.parametrize(
    ("minute", "expected"),
    [
        ("08:59", None),
        ("09:00", "regular"),
        ("11:55", "regular"),
        ("12:00", None),  # jeda sesi 1 → 2
        ("13:29", None),
        ("13:30", "regular"),
        ("15:59", "regular"),
        ("16:00", "post"),
        ("16:10", "post"),
        ("16:15", None),
    ],
)
def test_session_of(minute, expected):
    assert prices.session_of(pd.Timestamp(f"{DAY} {minute}", tz="Asia/Jakarta")) == expected


def test_intraday_ingest_keeps_regular_and_post_only(db_with_universe, small_config, monkeypatch):
    _patch(monkeypatch, ["09:05", "11:05", "12:30", "16:05", "16:20"])
    r = prices.ingest_intraday(tickers=["BBCA"], db_path=db_with_universe)

    assert r["rows"] == 6  # 2 simbol (IHSG + BBCA) × 3 bar di dalam jam bursa
    assert r["sessions"] == {"regular": 4, "post": 2}
    assert r["failed_tickers"] == []

    conn = db.connect(db_with_universe)
    try:
        stamps = [row["ts"] for row in conn.execute("SELECT ts FROM price_intraday ORDER BY ts")]
        sessions = {row["session"] for row in conn.execute("SELECT DISTINCT session FROM price_intraday")}
    finally:
        conn.close()
    assert _ts("12:30") not in stamps  # jeda sesi tidak disimpan
    assert _ts("16:20") not in stamps  # setelah post-trading tidak disimpan
    assert _ts("16:05") in stamps  # post-trading disimpan untuk audit
    assert sessions == {"regular", "post"}


def test_last_regular_bar_ignores_zero_volume_and_post(db_with_universe, small_config, monkeypatch):
    _patch(monkeypatch, ["11:00", "11:05", "16:05"])
    df = prices.fetch(["BBCA.JK"], "", "", retries=1, backoff=0, interval="5m", period="1d")
    # 11:00 punya volume 0 dan 16:05 sesi post → yang dipakai 11:05
    assert freshness.last_regular_bar(df, "BBCA.JK", "Asia/Jakarta", DAY) == _ts("11:05")


# --- gate ---------------------------------------------------------------------


def test_gate_stale_blocks_midday(db_with_universe, small_config, monkeypatch):
    _patch(monkeypatch, ["10:30", "11:00", "11:05", "16:05"])  # belum sampai 11:30
    monkeypatch.setattr(db, "db_path", lambda: db_with_universe)
    from backend.app.main import app

    conn = db.connect(db_with_universe)
    try:
        gate = freshness.probe(conn)
        row = conn.execute("SELECT status, last_bar_at FROM data_freshness WHERE key = 'midday_gate'").fetchone()
        before = conn.execute("SELECT COUNT(*) FROM price_intraday").fetchone()[0]
    finally:
        conn.close()
    assert gate["gate"] == "stale"
    assert gate["last_bar_at"] == _ts("11:05")  # bar 16:05 (post) tidak dianggap
    assert gate["required_bar_time"] == "11:30"
    assert len(gate["probes"]) == 2
    assert (row["status"], row["last_bar_at"]) == ("stale", _ts("11:05"))

    r = TestClient(app).post("/api/v1/admin/midday")
    assert r.status_code == 200  # gate gagal bukan error
    assert r.json()["gate"] == "stale"
    assert r.json()["computed"] is False

    conn = db.connect(db_with_universe)
    try:
        after = conn.execute("SELECT COUNT(*) FROM price_intraday").fetchone()[0]
    finally:
        conn.close()
    assert after == before  # tidak ada baris midday/intraday baru


def test_gate_ok_allows_midday(db_with_universe, small_config, monkeypatch):
    _patch(monkeypatch, ["11:00", "11:35", "16:05"])
    monkeypatch.setattr(db, "db_path", lambda: db_with_universe)
    from backend.app.main import app

    conn = db.connect(db_with_universe)
    try:
        gate = freshness.probe(conn)
    finally:
        conn.close()
    assert gate["gate"] == "ok"
    assert gate["last_bar_at"] == _ts("11:35")

    r = TestClient(app).post("/api/v1/admin/midday")
    assert r.status_code == 200
    body = r.json()
    assert body["gate"] == "ok"
    # 6 simbol aktif (IHSG + 5 emiten fixture) × 3 bar di dalam jam bursa (2 reguler + 1 post)
    assert body["intraday_rows"] == 3 * (len(FIXTURE_SHEETS["IDXFINANCE"]) + 1)
    assert body["computed"] is False  # compute midday menyusul di B5
    assert body["message"]


def test_freshness_endpoint_shape(db_with_universe, small_config, monkeypatch):
    _patch(monkeypatch, ["11:35"])
    monkeypatch.setattr(db, "db_path", lambda: db_with_universe)
    from backend.app.main import app

    client = TestClient(app)
    assert client.post("/api/v1/admin/midday").status_code == 200

    body = client.get("/api/v1/freshness").json()
    assert body["api_version"] == "1.0"
    assert body["midday_gate"]["status"] == "ok"
    assert body["midday_gate"]["required_bar_time"] == "11:30"
    assert body["midday_gate"]["last_bar_at"] == _ts("11:35")
    assert [p["ticker"] for p in body["midday_gate"]["probes"]] == ["BBCA", "BBRI"]
    assert set(body["daily_ingest"]) >= {"status", "last_data_at", "last_bar_date"}
    assert body["daily_ingest"]["status"] in {"ok", "stale", "failed"}


def test_prices_endpoint_intraday_mode(db_with_universe, small_config, monkeypatch):
    _patch(monkeypatch, ["11:05"])
    monkeypatch.setattr(db, "db_path", lambda: db_with_universe)
    from backend.app.main import app

    r = TestClient(app).post("/api/v1/admin/ingest/prices", json={"mode": "intraday", "tickers": ["BBCA"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["intervals"] == ["5m"]
    assert body["rows"] == 2  # IHSG + BBCA, satu bar di jam bursa
    assert body["sessions"] == {"regular": 2, "post": 0}


def test_midday_run_recorded(db_with_universe, small_config, monkeypatch):
    _patch(monkeypatch, ["11:05"])
    monkeypatch.setattr(db, "db_path", lambda: db_with_universe)
    from backend.app.main import app

    TestClient(app).post("/api/v1/admin/midday")
    conn = db.connect(db_with_universe)
    try:
        row = conn.execute("SELECT kind, status, rows, result_json FROM ingest_run").fetchone()
    finally:
        conn.close()
    assert (row["kind"], row["status"]) == ("midday", "ok")  # gate stale bukan kegagalan job
    assert '"gate": "stale"' in row["result_json"] or '"gate":"stale"' in row["result_json"]
