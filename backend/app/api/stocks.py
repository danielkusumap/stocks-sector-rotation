"""Endpoint tabel & detail saham (docs/05 §2): `/stocks`, `/stocks/{ticker}`."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from .. import db
from ..config import get_settings
from ..labels import QUADRANT_LABEL
from ..repo import read
from .rrg import _check
from .schemas import StockDetailResponse, StockListResponse

router = APIRouter(prefix="/api/v1", tags=["stocks"])
_API_VERSION = "1.0"

LIST_SQL = """
    SELECT sm.ticker, st.name, sec.code AS sector_code, sm.close, sm.ret_1d, sm.ret_5d, sm.ret_1m,
           sm.median_turnover_20d_idr, sm.rsi14, sm.atr14, sm.stock_score, sm.quadrant AS stock_quadrant,
           r.rs_ratio, r.rs_momentum, r.quadrant
    FROM stock_metrics sm
    JOIN stock st ON st.ticker = sm.ticker
    JOIN sector sec ON sec.id = st.sector_id
    LEFT JOIN rrg_daily r ON r.scope = 'stock' AND r.ref_id = sm.ticker
                         AND r.as_of_date = sm.as_of_date AND r.timeframe = sm.timeframe
    WHERE sm.timeframe = ? AND st.is_active = 1
      AND sm.as_of_date = (SELECT MAX(as_of_date) FROM stock_metrics WHERE timeframe = ?)
    ORDER BY sm.ticker
"""
DETAIL_SQL = """
    SELECT st.ticker, st.name, st.yahoo_symbol, sec.code AS sector_code, sm.close, sm.sma20, sm.sma50,
           sm.rsi14, sm.atr14, sm.ret_1d, sm.ret_5d, sm.ret_1m, sm.median_turnover_20d_idr,
           sm.stock_score, r.rs_ratio, r.rs_momentum, r.quadrant
    FROM stock st
    JOIN sector sec ON sec.id = st.sector_id
    LEFT JOIN stock_metrics sm ON sm.ticker = st.ticker AND sm.timeframe = ?
        AND sm.as_of_date = (SELECT MAX(as_of_date) FROM stock_metrics WHERE timeframe = ?)
    LEFT JOIN rrg_daily r ON r.scope = 'stock' AND r.ref_id = st.ticker
                         AND r.timeframe = sm.timeframe AND r.as_of_date = sm.as_of_date
    WHERE st.ticker = ?
"""
SERIES_SQL = "SELECT date, close, volume FROM price_daily WHERE ticker = ? AND date BETWEEN ? AND ? ORDER BY date"
LAST_PICK_SQL = """
    SELECT week_end, rank, streak_weeks, entry_ref, stop, target, rationale FROM signal_weekly
    WHERE scope = 'stock' AND ref_id = ? ORDER BY week_end DESC LIMIT 1
