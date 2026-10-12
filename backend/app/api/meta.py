"""Endpoint baca meta & kesegaran data (docs/05 §1)."""

from __future__ import annotations

from fastapi import APIRouter, Query

from .. import cache, db
from ..config import get_settings
from ..ingest import freshness
from .rrg import _check
from .schemas import FreshnessResponse, MetaConfigResponse, MetaDatesResponse, MetaSectorsResponse

router = APIRouter(prefix="/api/v1", tags=["meta"])
_API_VERSION = get_settings().app.api_version

# `GET /meta/dates` (docs/05 §1: api_version 1.1) — tanggal yang benar-benar punya hasil hitung.
DATES_SQL = "SELECT DISTINCT as_of_date FROM rrg_daily WHERE timeframe = ? ORDER BY as_of_date DESC LIMIT ?"
DATES_FALLBACK_SQL = "SELECT DISTINCT as_of_date FROM sector_metrics WHERE timeframe = ? ORDER BY as_of_date DESC LIMIT ?"

SECTORS_SQL = """
    SELECT s.code, s.name_id, s.name_en, s.color_hex, s.sort_order,
           (SELECT COUNT(*) FROM stock st WHERE st.sector_id = s.id AND st.is_active = 1) AS constituents_active
    FROM sector s WHERE s.is_active = 1 ORDER BY s.sort_order
"""
# `last_ingest` (docs/05 §1) dipetakan dari kind `ingest_run`.
LAST_INGEST_KINDS = {"prices_daily": "prices_daily", "intraday": "prices_intraday", "signals_weekly": "compute_signals"}


def color_token(code: str) -> str:
    """Token warna CSS sektor (`docs/05` §1) — turunan kode, bukan kolom DB (ADR-023)."""
    return "sector-" + code.removeprefix("IDX").lower()


@router.get("/meta/sectors", response_model=MetaSectorsResponse)
def meta_sectors() -> dict:
    """11 sektor + token warna + jumlah konstituen aktif (legenda & heatmap)."""
    conn = db.connect()
    try:
        items = [
            {
                "code": row["code"],
                "name_id": row["name_id"],
                "name_en": row["name_en"],
                "color_token": color_token(row["code"]),
                "color_hex": row["color_hex"],
                "sort_order": row["sort_order"],
                "constituents_active": row["constituents_active"],
            }
            for row in conn.execute(SECTORS_SQL)
        ]
    finally:
        conn.close()
    return {"api_version": _API_VERSION, "items": items}


@router.get("/meta/dates", response_model=MetaDatesResponse)
def meta_dates(timeframe: str = "d1", limit: int = Query(120, ge=1, le=400)) -> dict:
    """Tanggal yang punya hasil hitung untuk `AsOfPicker` (docs/05 §1). Daftar kosong bukan error."""
    cfg = get_settings()
    _check(timeframe, cfg.universe["weighting"], cfg)
    params = {"timeframe": timeframe, "limit": limit}
    cached = cache.get("meta/dates", params, None)
    if cached is not None:
        return cached

    conn = db.connect()
    try:
        dates = [row[0] for row in conn.execute(DATES_SQL, (timeframe, limit))]
        if not dates:  # fallback: hasil hitung sektor tanpa RRG (docs/05 §1)
            dates = [row[0] for row in conn.execute(DATES_FALLBACK_SQL, (timeframe, limit))]
    finally:
        conn.close()
    body = {"api_version": "1.1", "timeframe": timeframe, "latest": dates[0] if dates else None, "dates": dates}
    cache.put("meta/dates", params, None, body)
    return body


@router.get("/meta/config", response_model=MetaConfigResponse)
def meta_config() -> dict:
    """Ambang batas yang benar-benar dipakai server + waktu ingest terakhir."""
    cfg = get_settings()
    conn = db.connect()
    try:
        last = {
            key: (conn.execute("SELECT MAX(finished_at) FROM ingest_run WHERE kind = ?", (kind,)).fetchone() or [None])[0]
            for key, kind in LAST_INGEST_KINDS.items()
        }
    finally:
        conn.close()
    return {
        "api_version": _API_VERSION,
        "universe": {
            "min_turnover_idr": cfg.universe["min_turnover_idr"],
            "min_price_idr": cfg.universe["min_price_idr"],
            "max_rsi": cfg.universe["max_rsi"],
        },
        "rrg": {
            "ema_span": cfg.rrg["ema_span"],
            "roc_lag": cfg.rrg["roc_lag"],
            "weekly": cfg.rrg["weekly"],
            "min_points": cfg.rrg["min_points"],
        },
        "timeframes": cfg.timeframes["allowed"],
        "windows": cfg.windows["allowed"],
        "midday_gate_min_bar_time": cfg.midday["gate_min_bar_time"],
        "last_ingest": last,
    }


@router.get("/freshness", response_model=FreshnessResponse)
def get_freshness() -> dict:
    """Status gate `midday` + kesegaran bar harian. Selalu 200 — kesegaran ada di body."""
    conn = db.connect()
    try:
        data = freshness.read(conn)
    finally:
        conn.close()
    return {"api_version": _API_VERSION, **data}
