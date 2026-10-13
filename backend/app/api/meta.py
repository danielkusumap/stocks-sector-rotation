"""Endpoint baca meta & kesegaran data (docs/05 §1)."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query

from .. import cache, db
from ..config import get_settings
from ..ingest import freshness, prices
from ..repo import read
from .rrg import _check
from .schemas import FreshnessResponse, MarketQuoteResponse, MetaConfigResponse, MetaDatesResponse, MetaSectorsResponse

router = APIRouter(prefix="/api/v1", tags=["meta"])
_API_VERSION = get_settings().app.api_version
# `GET /meta/market` baru di kontrak docs/05 §1 → api_version 1.1 (field baru, aditif).
MARKET_API_VERSION = "1.1"
LIVE_FAILED_DETAIL = "live gagal, memakai data tersimpan"
# `price_daily` hanya menyimpan tanggal (tanpa jam) → bar harian dianggap penutupan sesi 16:00 WIB.
BAR_CLOSE_TIME = "16:00:00+07:00"

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
        "market": {
            "live_enabled": cfg.market.live_enabled,
            "live_ttl_seconds": cfg.market.live_ttl_seconds,
            "poll_seconds": cfg.market.poll_seconds,
            "move_flat_pct": cfg.market.move_flat_pct,
        },
        "last_ingest": last,
        "ta": {
            "ma_periods": cfg.ta["ma_periods"],
            "ma_default": cfg.ta["ma_default"],
            "trend_filter": cfg.ta["trend_filter"],
            "trend_filter_period": cfg.ta["trend_filter_period"],
            "target_pct": cfg.ta["target_pct"],
            "timeout_periods": cfg.ta["timeout_periods"],
            "min_history": cfg.ta["min_history"],
            "entry_basis": cfg.ta["entry_basis"],
        },
    }


# --- §1 kutipan IHSG live (hanya benchmark) ------------------------------------
# docs/05 §1: endpoint ringan yang dipoll UI (poll_seconds dari config), HANYA IHSG, tanpa tulis DB.

MARKET_BARS_SQL = """
    SELECT date, open, high, low, close, volume FROM price_daily
    WHERE ticker = ? ORDER BY date DESC LIMIT 6
