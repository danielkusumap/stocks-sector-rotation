"""Endpoint analisa satu saham (docs/05 §2 `/plan/stock/{ticker}`, rumus docs/03 §6.5).

Membaca baris `stock_plan` — **satu sumber kebenaran** bersama `/series/stock` (B19): rezim & level tidak
dihitung ulang di sini. Angka ambang hanya dari `config` (`ta.*`, `weekly.plan.*`).
"""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException

from .. import db
from ..compute import plan as plan_compute
from ..config import get_settings
from ..labels import REGIME_LABEL
from ..repo import read
from .schemas import PlanStockResponse

router = APIRouter(prefix="/api/v1", tags=["plan"])
_API_VERSION = get_settings().app.api_version
PRICE_BASIS = "adj_close"  # docs/03 §10: selalu harga penyesuaian

HEAD_SQL = """
    SELECT st.ticker, st.name, st.board, sec.code AS sector_code
    FROM stock st JOIN sector sec ON sec.id = st.sector_id
    WHERE st.ticker = ?
"""
PRICE_SQL = """
    SELECT adj_close FROM price_daily
    WHERE ticker = ? AND adj_close IS NOT NULL ORDER BY date DESC LIMIT 2
"""


def _levels_table(plan: dict | None, metrics: dict, bars, cfg) -> list[dict]:
    """Daftar level dengan **urutan tetap** (docs/05 §2) supaya UI tidak merakit ulang."""
    rows: list[dict] = []
    if plan:
        rows.append({"label": "Zona beli", "low": plan["entry_zone"]["low"], "high": plan["entry_zone"]["high"]})
        rows.append({"label": "Batas rugi", "level": plan["stop"]["level"]})
        rows.append({"label": "Target 1", "level": plan["tp1"]["level"]})
        rows.append({"label": "Target 2", "level": plan["tp2"]["level"]})
    if metrics.get("sma20") is not None:
        rows.append({"label": "Penyangga 20 hari", "level": round(metrics["sma20"], 2)})
    if metrics.get("sma50") is not None:
        rows.append({"label": "Penyangga 50 hari", "level": round(metrics["sma50"], 2)})
    if len(bars):
        highs = bars["high"].astype(float)
        lows = bars["low"].astype(float)
        fast, slow = cfg.weekly["plan"]["donchian_fast"], cfg.weekly["plan"]["donchian_slow"]
        rows.append({"label": f"Puncak {fast} hari", "level": round(float(highs.iloc[-fast:].max()), 2)})
        rows.append({"label": f"Puncak {slow} hari", "level": round(float(highs.iloc[-slow:].max()), 2)})
        # shortcut: "terendah 10 hari" = setengah jendela puncak cepat; tambah kunci config bila perlu diubah.
        rows.append({"label": f"Terendah {fast // 2} hari", "level": round(float(lows.iloc[-fast // 2 :].min()), 2)})
    return rows


@router.get("/plan/stock/{ticker}", response_model=PlanStockResponse)
def plan_stock(ticker: str, as_of: str | None = None) -> dict:
    """Rezim + plan + skenario historis + ringkasan + tabel level satu saham (docs/05 §2)."""
    cfg = get_settings()
    ticker = ticker.upper()
    conn = db.connect()
    try:
        head = conn.execute(HEAD_SQL, (ticker,)).fetchone()
        if head is None:
            raise HTTPException(
                404, {"code": "not_found", "message": f"saham {ticker} tidak ada", "detail": {"ticker": ticker}}
            )
        row = plan_compute.stock_plan_row(conn, ticker, as_of)
        prices = [price[0] for price in conn.execute(PRICE_SQL, (ticker,))]
        bars = plan_compute.load_bars(conn, ticker, as_of or plan_compute.FAR_FUTURE)
        metrics = plan_compute.indicators_from_bars(bars, cfg) if len(bars) else {}
        plan = json.loads(row["plan_json"]) if row and row["plan_json"] else None
        code = (row or {}).get("regime") or "tidak_cukup_data"
        close, prev = (prices[0] if prices else None), (prices[1] if len(prices) > 1 else None)
        summaries = (
            json.loads(row["summary_lines"]) if row and row["summary_lines"] else [_summary_fallback(len(bars))]
        )
        stats = (
            {
                "p_tp1_first": row["p_tp1_first"],
                "p_sl_first": row["p_sl_first"],
                "p_timeout": row["p_timeout"],
                "p_tp2_first": row["p_tp2_first"],
                "median_periods_tp1": row["median_periods_tp1"],
                "median_periods_sl": row["median_periods_sl"],
                "n_events": row["n_events"] or 0,
                "n_open_dikeluarkan": 0,
                "basis": plan_compute.scenario_basis(cfg),
            }
            if row and row["p_tp1_first"] is not None
            else None
        )
        body = {
            "api_version": _API_VERSION,
            "as_of": (row or {}).get("as_of_date"),
            "stock": {
                "ticker": head["ticker"],
                "name": head["name"],
                "sector_code": head["sector_code"],
                "board": head["board"],
            },
            "price": {
                "close": close,
                "prev_close": prev,
                "ret_1d": round(close / prev - 1, 4) if close and prev else None,
                "price_basis": PRICE_BASIS,
            },
            "regime": {
                "code": code,
                "label": REGIME_LABEL.get(code, code),
                "reason": (plan or {}).get("regime_reason") or plan_compute.REGIME_REASON.get(code),
                "active_tools": (plan or {}).get("active_tools", []),
            },
            "summary_lines": summaries,
            "plan": plan,
            "scenario": stats,
            "levels_table": _levels_table(plan, metrics, bars, cfg),
            "coverage": {
                "bars_available": len(bars),
                "bars_from": str(bars["date"].iloc[0]) if len(bars) else None,
                "bars_to": str(bars["date"].iloc[-1]) if len(bars) else None,
                "n_events": (row or {}).get("n_events") or 0,
                "price_basis": PRICE_BASIS,
            },
            "data_status": read.data_status(
                conn,
                as_of=as_of or (row or {}).get("as_of_date"),
                timeframe="d1",
                weighting=cfg.universe["weighting"],
            ),
        }
        return body
    finally:
        conn.close()


def _summary_fallback(bars_available: int) -> str:
    """Kalimat pengganti bila `stock_plan` belum dihitung (mis. `stage=ta` belum pernah dijalankan)."""
    return (
        f"Riwayat harga {bars_available} bar — analisa teknikal belum dihitung untuk saham ini."
    )
