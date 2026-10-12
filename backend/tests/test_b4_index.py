"""B4 — indeks sektor: equal/turnover/captier, partial, suspend (docs/02 §3, docs/03 §9).

Data ditulis langsung ke tabel (tanpa Yahoo): tiap uji memakai 1 sektor & 1–3 saham.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app import db
from backend.app.compute import index

STAMP = "2026-10-13T00:00:00+07:00"
D1, D2 = "2026-10-01", "2026-10-02"


def _stock(conn, sector_code: str, ticker: str, shares: int | None = None) -> None:
    sector_id = conn.execute("SELECT id FROM sector WHERE code = ?", (sector_code,)).fetchone()[0]
    conn.execute(
        "INSERT INTO stock (ticker, yahoo_symbol, sector_id, shares_outstanding, is_active, updated_at)"
        " VALUES (?, ?, ?, ?, 1, ?)",
        (ticker, f"{ticker}.JK", sector_id, shares, STAMP),
    )


def _bar(conn, ticker: str, date: str, close: float, volume: int) -> None:
    conn.execute(
        "INSERT INTO price_daily (ticker, date, open, high, low, close, adj_close, volume, value_idr, source, ingested_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'test', ?)",
        (ticker, date, close, close, close, close, close, volume, int(close * volume), STAMP),
    )


def _rows(conn, weighting: str) -> list[dict]:
    return [
        dict(r)
        for r in conn.execute(
            "SELECT * FROM sector_index_daily WHERE weighting = ? ORDER BY date", (weighting,)
        )
    ]


@pytest.fixture
def three_stocks(tmp_db):
    """+10% / 0% / −10% dalam satu sektor (docs/03 §9 test_index_equal_weight)."""
    conn = db.connect(tmp_db)
    try:
        for ticker, closes in {"AAAA": (100, 110), "BBBB": (100, 100), "CCCC": (100, 90)}.items():
            _stock(conn, "IDXFINANCE", ticker)
            _bar(conn, ticker, D1, closes[0], 1_000)
            _bar(conn, ticker, D2, closes[1], 1_000)
        conn.commit()
    finally:
        conn.close()
    return tmp_db


def test_index_equal_weight(three_stocks):
    info = index.compute_index(db_path=three_stocks, weightings=["equal"])
    assert info["rows"] == 2
    assert "IDXFINANCE" not in info["sectors_without_data"]  # sektor lain memang belum ada datanya

    conn = db.connect(three_stocks)
    try:
        base, day2 = _rows(conn, "equal")
    finally:
        conn.close()

    assert (base["date"], base["index_close"], base["ret_1d"]) == (D1, 100.0, None)
    assert day2["index_close"] == pytest.approx(100.0)  # (+10% + 0% −10%) / 3 = 0%
    assert day2["ret_1d"] == pytest.approx(0.0)
    assert (day2["advancers"], day2["decliners"], day2["unchanged"]) == (1, 1, 1)
    assert day2["constituents_count"] == 3
    assert day2["turnover_idr"] == 110_000 + 100_000 + 90_000
    assert day2["partial"] == 0


def test_single_stock_sector_follows_that_stock(tmp_db):
    conn = db.connect(tmp_db)
    try:
        _stock(conn, "IDXTRANS", "ZZZZ", shares=1_000)
        _bar(conn, "ZZZZ", D1, 100, 500)
        _bar(conn, "ZZZZ", D2, 109, 500)
        conn.commit()
    finally:
        conn.close()

    index.compute_index(db_path=tmp_db, weightings=["equal"])
    conn = db.connect(tmp_db)
    try:
        rows = _rows(conn, "equal")
    finally:
        conn.close()
    assert rows[-1]["index_close"] == pytest.approx(109.0)
    assert rows[-1]["constituents_count"] == 1
    assert rows[-1]["partial"] == 1  # < min_constituents (3)


def test_captier_excludes_stocks_without_shares(tmp_db):
    conn = db.connect(tmp_db)
    try:
        _stock(conn, "IDXFINANCE", "AAAA", shares=1_000)
        _bar(conn, "AAAA", D1, 100, 1_000)
        _bar(conn, "AAAA", D2, 110, 1_000)
        _stock(conn, "IDXFINANCE", "BBBB", shares=None)  # tanpa jumlah lembar
        _bar(conn, "BBBB", D1, 100, 1_000)
        _bar(conn, "BBBB", D2, 90, 1_000)
        conn.commit()
    finally:
        conn.close()

    index.compute_index(db_path=tmp_db, weightings=["equal", "captier"])
    conn = db.connect(tmp_db)
    try:
        equal = _rows(conn, "equal")[-1]
        captier = _rows(conn, "captier")[-1]
    finally:
        conn.close()

    assert equal["index_close"] == pytest.approx(100.0)  # (+10% −10%)/2 = 0
    assert captier["index_close"] == pytest.approx(110.0)  # BBBB dikecualikan, penyebut dihitung ulang
    assert captier["constituents_count"] == 2  # BBBB tetap bertransaksi, hanya tidak masuk bobot


def test_turnover_weighting_uses_median_turnover(tmp_db):
    conn = db.connect(tmp_db)
    try:
        # AAAAA nilai transaksi 10× BBBBB → bobot 10/11 vs 1/11
        _stock(conn, "IDXFINANCE", "AAAA")
        _bar(conn, "AAAA", D1, 100, 10_000)
        _bar(conn, "AAAA", D2, 110, 10_000)
        _stock(conn, "IDXFINANCE", "BBBB")
        _bar(conn, "BBBB", D1, 100, 1_000)
        _bar(conn, "BBBB", D2, 90, 1_000)
        conn.commit()
    finally:
        conn.close()

    index.compute_index(db_path=tmp_db, weightings=["turnover"])
    conn = db.connect(tmp_db)
    try:
        row = _rows(conn, "turnover")[-1]
    finally:
        conn.close()

    expected = (10 / 11) * 0.10 + (1 / 11) * (-0.10)
    assert row["index_close"] == pytest.approx(100 * (1 + expected))
    assert row["ret_1d"] == pytest.approx(expected)


def test_two_zero_volume_days_exclude_stock_until_next_trade(tmp_db):
    dates = ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]
    conn = db.connect(tmp_db)
    try:
        _stock(conn, "IDXFINANCE", "AAAA")
        _stock(conn, "IDXFINANCE", "BBBB")
        for i, date in enumerate(dates):
            _bar(conn, "AAAA", date, 100 + i, 0 if date in ("2026-10-05", "2026-10-06") else 1_000)
            _bar(conn, "BBBB", date, 100, 1_000)
        conn.commit()
    finally:
        conn.close()

    index.compute_index(db_path=tmp_db, weightings=["equal"])
    conn = db.connect(tmp_db)
    try:
        rows = _rows(conn, "equal")
    finally:
        conn.close()

    counts = {r["date"]: r["constituents_count"] for r in rows}
    assert counts["2026-10-02"] == 2
    assert counts["2026-10-05"] == 2  # hari pertama tanpa transaksi: masih ikut
    assert counts["2026-10-06"] == 1  # hari kedua berturut → AAAA dianggap suspend
    assert counts["2026-10-07"] == 1  # hari transaksi pertama setelah suspend: belum dipakai
    assert counts["2026-10-08"] == 2  # sudah kembali normal


def test_equal_weight_is_average_not_sum(tmp_db):
    """Dua saham (+10%, 0%) → indeks +5%, bukan +10% (rata-rata, bukan jumlah return)."""
    conn = db.connect(tmp_db)
    try:
        _stock(conn, "IDXFINANCE", "AAAA")
        _bar(conn, "AAAA", D1, 100, 1_000)
        _bar(conn, "AAAA", D2, 110, 1_000)
        _stock(conn, "IDXFINANCE", "BBBB")
        _bar(conn, "BBBB", D1, 100, 1_000)
        _bar(conn, "BBBB", D2, 100, 1_000)
        conn.commit()
    finally:
        conn.close()

    index.compute_index(db_path=tmp_db, weightings=["equal"])
    conn = db.connect(tmp_db)
    try:
        row = _rows(conn, "equal")[-1]
    finally:
        conn.close()
    assert row["ret_1d"] == pytest.approx(0.05)
    assert row["index_close"] == pytest.approx(105.0)


def test_recompute_is_idempotent(three_stocks):
    index.compute_index(db_path=three_stocks, weightings=["equal"])
    index.compute_index(db_path=three_stocks, weightings=["equal"])
    conn = db.connect(three_stocks)
    try:
        total = conn.execute("SELECT COUNT(*) FROM sector_index_daily WHERE weighting = 'equal'").fetchone()[0]
    finally:
        conn.close()
    assert total == 2  # tidak menggandakan baris


# --- endpoint & prasyarat -----------------------------------------------------


def test_compute_endpoint_runs_index(three_stocks, monkeypatch):
    monkeypatch.setattr(db, "db_path", lambda: three_stocks)
    from backend.app.main import app

    r = TestClient(app).post("/api/v1/admin/compute", json={"stage": "index", "timeframe": "d1"})
    assert r.status_code == 200, r.text
    assert r.json()["rows"] == 6  # 2 baris × 3 bobot
    assert r.json()["weightings"] == ["equal", "turnover", "captier"]
    assert r.json()["duration_s"] >= 0


def test_compute_endpoint_requires_prices(tmp_db, monkeypatch):
    conn = db.connect(tmp_db)
    try:
        _stock(conn, "IDXFINANCE", "AAAA")  # universe ada, harga belum
        conn.commit()
    finally:
        conn.close()
    monkeypatch.setattr(db, "db_path", lambda: tmp_db)
    from backend.app.main import app

    r = TestClient(app).post("/api/v1/admin/compute", json={"stage": "index"})
    assert r.status_code == 409
    body = r.json()["error"]
    assert body["code"] == "prereq_no_prices"
    assert body["detail"]["coverage"] == 0.0


def test_compute_endpoint_rejects_unknown_stage(three_stocks, monkeypatch):
    monkeypatch.setattr(db, "db_path", lambda: three_stocks)
    from backend.app.main import app

    client = TestClient(app)
    assert client.post("/api/v1/admin/compute", json={"stage": "xyz"}).status_code == 400
    assert client.post("/api/v1/admin/compute", json={"stage": "index", "timeframe": "x1"}).status_code == 400
    # B7: `signals` sudah jalan; yang menahan sekarang gate minggu final, bukan "not_implemented".
    from backend.app.compute import signals as signals_module

    monkeypatch.setattr(signals_module, "gate_final_week", lambda *a, **k: {"gate": "not_final", "weekday": "Tuesday"})
    gated = client.post("/api/v1/admin/compute", json={"stage": "signals"})
    assert gated.status_code == 409
    assert gated.json()["error"]["code"] == "gate_weekly_not_final"
    assert client.post("/api/v1/admin/compute", json={"stage": "rrg", "timeframe": "d1"}).status_code == 200
