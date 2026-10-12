"""Endpoint baca meta & kesegaran data (docs/05 §1)."""

from __future__ import annotations

from fastapi import APIRouter

from .. import db
from ..config import get_settings
from ..ingest import freshness
from .schemas import MetaConfigResponse, MetaSectorsResponse

router = APIRouter(prefix="/api/v1", tags=["meta"])
_API_VERSION = get_settings().app.api_version

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


@router.get("/freshness")
def get_freshness() -> dict:
    """Status gate `midday` + kesegaran bar harian. Selalu 200 — kesegaran ada di body."""
    conn = db.connect()
    try:
        data = freshness.read(conn)
    finally:
        conn.close()
    return {"api_version": _API_VERSION, **data}
