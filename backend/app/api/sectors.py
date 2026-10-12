"""Endpoint tabel & detail sektor (docs/05 §2): `/sectors/summary`, `/sectors/{code}`."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from .. import cache, db
from ..config import get_settings
from ..labels import QUADRANT_DESC, QUADRANT_LABEL
from ..repo import read
from .rrg import SERIES_SQL, _check
from .schemas import SectorDetailResponse, SectorSummaryResponse

router = APIRouter(prefix="/api/v1", tags=["sectors"])
_API_VERSION = "1.0"

SUMMARY_SQL = """
    SELECT s.code, s.name_id, s.color_hex, s.sort_order,
           r.quadrant, r.quadrant_prev, r.transition, r.quadrant_age_periods,
           r.rs_ratio, r.rs_momentum, r.rs_ratio_change_1p, r.rs_momentum_change_1p, r.score AS rrg_score,
           m.score, m.rank_score, m.ret_1w, m.ret_1m, m.ret_3m, m.ret_6m, m.ret_ytd,
           m.median_turnover_20d_idr, m.turnover_growth,
           i.index_close, i.turnover_idr, i.advancers, i.decliners, i.unchanged, i.constituents_count, i.partial
    FROM rrg_daily r
    JOIN sector s ON s.code = r.ref_id
    LEFT JOIN sector_metrics m ON m.sector_id = s.id AND m.as_of_date = r.as_of_date
                              AND m.timeframe = r.timeframe AND m.weighting = r.weighting
    LEFT JOIN sector_index_daily i ON i.sector_id = s.id AND i.weighting = r.weighting
        AND i.date = (SELECT MAX(date) FROM sector_index_daily
                      WHERE sector_id = s.id AND weighting = r.weighting AND date <= r.as_of_date)
    WHERE r.scope = 'sector' AND r.timeframe = ? AND r.weighting = ? AND r.as_of_date = ?
    ORDER BY s.sort_order
"""
TOP_STOCK_SQL = """
    SELECT sm.ticker, sm.stock_score FROM stock_metrics sm
    JOIN stock st ON st.ticker = sm.ticker
    JOIN sector s ON s.id = st.sector_id
    WHERE s.code = ? AND sm.timeframe = ? AND st.is_active = 1
      AND sm.as_of_date = (SELECT MAX(as_of_date) FROM stock_metrics WHERE timeframe = ?)
      AND sm.stock_score IS NOT NULL
    ORDER BY sm.stock_score DESC, sm.ticker LIMIT 1
"""
CONSTITUENTS_SQL = """
    SELECT sm.ticker, st.name, sm.close, sm.ret_1d, sm.ret_5d, sm.median_turnover_20d_idr,
           sm.rsi14, sm.atr14, sm.stock_score, r.rs_ratio, r.rs_momentum, r.quadrant
    FROM stock_metrics sm
    JOIN stock st ON st.ticker = sm.ticker
    LEFT JOIN rrg_daily r ON r.scope = 'stock' AND r.ref_id = sm.ticker
                         AND r.as_of_date = sm.as_of_date AND r.timeframe = sm.timeframe
    WHERE st.sector_id = ? AND st.is_active = 1 AND sm.timeframe = ?
      AND sm.as_of_date = (SELECT MAX(as_of_date) FROM stock_metrics WHERE timeframe = ?)
    ORDER BY sm.ticker
