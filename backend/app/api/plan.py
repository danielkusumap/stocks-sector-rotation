"""Endpoint analisa satu saham (docs/05 §2 `/plan/stock/{ticker}`, rumus docs/03 §6.5).

Membaca baris `stock_plan` — **satu sumber kebenaran** bersama `/series/stock` (B19): rezim & level tidak
dihitung ulang di sini. Angka ambang hanya dari `config` (`ta.*`, `weekly.plan.*`).
"""

from __future__ import annotations

import json

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from .. import db
from ..compute import indicators, plan as plan_compute, structure
from ..config import get_settings
from ..labels import REGIME_LABEL
from ..repo import read
from .rrg import _check
from .schemas import PlanStockResponse, SeriesStockResponse

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


# --- B19: bahan grafik candle + overlay TA (`/series/stock/{ticker}`, docs/05 §2, docs/06 §6.5) ---

# OHLC penyesuaian (ADR-040): `open`/`high`/`low` mentah diskalakan ke kerangka `adj_close`.
CANDLE_SQL = """
    SELECT date, adj_close AS close, volume,
           open * adj_close / NULLIF(close, 0) AS open,
           high * adj_close / NULLIF(close, 0) AS high,
           low  * adj_close / NULLIF(close, 0) AS low
    FROM price_daily
    WHERE ticker = ? AND adj_close IS NOT NULL AND close IS NOT NULL
    ORDER BY date
"""
STOCK_EVENTS_SERIES_SQL = """
    SELECT signal_date, entry_date, entry_price, result, periods, mfe_pct, mae_pct
    FROM ta_breakout
    WHERE scope = 'stock' AND ref_id = ? AND ma_period = ? AND trend_filter = ?
    ORDER BY signal_date
"""
MAX_BARS = 400
MAX_EVENTS = 100
LAYERS = ("indicators", "smc", "elliott")


def _num(value, digits: int = 2) -> float | None:
    """Angka bulat `digits` desimal; `None`/NaN tetap `None` (warmup tidak dikirim 0)."""
    return None if value is None or pd.isna(value) else round(float(value), digits)


def _points(series, dates) -> list[dict]:
    return [
        {"date": str(date), "value": _num(value, 4)}
        for date, value in zip(dates, series)
        if value is not None and not pd.isna(value)
    ]


def _channels(bars, close: float, cfg) -> list[dict]:
    """Kanal S/R dari pivot (docs/03 §6.4.9) — aturan kelompok sama dengan `plan.channels`."""
    plan_cfg = cfg.weekly["plan"]
    up_idx, low_idx = plan_compute.pivots(bars, plan_cfg["pivot_bars"])
    tolerance = plan_cfg["channel_tol_pct"] * close
    out: list[dict] = []
    for kind, indices, column in (("resistance", up_idx, "high"), ("support", low_idx, "low")):
        pairs = sorted((float(bars[column].iloc[index]), str(bars["date"].iloc[index])) for index in indices)
        groups: list[list[tuple[float, str]]] = []
        for pair in pairs:
            if groups and abs(pair[0] - groups[-1][-1][0]) <= tolerance:
                groups[-1].append(pair)
            else:
                groups.append([pair])
        for group in groups:
            if len(group) < cfg.chart["channel_min_strength"]:
                continue
            out.append(
                {
                    "low": round(min(item[0] for item in group), 2),
                    "high": round(max(item[0] for item in group), 2),
                    "strength": len(group),
                    "kind": kind,
                    "from": group[0][1],
                    "to": None,
                }
            )
    return out


