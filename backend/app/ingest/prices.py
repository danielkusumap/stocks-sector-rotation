"""Ingest harga harian Yahoo → `price_daily` (docs/02 §1 & §7, docs/07 B2).

Batching 50 ticker/panggilan + jeda + retry; bar yang sudah ada ditimpa (upsert), jadi
ingest ulang hari yang sama tidak menggandakan baris. Kalau Yahoo gagal, data lama dibiarkan.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import yfinance as yf

from .. import db
from ..config import get_settings
from ..db import now_iso

Fields = tuple[str, str, str, str, float, float, float, int, int, str, str]  # baris price_daily


def _chunks(items: list, size: int) -> list[list]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def resolve_symbols(conn, *, tickers=None, sectors=None) -> list[tuple[str, str]]:
    """(ticker, yahoo_symbol) dari universe aktif — atau daftar eksplisit kalau `tickers` diisi.

    Benchmark (IHSG) selalu ikut: dipakai RRG sebagai acuan.
    """
    cfg = get_settings()
    bench = (cfg.ingest["benchmark_alias"], cfg.ingest["benchmark_ticker"])

    if tickers:
        symbols = [
            (t.strip().upper().removesuffix(".JK"), t.strip().upper() if t.upper().endswith(".JK") else f"{t.strip().upper()}.JK")
            for t in tickers
            if t.strip()
        ]
        return [bench, *symbols] if bench not in symbols else symbols

    rows = conn.execute(
        """
        SELECT st.ticker, st.yahoo_symbol, sec.code AS sector_code
        FROM stock st JOIN sector sec ON sec.id = st.sector_id
        WHERE st.is_active = 1
        ORDER BY st.ticker
        """
    ).fetchall()
    if sectors:
        want = {s.strip().upper() for s in sectors}
        rows = [r for r in rows if r["sector_code"] in want]
    return [bench, *[(r["ticker"], r["yahoo_symbol"]) for r in rows if r["ticker"] != bench[0]]]


def fetch(
    symbols: list[str],
    start: str,
    end: str,
    *,
    retries: int,
    backoff: float,
    interval: str = "1d",
    period: str | None = None,
) -> pd.DataFrame | None:
    """`yf.download` batch dengan retry+backoff. `None` = gagal total (bukan exception ke pemanggil)."""
    for attempt in range(retries):
        try:
            window = {"period": period} if period else {"start": start, "end": end}  # yfinance: `end` eksklusif
            return yf.download(
                symbols,
                interval=interval,
                auto_adjust=False,  # butuh Close mentah + Adj Close
                group_by="ticker",
                progress=False,
                threads=True,
                **window,
            )
        except Exception:
            if attempt == retries - 1:
                return None
            time.sleep(backoff)
    return None


def frame_for(df: pd.DataFrame, symbol: str) -> pd.DataFrame | None:
    if isinstance(df.columns, pd.MultiIndex):
        return df[symbol] if symbol in df.columns.get_level_values(0) else None
    return df  # satu simbol saja → kolom tidak bertingkat


def session_of(stamp) -> str | None:
    """Sesi bar menurut jam WIB (docs/02 §5). Di luar jam bursa → `None` (tidak disimpan)."""
    t = stamp.strftime("%H:%M")
    if "09:00" <= t < "12:00" or "13:30" <= t < "16:00":
        return "regular"
    if "16:00" <= t < "16:15":
        return "post"  # post-trading: disimpan untuk audit, tidak dipakai hitung
    return None


def _bars(df: pd.DataFrame | None, symbol: str, tz: str) -> list[tuple]:
    """Baris `price_daily` untuk satu simbol; bar tanpa harga penutupan dibuang."""
    if df is None or df.empty:
        return []
    sub = frame_for(df, symbol)
    if sub is None or sub.empty:
        return []
    sub = sub.dropna(subset=["Close"])
    ts_now = now_iso()
    out = []
    for ts, row in sub.iterrows():
        stamp = ts.tz_convert(tz) if getattr(ts, "tzinfo", None) else ts
        day = stamp.date().isoformat()
        close = float(row["Close"])
        volume = 0 if pd.isna(row.get("Volume")) else int(row["Volume"])
        adj = row.get("Adj Close")
        out.append(
            (
                day,
                _opt(row.get("Open")),
                _opt(row.get("High")),
                _opt(row.get("Low")),
                close,
                None if adj is None or pd.isna(adj) else float(adj),
                volume,
                int(close * volume),  # value_idr: dihitung saat ingest (docs/04 §3)
                "yfinance",
                ts_now,
            )
        )
    return out


def _opt(v) -> float | None:
    return None if v is None or pd.isna(v) else float(v)


def upsert_bars(conn, ticker: str, bars: list[tuple]) -> int:
    conn.executemany(
        """
        INSERT INTO price_daily (ticker, date, open, high, low, close, adj_close, volume, value_idr, source, ingested_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ticker, date) DO UPDATE SET
          open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close,
          adj_close = excluded.adj_close, volume = excluded.volume, value_idr = excluded.value_idr,
          source = excluded.source, ingested_at = excluded.ingested_at
        """,
        [(ticker, *bar) for bar in bars],
    )
    return len(bars)


def upsert_intraday_bars(conn, ticker: str, bars: list[tuple]) -> int:
    conn.executemany(
        """
        INSERT INTO price_intraday (ticker, ts, interval, open, high, low, close, volume, session, ingested_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ticker, ts, interval) DO UPDATE SET
          open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close,
          volume = excluded.volume, session = excluded.session, ingested_at = excluded.ingested_at
        """,
        [(ticker, *bar) for bar in bars],
    )
    return len(bars)


def _intraday_bars(df: pd.DataFrame | None, symbol: str, tz: str, interval: str) -> list[tuple]:
    """Baris `price_intraday` — hanya jam bursa (reguler + post), lihat `session_of`."""
    if df is None or df.empty:
        return []
    sub = frame_for(df, symbol)
    if sub is None or sub.empty:
        return []
    ts_now = now_iso()
    out = []
    for ts, row in sub.dropna(subset=["Close"]).iterrows():
        stamp = ts.tz_convert(tz) if getattr(ts, "tzinfo", None) else ts
        session = session_of(stamp)
        if session is None:
            continue
        close = float(row["Close"])
        out.append(
            (
                stamp.isoformat(timespec="seconds"),
                interval,
                _opt(row.get("Open")),
                _opt(row.get("High")),
                _opt(row.get("Low")),
                close,
                0 if pd.isna(row.get("Volume")) else int(row["Volume"]),
                session,
                ts_now,
            )
        )
    return out


def ingest_intraday(*, tickers=None, sectors=None, db_path=None, report=None) -> dict:
    """Unduh bar intraday (5m & 60m dari config) untuk hari berjalan. Tanpa `rows_total` → UI pakai spinner."""
    cfg = get_settings()
    tz = cfg.app.timezone
    conn = db.connect(db_path)
    try:
        universe = resolve_symbols(conn, tickers=tickers, sectors=sectors)
        intervals = cfg.ingest["intraday_intervals"]
        stored = 0
        sessions = {"regular": 0, "post": 0}
        failed: list[str] = []
        ingested: list[str] = []

        for interval in intervals:
            batches = _chunks(universe, cfg.ingest["batch_size"])
            for i, batch in enumerate(batches, start=1):
                df = fetch(
                    [sym for _, sym in batch],
                    "",
                    "",
                    retries=cfg.ingest["retries"],
                    backoff=cfg.ingest["backoff_seconds"],
                    interval=interval,
                    period="1d",  # hanya hari berjalan; riwayat intraday Yahoo terbatas
                )
                for ticker, symbol in batch:
                    bars = _intraday_bars(df, symbol, tz, interval)
                    if bars:
                        stored += upsert_intraday_bars(conn, ticker, bars)
                        sessions["post"] += sum(1 for b in bars if b[7] == "post")
                        sessions["regular"] += sum(1 for b in bars if b[7] == "regular")
                        if ticker not in ingested:
                            ingested.append(ticker)
                    elif ticker not in failed:
                        failed.append(ticker)
                conn.commit()
                if report:
                    first, last = batch[0][0], batch[-1][0]
                    report(rows=stored, phase="ingest_intraday", message=f"{interval} batch {i}/{len(batches)} (emiten {first}–{last})")
                if i < len(batches):
                    time.sleep(cfg.ingest["sleep_seconds"])

        return {
            "rows": stored,
            "intervals": intervals,
            "sessions": sessions,
            "tickers_ok": len(ingested),
            "tickers_total": len(universe),
            "failed_tickers": failed,
        }
    finally:
        conn.close()


def refresh_derived(conn, tickers: list[str], ts: str) -> None:
    """`market_cap_idr` = shares_outstanding × close terakhir (tanpa `.info`), plus `last_bar_date`."""
    if not tickers:
        return
    conn.execute("CREATE TEMP TABLE _ingest_ticker (ticker TEXT PRIMARY KEY)")
    conn.executemany("INSERT OR IGNORE INTO _ingest_ticker (ticker) VALUES (?)", ((t,) for t in tickers))
    conn.execute(
        """
        UPDATE stock
        SET market_cap_idr = CAST(
              shares_outstanding * (SELECT p.close FROM price_daily p WHERE p.ticker = stock.ticker ORDER BY p.date DESC LIMIT 1)
              AS INTEGER),
            last_bar_date = (SELECT MAX(p.date) FROM price_daily p WHERE p.ticker = stock.ticker),
            updated_at = ?
        WHERE ticker IN (SELECT ticker FROM _ingest_ticker)
        """,
        (ts,),
    )


def refresh_yahoo_sector(conn, tickers: list[str], refresh_days: int) -> list[str]:
    """Cross-check klasifikasi Yahoo (`.info`, 1 request/emiten, maks sekali per `refresh_days` hari).

    Opt-in lewat `refresh_info=true`: 962 `.info` dalam satu klik UI = beberapa menit + risiko 429.
    """
    cutoff = (datetime.now() - timedelta(days=refresh_days)).date().isoformat()
    due = [
        r["ticker"]
        for r in conn.execute(
            "SELECT ticker FROM stock WHERE ticker IN (SELECT ticker FROM _ingest_ticker)"
            " AND (yahoo_sector_at IS NULL OR yahoo_sector_at < ?)",
            (cutoff,),
        )
    ]
    if not due:
        return []
    ts = now_iso()
    updated: list[str] = []
    for ticker in due:
        try:
            sector = yf.Ticker(f"{ticker}.JK").info.get("sector")
        except Exception:
            continue  # emiten tanpa `.info` bukan kegagalan ingest
        conn.execute("UPDATE stock SET yahoo_sector = ?, yahoo_sector_at = ? WHERE ticker = ?", (sector, ts, ticker))
        updated.append(ticker)
        conn.commit()
    return updated


def ingest_daily(
    *,
    from_date: str | None = None,
    to_date: str | None = None,
    sectors: list[str] | None = None,
    tickers: list[str] | None = None,
    refresh_info: bool = False,
    db_path=None,
    report=None,
) -> dict:
    """Unduh bar harian untuk seluruh/ sebagian universe. Kembalikan ringkasan + `failed_tickers`."""
    cfg = get_settings()
    tz = cfg.app.timezone
    today = datetime.now(ZoneInfo(tz)).date()
    end = datetime.fromisoformat(to_date).date() if to_date else today
    start = datetime.fromisoformat(from_date).date() if from_date else today - timedelta(days=cfg.ingest["daily_lookback_days"])

    conn = db.connect(db_path)
    try:
        universe = resolve_symbols(conn, tickers=tickers, sectors=sectors)
        batch_size = cfg.ingest["batch_size"]
        batches = _chunks(universe, batch_size)
        # perkiraan total bar untuk progress bar UI (docs/05 §4.3)
        rows_total = int(np.busday_count(start.isoformat(), (end + timedelta(days=1)).isoformat())) * len(universe)
        rows_done = 0
        ingested: list[str] = []
        failed: list[str] = []

        for i, batch in enumerate(batches, start=1):
            df = fetch(
                [sym for _, sym in batch],
                start.isoformat(),
                (end + timedelta(days=1)).isoformat(),
                retries=cfg.ingest["retries"],
                backoff=cfg.ingest["backoff_seconds"],
            )
            batch_ok = []
            for ticker, symbol in batch:
                bars = _bars(df, symbol, tz)
                if bars:
                    rows_done += upsert_bars(conn, ticker, bars)
                    ingested.append(ticker)
                    batch_ok.append(ticker)
                else:
                    failed.append(ticker)
            # data turunan ikut diperbarui per batch: run yang mati di tengah tetap meninggalkan
            # market_cap_idr/last_bar_date yang konsisten dengan bar yang sudah masuk.
            refresh_derived(conn, batch_ok, now_iso())
            conn.commit()
            if report:
                first, last = batch[0][0], batch[-1][0]
                report(
                    rows=rows_done,
                    rows_total=rows_total,
                    phase="ingest",
                    message=f"batch {i}/{len(batches)} (emiten {first}–{last})",
                )
            if i < len(batches):
                time.sleep(cfg.ingest["sleep_seconds"])

        info_refreshed = refresh_yahoo_sector(conn, ingested, cfg.ingest["refresh_market_cap_days"]) if refresh_info else []

        return {
            "rows": rows_done,
            "tickers_ok": len(ingested),
            "tickers_total": len(universe),
            "failed_tickers": failed,
            "from": start.isoformat(),
            "to": end.isoformat(),
            "yahoo_sector_refreshed": len(info_refreshed),
        }
    finally:
        conn.close()
