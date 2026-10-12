"""B6 — skor & ranking: persentil lintas sektor, penalti decline, `rank_score`, `stock_score`."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from backend.app import db
from backend.app.compute import index, metrics, rrg
from backend.app.config import get_settings

STAMP = "2026-10-13T00:00:00+07:00"
DATES = pd.bdate_range("2026-06-01", periods=90).strftime("%Y-%m-%d").tolist()


def _frame() -> pd.DataFrame:
    """3 sektor: komponen RS/growth menurun, share saham turun naik (0,1 / 0,5 / 0,9)."""
    return pd.DataFrame(
        {
            "sector_id": [1, 2, 3],
            "code": ["IDXFINANCE", "IDXENERGY", "IDXTRANS"],
            "rs_ratio": [110.0, 100.0, 90.0],
            "rs_momentum": [105.0, 100.0, 95.0],
            "turnover_growth": [0.2, 0.0, -0.1],
        }
    )


def test_score_frame_percentiles_penalty_and_rank():
    cfg = get_settings()
    scored = metrics.score_frame(
        _frame(),
        cfg,
        reference_return=pd.Series([0.10, 0.0, -0.10]),
        decline_share=pd.Series([0.1, 0.5, 0.9]),
    ).set_index("code")

    assert scored.loc["IDXFINANCE", "rank_rs_ratio"] == pytest.approx(100.0)  # tertinggi = 100
    assert scored.loc["IDXENERGY", "rank_rs_ratio"] == pytest.approx(200 / 3)
    assert scored.loc["IDXTRANS", "rank_turnover"] == pytest.approx(100 / 3)

    # penalti mulai di 0,4: 0,1 → 0; 0,5 → 16,7; 0,9 → 83,3
    assert scored.loc["IDXFINANCE", "penalty_decline"] == pytest.approx(0.0)
    assert scored.loc["IDXENERGY", "penalty_decline"] == pytest.approx(16.666, rel=1e-3)
    assert scored.loc["IDXTRANS", "penalty_decline"] == pytest.approx(83.333, rel=1e-3)

    assert scored.loc["IDXFINANCE", "score"] == pytest.approx(100.0)
    assert scored.loc["IDXENERGY", "score"] == pytest.approx(66.667 - 0.25 * 16.666, rel=1e-3)
    assert scored.loc["IDXTRANS", "score"] == pytest.approx(33.333 - 0.25 * 83.333, rel=1e-3)

    assert list(scored["rank_score"]) == [1, 2, 3]  # unik & urut skor menurun
    assert all(0 <= s <= 100 for s in scored["score"])


def test_score_uses_weights_from_config(monkeypatch):
    cfg = get_settings()
    base = metrics.score_frame(
        _frame(), cfg, reference_return=pd.Series([0.1, 0.0, -0.1]), decline_share=pd.Series([0.1, 0.5, 0.9])
    ).set_index("code")

    monkeypatch.setitem(cfg.scoring["sector"], "weight_rs_ratio", 1.0)
    for key in ("weight_rs_momentum", "weight_return_window", "weight_turnover_growth"):
        monkeypatch.setitem(cfg.scoring["sector"], key, 0.0)
    monkeypatch.setitem(cfg.scoring["sector"], "penalty_decline_weight", 0.0)
    tuned = metrics.score_frame(
        _frame(), cfg, reference_return=pd.Series([0.1, 0.0, -0.1]), decline_share=pd.Series([0.1, 0.5, 0.9])
    ).set_index("code")

    assert tuned.loc["IDXTRANS", "score"] == pytest.approx(100 / 3, abs=0.05)  # murni persentil RS-Ratio
    assert tuned.loc["IDXTRANS", "score"] != base.loc["IDXTRANS", "score"]


def test_score_never_negative_or_above_100(monkeypatch):
    cfg = get_settings()
    monkeypatch.setitem(cfg.scoring["sector"], "penalty_decline_weight", 1.0)
    scored = metrics.score_frame(
        _frame(), cfg, reference_return=pd.Series([0.0, 0.0, 0.0]), decline_share=pd.Series([0.9, 0.9, 0.9])
    )
    assert all(0 <= s <= 100 for s in scored["score"])  # penalti besar tidak membuat skor negatif


def test_stock_score_frame():
    cfg = get_settings()
    frame = pd.DataFrame(
        {
            "ticker": ["AAAA", "BBBB", "CCCC"],
            "rs_ratio": [120.0, 100.0, 80.0],
            "ret_5d": [0.05, 0.0, -0.05],
            "median_turnover_20d_idr": [3_000_000_000, 2_000_000_000, 1_000_000_000],
        }
    )
    scored = metrics.stock_score_frame(frame, cfg).set_index("ticker")

    # persentil 100/66,7/33,3 untuk ketiga komponen; bobot 0,4 / 0,3 / 0,3 (skor dibulatkan 1 desimal)
    assert scored.loc["AAAA", "stock_score"] == pytest.approx(100.0)
    assert scored.loc["BBBB", "stock_score"] == pytest.approx(200 / 3, abs=0.05)
    assert scored.loc["CCCC", "stock_score"] == pytest.approx(100 / 3, abs=0.05)


# --- integrasi dengan tabel ---------------------------------------------------


def _seed(conn, ticker: str, closes: np.ndarray, sector_code: str = "IDXFINANCE") -> None:
    if ticker != "IHSG":
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


@pytest.fixture
def scored_db(tmp_db):
    conn = db.connect(tmp_db)
    try:
        _seed(conn, "IHSG", 100 * np.cumprod(np.full(90, 1.001)))
        _seed(conn, "AAAA", 100 * np.cumprod(np.full(90, 1.010)))
        _seed(conn, "BBBB", 100 * np.cumprod(np.full(90, 0.999)))
        conn.commit()
    finally:
        conn.close()

    index.compute_index(db_path=tmp_db, weightings=["equal"])
    rrg.compute_rrg(timeframes=["d1"], weightings=["equal"], db_path=tmp_db)
    metrics.compute_metrics(timeframes=["d1"], weightings=["equal"], db_path=tmp_db)
    metrics.compute_scores(timeframes=["d1"], weightings=["equal"], db_path=tmp_db)
    return tmp_db


def test_compute_scores_fills_tables(scored_db):
    conn = db.connect(scored_db)
    try:
        sector = conn.execute(
            """
            SELECT COUNT(*) AS n, MIN(score) AS lo, MAX(score) AS hi, COUNT(DISTINCT rank_score) AS ranks
            FROM sector_metrics WHERE timeframe = 'd1' AND weighting = 'equal' AND score IS NOT NULL
            """
        ).fetchone()
        rrg_score = conn.execute(
            "SELECT COUNT(*) FROM rrg_daily WHERE scope = 'sector' AND score IS NOT NULL"
        ).fetchone()[0]
        stock = conn.execute(
            "SELECT stock_score, quadrant FROM stock_metrics WHERE ticker = 'AAAA'"
        ).fetchone()
    finally:
        conn.close()

    assert sector["n"] == 1  # hanya as_of terakhir yang diberi skor
    assert 0 <= sector["lo"] <= sector["hi"] <= 100
    assert sector["ranks"] == 1
    assert rrg_score == 1
    assert stock["stock_score"] is not None and 0 <= stock["stock_score"] <= 100
    assert stock["quadrant"] == "leading"  # disalin dari rrg_daily


def test_compute_scores_rank_is_unique(scored_db):
    conn = db.connect(scored_db)
    try:
        ranks = [
            r[0]
            for r in conn.execute(
                "SELECT rank_score FROM sector_metrics WHERE timeframe = 'd1' AND weighting = 'equal'"
                " AND rank_score IS NOT NULL ORDER BY rank_score"
            )
        ]
    finally:
        conn.close()
    assert ranks == list(range(1, len(ranks) + 1))  # unik & berurutan dari 1