def _indicators(bars, cfg, index) -> dict:
    """Lapisan `indicators` (docs/03 §11.1–§11.3) — dihitung dari harga penyesuaian, dipotong ke jendela."""
    close = bars["close"].astype(float)
    high, low, volume = bars["high"].astype(float), bars["low"].astype(float), bars["volume"].astype(float)
    ursi_cfg, vwap_cfg, poc_cfg = cfg.chart["ursi"], cfg.chart["vwap"], cfg.chart["poc"]
    line = indicators.ursi(close, ursi_cfg["len"], ursi_cfg["method"])
    signal = indicators.sma(line, ursi_cfg["signal_len"])

    anchor, start = vwap_cfg["anchor"], None
    if anchor == "pivot_low":
        lows = plan_compute.pivots(bars, cfg.weekly["plan"]["pivot_bars"])[1]
        start = lows[-1] if lows else None
    elif anchor == "quarter":
        last = str(bars["date"].iloc[-1])
        start = int(bars["date"].searchsorted(f"{last[:4]}-{((int(last[5:7]) - 1) // 3) * 3 + 1:02d}-01"))
    bands = indicators.vwap(high, low, close, volume, vwap_cfg["len"], tuple(vwap_cfg["band"]), start)
    profile = indicators.volume_profile(
        high, low, close, volume, poc_cfg["bins"], poc_cfg["bars"], poc_cfg["value_area"]
    )
    dates = bars["date"].loc[index]
    return {
        "ursi": {
            "len": ursi_cfg["len"],
            "method": ursi_cfg["method"],
            "ob": ursi_cfg["ob"],
            "os": ursi_cfg["os"],
            "points": [
                {"date": str(date), "value": _num(value, 2), "signal": _num(signal_value, 2)}
                for date, value, signal_value in zip(dates, line.loc[index], signal.loc[index])
                if not pd.isna(value)
            ],
        },
        "vwap": {
            "len": vwap_cfg["len"],
            "anchor": anchor,
            "anchor_date": str(bars["date"].iloc[start]) if start is not None else None,
            "points": [
                {
                    "date": str(date),
                    "vwap": _num(row["vwap"]),
                    "upper1": _num(row["upper1"]),
                    "lower1": _num(row["lower1"]),
                    "upper2": _num(row["upper2"]),
                    "lower2": _num(row["lower2"]),
                }
                for date, row in zip(dates, bands.loc[index].to_dict("records"))
                # VWAP valid setelah `len` bar; pita σ baru lengkap setelah `len` simpangan → titik parsial dibuang.
                if not pd.isna(row["vwap"]) and not pd.isna(row["upper1"])
            ],
        },
        "poc": {
            "basis": poc_cfg["basis"],
            "bars_used": min(poc_cfg["bars"], len(bars)),
            "bins": poc_cfg["bins"],
            "poc": profile["poc"],
            "value_area": profile["value_area"],
        },
    }