"""
# shortcut: window `1y` dipetakan ke `ret_ytd` karena DDL docs/04 tidak punya kolom `ret_1y`;
# tambahkan kolom `ret_1y` (migrasi + metrics) kalau UI benar-benar butuh filter 1 tahun penuh.
RETURN_COLUMN = {"1w": "ret_1w", "1m": "ret_1m", "3m": "ret_3m", "6m": "ret_6m", "1y": "ret_ytd", "ytd": "ret_ytd"}
SORT_COLUMN = {
    "score": "score",
    "rs_ratio": "rs_ratio",
    "rs_momentum": "rs_momentum",
    "ret_1w": "ret_1w",
    "ret_1m": "ret_1m",
    "turnover": "median_turnover_20d_idr",
    "rank_score": "rank_score",
}


def _summary_row(conn, row: dict, timeframe: str, weighting: str, streaks: dict) -> dict:
    top = conn.execute(TOP_STOCK_SQL, (row["code"], timeframe, timeframe)).fetchone()
    return {
        "code": row["code"],
        "name_id": row["name_id"],
        "color_hex": row["color_hex"],
        "quadrant": row["quadrant"],
        "quadrant_label": QUADRANT_LABEL.get(row["quadrant"]),
        "quadrant_desc": QUADRANT_DESC.get(row["quadrant"]),
        "quadrant_prev": row["quadrant_prev"],
        "transition": row["transition"],
        "quadrant_age_periods": row["quadrant_age_periods"],
        "rs_ratio": row["rs_ratio"],
        "rs_momentum": row["rs_momentum"],
        "rs_ratio_change_1p": row["rs_ratio_change_1p"],
        "rs_momentum_change_1p": row["rs_momentum_change_1p"],
        "ret_1w": row["ret_1w"],
        "ret_1m": row["ret_1m"],
        "ret_3m": row["ret_3m"],
        "ret_6m": row["ret_6m"],
        "ret_ytd": row["ret_ytd"],
        "turnover_idr": row["turnover_idr"],
        "median_turnover_20d_idr": row["median_turnover_20d_idr"],
        "turnover_growth": row["turnover_growth"],
        "advancers": row["advancers"] or 0,
        "decliners": row["decliners"] or 0,
        "unchanged": row["unchanged"] or 0,
        "constituents_count": row["constituents_count"] or 0,
        "partial": bool(row["partial"]),
        "score": row["score"] if row["score"] is not None else row["rrg_score"],
        "rank_score": row["rank_score"],
        "streak_weeks": streaks.get(row["code"], 0),
        "top_stock": {"ticker": top["ticker"], "stock_score": top["stock_score"]} if top else None,
    }


@router.get("/sectors/summary", response_model=SectorSummaryResponse)
def sectors_summary(
    timeframe: str = "d1",
    as_of: str | None = None,
    window: str = "3m",
    weighting: str | None = None,
    sector: list[str] = Query(default=[]),
    quadrant: list[str] = Query(default=[]),
    transition: str | None = None,
    min_streak: int = 0,
    min_turnover_idr: int | None = None,
    ret_positive_only: bool = False,
    only_partial: bool = False,
    sort: str = "score",
    dir: str = "desc",
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """Tabel sektor dengan semua filter `docs/06` §7 (`total/limit/offset` dihitung setelah filter)."""
    cfg = get_settings()
    weighting = weighting or cfg.universe["weighting"]
    _check(timeframe, weighting, cfg)

    params = {
        "timeframe": timeframe, "window": window, "weighting": weighting, "sector": sorted(sector), "quadrant": sorted(quadrant),
        "transition": transition, "min_streak": min_streak, "min_turnover_idr": min_turnover_idr,
        "ret_positive_only": ret_positive_only, "only_partial": only_partial, "sort": sort, "dir": dir, "limit": limit, "offset": offset,
    }
    cached = cache.get("sectors/summary", params, None)
    if cached is not None:
        return cached

    conn = db.connect()
    try:
        as_of = read.resolve_as_of(conn, timeframe, scope="sector", weighting=weighting, as_of=as_of)
        streaks = read.streak_map(conn)
        items = [
            _summary_row(conn, dict(row), timeframe, weighting, streaks)
            for row in conn.execute(SUMMARY_SQL, (timeframe, weighting, as_of))
        ]

        wanted_sectors = read.split_multi(sector)
        wanted_quadrants = read.split_kwargs(quadrant)
        if wanted_sectors:
            items = [i for i in items if i["code"] in wanted_sectors]
        if wanted_quadrants:
            items = [i for i in items if i["quadrant"] in wanted_quadrants]
        if transition:
            items = [i for i in items if i["transition"] == transition]
        if min_streak:
            items = [i for i in items if i["streak_weeks"] >= int(min_streak)]
        if min_turnover_idr is not None:
            items = [i for i in items if (i["median_turnover_20d_idr"] or 0) >= int(min_turnover_idr)]
        if ret_positive_only:
            column = RETURN_COLUMN.get(window, "ret_3m")
            items = [i for i in items if (i[column] or 0) > 0]
        if only_partial:
            items = [i for i in items if i["partial"]]

        key = SORT_COLUMN.get(sort, "score")
        items.sort(key=lambda i: (i[key] is None, i[key] if i[key] is not None else 0), reverse=(dir != "asc"))
        total = len(items)
        page = items[int(offset) : int(offset) + int(limit)]

        body = {
            "api_version": _API_VERSION,
            "total": total,
            "limit": int(limit),
            "offset": int(offset),
            "items": page,
            "data_status": read.data_status(conn, as_of=as_of, timeframe=timeframe, weighting=weighting),
        }
    finally:
        conn.close()
    cache.put("sectors/summary", params, None, body)
    return body


@router.get("/sectors/{code}", response_model=SectorDetailResponse)
def sector_detail(
    code: str,
    timeframe: str = "d1",
    window: str = "3m",
    weighting: str | None = None,
    as_of: str | None = None,
    constituents_limit: int = 50,
    constituent_sort: str = "stock_score",
    min_turnover_idr: int | None = None,
    min_price_idr: int | None = None,
) -> dict:
    """Detail sektor: metrik + seri indeks + konstituen (tabel drill-down)."""
    cfg = get_settings()
    weighting = weighting or cfg.universe["weighting"]
    _check(timeframe, weighting, cfg)
    code = code.upper()

    conn = db.connect()
    try:
        as_of = read.resolve_as_of(conn, timeframe, scope="sector", weighting=weighting, as_of=as_of)
        streaks = read.streak_map(conn)
        rows = [dict(r) for r in conn.execute(SUMMARY_SQL, (timeframe, weighting, as_of))]
        row = next((r for r in rows if r["code"] == code), None)
        if row is None:
            raise HTTPException(404, {"code": "not_found", "message": f"sektor {code} tidak ada pada {as_of}", "detail": {"code": code}})

        summary = _summary_row(conn, row, timeframe, weighting, streaks)
        start = read.window_start(as_of, window)
        series = [
            {"date": r["date"], "index_close": r["index_close"], "ret_1d": r["ret_1d"]}
            for r in conn.execute(
                "SELECT date, index_close, ret_1d FROM sector_index_daily WHERE sector_id = (SELECT id FROM sector WHERE code = ?)"
                " AND weighting = ? AND date BETWEEN ? AND ? ORDER BY date",
                (code, weighting, start, as_of),
            )
        ]

        constituents = [dict(r) for r in conn.execute(CONSTITUENTS_SQL, (_sector_id(conn, code), timeframe, timeframe))]
        if min_turnover_idr is not None:
            constituents = [c for c in constituents if (c["median_turnover_20d_idr"] or 0) >= int(min_turnover_idr)]
        if min_price_idr is not None:
            constituents = [c for c in constituents if (c["close"] or 0) >= float(min_price_idr)]
        sort_key = {"rs_ratio": "rs_ratio", "ret_1w": "ret_5d", "close": "close", "ticker": "ticker", "median_turnover_20d_idr": "median_turnover_20d_idr"}.get(
            constituent_sort, "stock_score"
        )
        constituents.sort(key=lambda c: (c[sort_key] is None, c[sort_key] if c[sort_key] is not None else 0), reverse=sort_key != "ticker")

        body = {
            "api_version": _API_VERSION,
            "sector": {"code": code, "name_id": summary["name_id"], "color_hex": summary["color_hex"]},
            "metrics": {
                "quadrant": summary["quadrant"],
                "rs_ratio": summary["rs_ratio"],
                "rs_momentum": summary["rs_momentum"],
                "ret_1w": summary["ret_1w"],
                "score": summary["score"],
                "streak_weeks": summary["streak_weeks"],
                "constituents_count": summary["constituents_count"],
                "advancers": summary["advancers"],
                "decliners": summary["decliners"],
            },
            "series": series,
            "constituents": {
                "total": len(constituents),
                "items": [
                    {
                        "ticker": c["ticker"],
                        "name": c["name"],
                        "close": c["close"],
                        "ret_1d": c["ret_1d"],
                        "ret_1w": c["ret_5d"],
                        "median_turnover_20d_idr": c["median_turnover_20d_idr"],
                        "rs_ratio": c["rs_ratio"],
                        "rs_momentum": c["rs_momentum"],
                        "quadrant": c["quadrant"],
                        "stock_score": c["stock_score"],
                        "rsi14": c["rsi14"],
                        "atr14": c["atr14"],
                    }
                    for c in constituents[: int(constituents_limit)]
                ],
            },
            "data_status": read.data_status(conn, as_of=as_of, timeframe=timeframe, weighting=weighting),
        }
    finally:
        conn.close()
    return body


def _sector_id(conn, code: str) -> int:
    return conn.execute("SELECT id FROM sector WHERE code = ?", (code,)).fetchone()[0]
