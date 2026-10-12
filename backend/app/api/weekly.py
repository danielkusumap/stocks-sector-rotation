"""Endpoint sinyal mingguan (docs/05 §3) — dipakai halaman Weekly (F9)."""

from __future__ import annotations

from fastapi import APIRouter, Query

from .. import db
from ..compute import signals
from ..config import get_settings
from .schemas import WeeklyPicksResponse

router = APIRouter(prefix="/api/v1", tags=["weekly"])
_API_VERSION = get_settings().app.api_version

WEEK_SQL = "SELECT MAX(week_end) FROM signal_weekly"
SECTORS_SQL = """
    SELECT w.ref_id, s.name_id AS name, w.rank, w.score, w.streak_weeks, w.rule_hits, w.rationale, w.week_end
    FROM signal_weekly w JOIN sector s ON s.id = w.sector_id
    WHERE w.scope = 'sector' AND w.streak_weeks >= ? AND w.week_end = ?
    ORDER BY w.rank
"""
STOCKS_SQL = """
    SELECT w.ref_id AS ticker, st.name, sec.code AS sector_code, w.rank, w.score, w.streak_weeks,
           w.entry_ref, w.stop, w.target, w.atr14, w.lots_hint, w.rule_hits, w.rationale, w.week_end
    FROM signal_weekly w
    JOIN stock st ON st.ticker = w.ref_id
    JOIN sector sec ON sec.id = st.sector_id
    WHERE w.scope = 'stock' AND w.streak_weeks >= ? AND w.week_end = ?
    ORDER BY w.rank
"""


@router.get("/weekly/picks", response_model=WeeklyPicksResponse)
def weekly_picks(
    week_end: str | None = None,
    scope: str = "sector,stock",
    min_streak: int = 1,
    limit: int = Query(50, ge=1, le=500),
) -> dict:
    """Sinyal minggu final terakhir (default). `is_final` menandai minggu sudah ditutup Jumat."""
    import json

    conn = db.connect()
    try:
        week = week_end or conn.execute(WEEK_SQL).fetchone()[0]
        if week is None:
            return {"api_version": _API_VERSION, "week_end": None, "is_final": False, "sectors": [], "stocks": []}
        final_weeks = set(signals.weekly_calendar(conn, get_settings().ingest["benchmark_alias"]))
        wants = {s.strip() for s in scope.split(",") if s.strip()}
        sectors = [
            {**dict(r), "rule_hits": json.loads(r["rule_hits"]) if r["rule_hits"] else {}}
            for r in conn.execute(SECTORS_SQL, (min_streak, week))
        ] if "sector" in wants else []
        stocks = [
            {**dict(r), "rule_hits": json.loads(r["rule_hits"]) if r["rule_hits"] else {}}
            for r in conn.execute(STOCKS_SQL, (min_streak, week))
        ] if "stock" in wants else []
    finally:
        conn.close()

    return {
        "api_version": _API_VERSION,
        "week_end": week,
        "is_final": week in final_weeks,
        "sectors": sectors[:limit],
        "stocks": stocks[:limit],
    }