@router.get("/series/stock/{ticker}", response_model=SeriesStockResponse)
def stock_series(
    ticker: str,
    window: str = "6m",
    bars: int | None = None,
    ma: list[int] | None = Query(default=None),
    events: int | None = None,
    weighting: str | None = None,
    layers: list[str] | None = Query(default=None),
) -> dict:
    """Candle + overlay TA sesuai rezim (docs/05 §2).

    Level & rezim dibaca dari baris `stock_plan` yang sama dengan `/plan/stock` (satu sumber, B19 AC 9);
    indikator dihitung backend dari harga penyesuaian — frontend tidak menghitung apa pun.
    """
    cfg = get_settings()
    ticker = ticker.upper()
    n_bars = bars or cfg.chart["window_bars"]
    n_events = events or cfg.chart["events"]
    if n_bars > MAX_BARS:
        raise HTTPException(422, {"code": "invalid_bars", "message": f"bars maksimum {MAX_BARS}", "detail": {"bars": n_bars}})
    if n_events > MAX_EVENTS:
        raise HTTPException(422, {"code": "invalid_events", "message": f"events maksimum {MAX_EVENTS}", "detail": {"events": n_events}})
    # `layers` kosong eksplisit (`?layers=`) = matikan semua lapisan; tanpa parameter = default `indicators`.
    requested = [layer for layer in (layers or []) if layer]
    if layers is None:
        requested = ["indicators"]  # docs/05 §2: lapisan `indicators` menyala secara default (B21)
    unknown = [layer for layer in requested if layer not in LAYERS]
    if unknown:
        raise HTTPException(422, {"code": "invalid_layer", "message": "lapisan tidak dikenal", "detail": {"layers": unknown}})
    weighting = weighting or cfg.universe["weighting"]
    _check("d1", weighting, cfg)

    conn = db.connect()
    try:
        head = conn.execute(HEAD_SQL, (ticker,)).fetchone()
        if head is None:
            raise HTTPException(
                404, {"code": "not_found", "message": f"saham {ticker} tidak ada", "detail": {"ticker": ticker}}
            )
        all_bars = pd.read_sql(CANDLE_SQL, conn, params=(ticker,))
        row = plan_compute.stock_plan_row(conn, ticker)
        plan = json.loads(row["plan_json"]) if row and row["plan_json"] else None
        code = (row or {}).get("regime") or "tidak_cukup_data"

        visible = all_bars
        if len(all_bars):
            start = read.window_start(str(all_bars["date"].iloc[-1]), window)
            visible = all_bars[all_bars["date"] >= start] if start else all_bars
            visible = visible.iloc[-n_bars:]
        index = visible.index
        close = all_bars["close"].astype(float)

        def points(series) -> list[dict]:
            return _points(series.loc[index], all_bars["date"].loc[index])

        overlays = {
            "ma": {str(period): points(close.rolling(period).mean()) for period in (ma or cfg.ta["ma_periods"])},
            "donchian": {
                kind: {
                    "high": points(all_bars["high"].astype(float).rolling(period).max()),
                    "low": points(all_bars["low"].astype(float).rolling(period).min()),
                }
                for kind, period in (
                    ("fast", cfg.weekly["plan"]["donchian_fast"]),
                    ("slow", cfg.weekly["plan"]["donchian_slow"]),
                )
            },
            "channels": _channels(visible, float(close.iloc[-1]), cfg) if len(visible) else [],
            "volume_ma": points(all_bars["volume"].astype(float).rolling(cfg.chart["volume_ma"]).mean()),
        }
        body = {
            "api_version": _API_VERSION,
            "ticker": head["ticker"],
            "name": head["name"],
            "price_basis": PRICE_BASIS,
            "regime": code,
            "active_tools": (plan or {}).get("active_tools", []),
            "regime_reason": (plan or {}).get("regime_reason") or plan_compute.REGIME_REASON.get(code),
            "candles": [
                {
                    "date": str(bar["date"]),
                    "open": _num(bar["open"]),
                    "high": _num(bar["high"]),
                    "low": _num(bar["low"]),
                    "close": _num(bar["close"]),
                    "volume": int(bar["volume"]) if bar["volume"] is not None and not pd.isna(bar["volume"]) else None,
                }
                for bar in visible.to_dict("records")  # `iterrows()` jauh lebih mahal untuk 400 bar
            ],
            "overlays": overlays,
            "levels": (
                {
                    "week_end": row["as_of_date"],
                    "entry_zone": {"low": row["entry_zone_low"], "high": row["entry_zone_high"]},
                    "stop": row["stop"],
                    "tp1": row["tp1"],
                    "tp2": row["tp2"],
                    "rr_tp2": row["rr_tp2"],
                    "plan_ok": bool(row["plan_ok"]),
                }
                if row and row["entry_zone_low"] is not None
                else None
            ),
            "events": [
                dict(event)
                for event in conn.execute(
                    STOCK_EVENTS_SERIES_SQL, (ticker, cfg.ta["ma_default"], 1 if cfg.ta["trend_filter"] else 0)
                )
            ][-n_events:],
            "volume_confirm_mult": cfg.weekly["plan"]["volume_mult"],
            "layers": requested,
            "indicators": _indicators(all_bars, cfg, index) if len(visible) and "indicators" in requested else None,
            "smc": structure.smc_layers(all_bars, cfg) if len(visible) and "smc" in requested else None,
            "elliott": structure.elliott_layers(all_bars, cfg) if len(visible) and "elliott" in requested else None,
            "data_status": read.data_status(
                conn,
                as_of=(row or {}).get("as_of_date") or (str(visible["date"].iloc[-1]) if len(visible) else None),
                timeframe="d1",
                weighting=weighting,
            ),
        }
        return body
    finally:
        conn.close()
