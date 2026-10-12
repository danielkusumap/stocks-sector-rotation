"""B5 — RRG: kuadran, warmup, resample mingguan, saham vs sektor (docs/03 §2–§4, §9).

Data kecil: seri sintetis (100 bar) atau 1 sektor berisi 2 saham (70 bar), tanpa jaringan.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from backend.app import db
from backend.app.compute import index, metrics, rrg

STAMP = "2026-10-13T00:00:00+07:00"
DATES = pd.bdate_range("2026-06-01", periods=100).strftime("%Y-%m-%d").tolist()
MIN_POINTS = 60


def _series(values: np.ndarray, dates: list[str] = DATES) -> pd.Series:
    return pd.Series(values, index=dates[: len(values)])


# --- kuadran ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("ratio", "momentum", "expected"),
    [
        (102.0, 101.0, "leading"),
        (102.0, 99.0, "weakening"),
        (98.0, 99.0, "lagging"),
        (98.0, 101.0, "improving"),
        (100.0, 101.0, "lagging"),  # tepat 100 → ikut kuadran sebelumnya
    ],
)
def test_quadrant_rules(ratio, momentum, expected):
    assert rrg.quadrant(ratio, momentum, previous="lagging") == expected


def test_rrg_quadrant():
    bench = _series(np.full(100, 100.0))
    # relatif naik makin cepat (60 bar) lalu melambat (40 bar): memimpin → melemah
    up_fast = 100 * np.cumprod(np.concatenate([np.full(60, 1.01), np.full(40, 1.008)]))
    frame = rrg.rrg_series(bench, _series(up_fast), ema_span=14, roc_lag=10, min_points=MIN_POINTS)
    rows = rrg.rrg_rows(frame, scope="sector", ref_id="IDXFINANCE", timeframe="d1", weighting="equal", bench_ref="IHSG")
    quadrants = [r[8] for r in rows]

    assert quadrants[0] == "leading"  # naik relatif + momentum positif
    assert "weakening" in quadrants[-5:] or quadrants[-1] == "weakening"  # momentum berbalik
    transitions = [r[10] for r in rows]
    assert transitions[0] is None  # periode pertama: belum ada transisi
    assert any(t and "→" in t for t in transitions)  # transisi hanya saat kuadran benar-benar berubah
    assert all(t is None or "→" in t for t in transitions)
    assert rows[0][11] == 1  # quadrant_age_periods mulai dari 1


def test_rrg_warmup():
    bench = _series(np.full(100, 100.0))
    short = _series(100 * np.cumprod(np.full(30, 1.01)))
    frame = rrg.rrg_series(bench, short, ema_span=14, roc_lag=10, min_points=MIN_POINTS)
    assert frame.empty  # 30 bar < min_points 60 → tanpa baris, bukan exception


def test_rrg_series_bars_before_warmup_dropped():
    bench = _series(np.full(100, 100.0))
    rising = _series(100 * np.cumprod(np.full(80, 1.005)))
    frame = rrg.rrg_series(bench, rising, ema_span=14, roc_lag=10, min_points=MIN_POINTS)
    assert 0 < len(frame) <= 80 - MIN_POINTS + 1


# --- resample mingguan --------------------------------------------------------


def test_resample_wfri():
    dates = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13"]
    daily = _series(np.arange(1, 8, dtype=float), dates)

    weekly_all = rrg.weekly(daily, final_only=False)
    assert list(weekly_all.index) == ["2026-10-09", "2026-10-16"]  # label selalu Jumat
    assert weekly_all.iloc[0] == 5.0  # bar terakhir minggu lengkap (Jumat)

    weekly_final = rrg.weekly(daily, final_only=True)
    assert list(weekly_final.index) == ["2026-10-09"]  # minggu berjalan (Sen–Sel) dibuang


# --- saham vs sektor ----------------------------------------------------------


def test_stock_relative_strength_uses_its_sector():
    sector = _series(100 * np.cumprod(np.full(90, 1.002)))  # indeks sektor naik pelan
    stock = _series(100 * np.cumprod(np.full(90, 1.01)))  # saham naik lebih cepat
    frame = rrg.rrg_series(sector, stock, ema_span=14, roc_lag=10, min_points=MIN_POINTS)
    last = frame.iloc[-1]

    assert last["rs_ratio"] > 100  # lebih kuat dari sektornya
    assert rrg.quadrant(float(last["rs_ratio"]), float(last["rs_momentum"])) == "leading"


def _seed(conn, ticker: str, closes: np.ndarray, sector_code: str = "IDXFINANCE") -> None:
    if ticker != "IHSG":  # IHSG hanya benchmark, bukan emiten
        sector_id = conn.execute("SELECT id FROM sector WHERE code = ?", (sector_code,)).fetchone()[0]
        conn.execute(
            "INSERT INTO stock (ticker, yahoo_symbol, sector_id, shares_outstanding, is_active, updated_at) VALUES (?, ?, ?, 1000000, 1, ?)",
            (ticker, f"{ticker}.JK", sector_id, STAMP),
        )
    for date, close in zip(DATES[: len(closes)], closes):
        conn.execute(
            "INSERT INTO price_daily (ticker, date, open, high, low, close, adj_close, volume, value_idr, source, ingested_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, 1000, ?, 'test', ?)",
            (ticker, date, close, close, close, close, close, int(close * 1000), STAMP),
        )


def test_compute_rrg_writes_sector_and_stock_rows(tmp_db):
    bench = 100 * np.cumprod(np.full(90, 1.001))
    fast = 100 * np.cumprod(np.full(90, 1.010))
    slow = 100 * np.cumprod(np.full(90, 0.999))
    conn = db.connect(tmp_db)
    try:
        _seed(conn, "IHSG", bench)
        _seed(conn, "AAAA", fast)
        _seed(conn, "BBBB", slow)
        conn.commit()
    finally:
        conn.close()

    index.compute_index(db_path=tmp_db, weightings=["equal"])
    info = rrg.compute_rrg(timeframes=["d1"], weightings=["equal"], db_path=tmp_db)

    conn = db.connect(tmp_db)
    try:
        sector_rows = conn.execute(
            "SELECT COUNT(*), MIN(quadrant), MAX(quadrant) FROM rrg_daily WHERE scope = 'sector' AND ref_id = 'IDXFINANCE'"
        ).fetchone()
        stock = conn.execute(
            "SELECT as_of_date, rs_ratio, rs_momentum, quadrant, bench_ref, quadrant_age_periods"
            " FROM rrg_daily WHERE scope = 'stock' AND ref_id = 'AAAA' ORDER BY as_of_date DESC LIMIT 1"
        ).fetchone()
        slow_quadrant = conn.execute(
            "SELECT quadrant FROM rrg_daily WHERE scope = 'stock' AND ref_id = 'BBBB' ORDER BY as_of_date DESC LIMIT 1"
        ).fetchone()[0]
        bench_ref = conn.execute("SELECT DISTINCT bench_ref FROM rrg_daily WHERE scope = 'sector'").fetchall()
    finally:
        conn.close()

    assert info["rows"] > 0
    assert sector_rows[0] > 0
    assert stock["bench_ref"] == "IDXFINANCE"  # benchmark saham = indeks sektornya
    assert stock["rs_ratio"] > 100 and stock["quadrant"] == "leading"
    assert stock["quadrant_age_periods"] >= 1
    assert slow_quadrant == "lagging"
    assert [r[0] for r in bench_ref] == ["IHSG"]


def test_compute_metrics_snapshots(tmp_db):
    """Metrik sektor & saham: return, indikator, median turnover, tautan RRG (data kecil)."""
    bench = 100 * np.cumprod(np.full(90, 1.001))
    fast = 100 * np.cumprod(np.full(90, 1.010))
    conn = db.connect(tmp_db)
    try:
        _seed(conn, "IHSG", bench)
        _seed(conn, "AAAA", fast)
        conn.commit()
    finally:
        conn.close()

    index.compute_index(db_path=tmp_db, weightings=["equal"])
    rrg.compute_rrg(timeframes=["d1"], weightings=["equal"], db_path=tmp_db)
    info = metrics.compute_metrics(timeframes=["d1"], weightings=["equal"], db_path=tmp_db)

    conn = db.connect(tmp_db)
    try:
        sector = conn.execute(
            "SELECT COUNT(*), MAX(as_of_date) FROM sector_metrics WHERE timeframe = 'd1' AND weighting = 'equal'"
        ).fetchone()
        latest = conn.execute(
            "SELECT ret_1w, ret_1m, median_turnover_20d_idr, rrg_rs_ratio, rrg_rs_momentum, score, rank_score"
            " FROM sector_metrics WHERE timeframe = 'd1' AND weighting = 'equal' ORDER BY as_of_date DESC LIMIT 1"
        ).fetchone()
        stock = conn.execute("SELECT * FROM stock_metrics WHERE ticker = 'AAAA'").fetchone()
    finally:
        conn.close()

    assert info["sector_rows"] > 80 and info["stock_rows"] == 1
    assert sector[1] == DATES[89]
    assert latest["ret_1w"] is not None and latest["ret_1m"] is not None
    assert latest["median_turnover_20d_idr"] > 0
    assert latest["rrg_rs_ratio"] > 100  # tersambung ke rrg_daily
    assert latest["score"] is None and latest["rank_score"] is None  # diisi di B6

    assert stock["close"] == pytest.approx(float(fast[-1]), rel=1e-6)
    assert stock["ret_1d"] == pytest.approx(0.01, rel=1e-3)
    assert stock["sma20"] > 0 and stock["sma50"] > 0
    assert 0 < stock["rsi14"] <= 100
    assert stock["atr14"] is not None and stock["median_turnover_20d_idr"] > 0
    assert stock["rs_ratio"] == pytest.approx(100.0)  # sektor hanya berisi saham ini → RS relatif konstan
    assert stock["stock_score"] is None  # diisi di B6


def test_metrics_weekly_uses_weekly_bars(tmp_db):
    """Timeframe mingguan: tanggal metrik = label Jumat & return dihitung per minggu."""
    bench = 100 * np.cumprod(np.full(90, 1.001))
    fast = 100 * np.cumprod(np.full(90, 1.010))
    conn = db.connect(tmp_db)
    try:
        _seed(conn, "IHSG", bench)
        _seed(conn, "AAAA", fast)
        conn.commit()
    finally:
        conn.close()

    index.compute_index(db_path=tmp_db, weightings=["equal"])
    rrg.compute_rrg(timeframes=["w1"], weightings=["equal"], db_path=tmp_db)
    daily = metrics.compute_metrics(timeframes=["d1"], weightings=["equal"], db_path=tmp_db)
    weekly = metrics.compute_metrics(timeframes=["w1"], weightings=["equal"], db_path=tmp_db)

    conn = db.connect(tmp_db)
    try:
        dates = [
            r[0]
            for r in conn.execute(
                "SELECT DISTINCT as_of_date FROM sector_metrics WHERE timeframe = 'w1' ORDER BY as_of_date"
            )
        ]
        one_week = conn.execute(
            "SELECT ret_1w FROM sector_metrics WHERE timeframe = 'w1' ORDER BY as_of_date DESC LIMIT 1"
        ).fetchone()[0]
    finally:
        conn.close()

    assert weekly["sector_rows"] < daily["sector_rows"]  # bar mingguan lebih sedikit
    assert all(pd.Timestamp(d).weekday() == 4 for d in dates)  # semua label Jumat
    assert one_week == pytest.approx(1.01**5 - 1, rel=0.05)  # satu bar mingguan ≈ 5%, bukan 1% (harian)


def test_compute_rrg_is_idempotent(tmp_db):
    bench = 100 * np.cumprod(np.full(90, 1.001))
    fast = 100 * np.cumprod(np.full(90, 1.010))
    conn = db.connect(tmp_db)
    try:
        _seed(conn, "IHSG", bench)
        _seed(conn, "AAAA", fast)
        conn.commit()
    finally:
        conn.close()

    index.compute_index(db_path=tmp_db, weightings=["equal"])
    rrg.compute_rrg(timeframes=["d1"], weightings=["equal"], db_path=tmp_db)
    first = None
    conn = db.connect(tmp_db)
    try:
        first = conn.execute("SELECT COUNT(*) FROM rrg_daily").fetchone()[0]
    finally:
        conn.close()

    rrg.compute_rrg(timeframes=["d1"], weightings=["equal"], db_path=tmp_db)
    conn = db.connect(tmp_db)
    try:
        second = conn.execute("SELECT COUNT(*) FROM rrg_daily").fetchone()[0]
    finally:
        conn.close()
    assert first == second > 0