"""
SORT_COLUMN = {
    "stock_score": "stock_score",
    "rs_ratio": "rs_ratio",
    "ret_1d": "ret_1d",
    "ret_1w": "ret_5d",
    "turnover": "median_turnover_20d_idr",
    "ticker": "ticker",
}


@router.get("/stocks", response_model=StockListResponse)
def list_stocks(
    timeframe: str = "d1",
    as_of: str | None = None,
    sector: list[str] = Query(default=[]),
    quadrant: list[str] = Query(default=[]),
    ret_positive_only: bool = False,
    q: str | None = None,
    min_turnover_idr: int | None = None,
    min_price_idr: int | None = None,
    sort: str = "stock_score",
    dir: str = "desc",
    limit: int = Query(50, ge=1, le=500),
    offset: int = 0,
) -> dict:
    """Tabel saham. `ret_positive_only` selalu memakai `ret_1w` (endpoint ini tanpa param `window`)."""
    cfg = get_settings()
    _check(timeframe, cfg.universe["weighting"], cfg)

    conn = db.connect()
    try:
        as_of = read.resolve_as_of(conn, timeframe, scope="stock", as_of=as_of)
        items = [dict(r) for r in conn.execute(LIST_SQL, (timeframe, timeframe))]

        wanted_sectors = read.split_multi(sector)
        wanted_quadrants = read.split_kwargs(quadrant)
        if wanted_sectors:
            items = [i for i in items if i["sector_code"] in wanted_sectors]
        if wanted_quadrants:
            items = [i for i in items if (i["quadrant"] or i["stock_quadrant"]) in wanted_quadrants]
        if ret_positive_only:
            items = [i for i in items if (i["ret_5d"] or 0) > 0]
        if q:
            needle = q.strip().lower()
            items = [i for i in items if needle in i["ticker"].lower() or needle in (i["name"] or "").lower()]
        if min_turnover_idr is not None:
            items = [i for i in items if (i["median_turnover_20d_idr"] or 0) >= int(min_turnover_idr)]
        if min_price_idr is not None:
            items = [i for i in items if (i["close"] or 0) >= float(min_price_idr)]

        key = SORT_COLUMN.get(sort, "stock_score")
        items.sort(key=lambda i: (i[key] is None, i[key] if i[key] is not None else 0), reverse=(dir != "asc"))
        total = len(items)
        page = items[int(offset) : int(offset) + int(limit)]

        body = {
            "api_version": _API_VERSION,
            "total": total,
            "limit": int(limit),
            "offset": int(offset),
            "items": [
                {
                    "ticker": i["ticker"],
                    "name": i["name"],
                    "sector_code": i["sector_code"],
                    "close": i["close"],
                    "ret_1d": i["ret_1d"],
                    "ret_1w": i["ret_5d"],
                    "ret_1m": i["ret_1m"],
                    "median_turnover_20d_idr": i["median_turnover_20d_idr"],
                    "rs_ratio": i["rs_ratio"],
                    "rs_momentum": i["rs_momentum"],
                    "quadrant": i["quadrant"] or i["stock_quadrant"],
                    "quadrant_label": QUADRANT_LABEL.get(i["quadrant"] or i["stock_quadrant"] or ""),
                    "stock_score": i["stock_score"],
                    "rsi14": i["rsi14"],
                    "atr14": i["atr14"],
                }
                for i in page
            ],
            "data_status": read.data_status(conn, as_of=as_of, timeframe=timeframe, weighting=cfg.universe["weighting"]),
        }
    finally:
        conn.close()
    return body


@router.get("/stocks/{ticker}", response_model=StockDetailResponse)
def stock_detail(
    ticker: str,
    timeframe: str = "d1",
    window: str = "3m",
    as_of: str | None = None,
) -> dict:
    """Detail saham: metrik (+`margin_to_min_turnover`), seri harga, snapshot pick terakhir."""
    cfg = get_settings()
    _check(timeframe, cfg.universe["weighting"], cfg)
    ticker = ticker.upper()

    conn = db.connect()
    try:
        row = conn.execute(DETAIL_SQL, (timeframe, timeframe, ticker)).fetchone()
        if row is None:
            raise HTTPException(404, {"code": "not_found", "message": f"saham {ticker} tidak ada", "detail": {"ticker": ticker}})
        row = dict(row)
        end = conn.execute("SELECT MAX(date) FROM price_daily WHERE ticker = ?", (ticker,)).fetchone()[0]
        start = read.window_start(end, window)
        series = [{"date": r["date"], "close": r["close"], "volume": r["volume"]} for r in conn.execute(SERIES_SQL, (ticker, start or "0000-01-01", end or "9999-12-31"))]
        pick = conn.execute(LAST_PICK_SQL, (ticker,)).fetchone()
        turnover = row["median_turnover_20d_idr"]
        margin = turnover / cfg.universe["min_turnover_idr"] if turnover else None
        body = {
            "api_version": _API_VERSION,
            "stock": {"ticker": row["ticker"], "name": row["name"], "sector_code": row["sector_code"], "yahoo_symbol": row["yahoo_symbol"]},
            "metrics": {
                "close": row["close"],
                "sma20": row["sma20"],
                "sma50": row["sma50"],
                "rsi14": row["rsi14"],
                "atr14": row["atr14"],
                "ret_1d": row["ret_1d"],
                "ret_1w": row["ret_5d"],
                "ret_1m": row["ret_1m"],
                "median_turnover_20d_idr": turnover,
                "rs_ratio": row["rs_ratio"],
                "rs_momentum": row["rs_momentum"],
                "quadrant": row["quadrant"],
                "stock_score": row["stock_score"],
                "margin_to_min_turnover": round(margin, 1) if margin is not None else None,
            },
            "series": series,
            "last_pick": (
                {
                    "week_end": pick["week_end"],
                    "rank": pick["rank"],
                    "streak_weeks": pick["streak_weeks"],
                    "entry_ref": pick["entry_ref"],
                    "stop": pick["stop"],
                    "target": pick["target"],
                    "rationale": pick["rationale"],
                }
                if pick
                else None
            ),
            "data_status": read.data_status(
                conn,
                as_of=as_of or read.resolve_as_of(conn, timeframe, scope="stock"),
                timeframe=timeframe,
                weighting=cfg.universe["weighting"],
                window=window,
            ),
        }
    finally:
        conn.close()
    return body