"""


def session_now(tz: str) -> str:
    """`open` (09:00–12:00 / 13:30–16:00 WIB) · `break` (12:00–13:30) · `closed` (docs/05 §1)."""
    clock = datetime.now(ZoneInfo(tz)).strftime("%H:%M")
    if "09:00" <= clock < "12:00" or "13:30" <= clock < "16:00":
        return "open"
    if "12:00" <= clock < "13:30":
        return "break"
    return "closed"


def _to_wib(stamp, tz: str):
    return stamp.tz_convert(tz) if getattr(stamp, "tzinfo", None) else stamp


def _volume(value) -> int | None:
    """Volume dari Yahoo bisa NaN → `None` (bukan 0), sesuai konvensi `docs/05`."""
    number = prices._opt(value)
    return int(number) if number is not None else None


def _live_bars(symbol: str, interval: str, cfg):
    """Bar `^JKSE` dari Yahoo (read-only). `None` = gagal total."""
    df = prices.fetch(
        [symbol],
        "",
        "",
        retries=cfg.ingest["retries"],
        backoff=cfg.ingest["backoff_seconds"],
        interval=interval,
        period="1mo" if interval == "1d" else "1d",
    )
    sub = prices.frame_for(df, symbol) if df is not None else None
    if sub is None or sub.empty:
        return None
    sub = sub.dropna(subset=["Close"])
    return None if sub.empty else sub


def _live_quote(symbol: str, session: str, cfg) -> dict | None:
    """Kutipan terakhir `^JKSE`: bar 1d + 1×5m saat jam bursa. Tidak menyentuh DB."""
    daily = _live_bars(symbol, "1d", cfg)
    if daily is None:
        return None
    last, prev = daily.iloc[-1], (daily.iloc[-2] if len(daily) > 1 else None)
    week = daily.iloc[-6] if len(daily) > 5 else None
    close = float(last["Close"])
    stamp = _to_wib(last.name, cfg.app.timezone)
    prev_close = float(prev["Close"]) if prev is not None else None
    last_bar_at = f"{stamp.strftime('%Y-%m-%d')}T{BAR_CLOSE_TIME}"
    if session == "open":  # harga berjalan lebih segar dari bar harian Yahoo
        intraday = _live_bars(symbol, "5m", cfg)
        if intraday is not None:
            bar = intraday.iloc[-1]
            close, stamp = float(bar["Close"]), _to_wib(bar.name, cfg.app.timezone)
            last_bar_at = stamp.isoformat()
    ret_1d = close / prev_close - 1 if close and prev_close else None
    week_close = float(week["Close"]) if week is not None else None
    return {
        "close": close,
        "prev_close": prev_close,
        "ret_1d": ret_1d,
        "ret_1w": close / week_close - 1 if close and week_close else None,
        "ret_intraday": ret_1d if session == "open" else None,
        "open": prices._opt(last.get("Open")),
        "high": prices._opt(last.get("High")),
        "low": prices._opt(last.get("Low")),
        "volume": _volume(last.get("Volume")),
        "as_of": stamp.strftime("%Y-%m-%d"),
        "last_bar_at": last_bar_at,
    }


def _db_quote(conn, ticker: str, session: str) -> dict:
    """Bar terakhir dari `price_daily` (`live=false`): close/prev_close + 1 minggu untuk `ret_1w`."""
    rows = conn.execute(MARKET_BARS_SQL, (ticker,)).fetchall()
    if not rows:
        return {
            "close": None, "prev_close": None, "ret_1d": None, "ret_1w": None, "ret_intraday": None,
            "open": None, "high": None, "low": None, "volume": None, "as_of": None, "last_bar_at": None,
        }
    last = rows[0]
    prev = rows[1] if len(rows) > 1 else None
    week = rows[5] if len(rows) > 5 else None
    close, prev_close = last["close"], prev["close"] if prev else None
    week_close = week["close"] if week else None
    ret_1d = close / prev_close - 1 if close and prev_close else None
    return {
        "close": close,
        "prev_close": prev_close,
        "ret_1d": ret_1d,
        "ret_1w": close / week_close - 1 if close and week_close else None,
        "ret_intraday": ret_1d if session == "open" else None,
        "open": last["open"],
        "high": last["high"],
        "low": last["low"],
        "volume": last["volume"],
        "as_of": last["date"],
        "last_bar_at": f"{last['date']}T{BAR_CLOSE_TIME}",
    }


def _market_body(conn, cfg, *, quote: dict, session: str, source: str, status: str | None = None, detail: str | None = None) -> dict:
    block = read.data_status(conn, as_of=quote["as_of"], timeframe="d1", weighting=cfg.universe["weighting"])
    if status:
        block["status"] = status
    if detail:
        block["detail"] = detail
    return {
        "api_version": MARKET_API_VERSION,
        "benchmark": cfg.ingest["benchmark_alias"],
        "symbol": cfg.ingest["benchmark_ticker"],
        **quote,
        "session": session,
        "source": source,
        "delayed": True,  # feed Yahoo untuk IDX selalu delay (docs/05 §1)
        "cached": False,
        "cache_age_s": 0,
        "data_status": block,
    }


@router.get("/meta/market", response_model=MarketQuoteResponse)
def meta_market(live: bool = False) -> dict:
    """Kutipan IHSG (hanya benchmark). `live=true` ambil Yahoo + cache TTL, tanpa tulis DB."""
    cfg = get_settings()
    symbol = cfg.ingest["benchmark_ticker"]
    ticker = cfg.ingest["benchmark_alias"]
    session = session_now(cfg.app.timezone)
    params = {"live": bool(live)}
    want_live = bool(live) and cfg.market.live_enabled
    if want_live:
        cached = cache.get("meta/market", params, None)
        if cached is not None:
            age = cache.age("meta/market", params, None, cfg.market.live_ttl_seconds)
            return {**cached, "cached": True, "cache_age_s": age}

    conn = db.connect()
    try:
        if want_live:
            quote = _live_quote(symbol, session, cfg)
            if quote is not None:
                body = _market_body(conn, cfg, quote=quote, session=session, source="live", status="ok")
                cache.put("meta/market", params, None, body, ttl=cfg.market.live_ttl_seconds)
                return body
            # fetch gagal bukan error: pakai DB + tandai stale (docs/05 §1)
            return _market_body(
                conn,
                cfg,
                quote=_db_quote(conn, ticker, session),
                session=session,
                source="db",
                status="stale",
                detail=LIVE_FAILED_DETAIL,
            )
        return _market_body(conn, cfg, quote=_db_quote(conn, ticker, session), session=session, source="db")
    finally:
        conn.close()


@router.get("/freshness", response_model=FreshnessResponse)
def get_freshness() -> dict:
    """Status gate `midday` + kesegaran bar harian. Selalu 200 — kesegaran ada di body."""
    conn = db.connect()
    try:
        data = freshness.read(conn)
    finally:
        conn.close()
    return {"api_version": _API_VERSION, **data}
