"""Gate kesegaran data (docs/02 §5, docs/07 B3) — penentu boleh-tidaknya hitung `midday`.

Probe: bar 5m terakhir (volume > 0, sesi **reguler**) dari watchlist di config. Kalau bar
terakhir belum sampai `config.midday.gate_min_bar_time`, perhitungan tengah hari dibatalkan.
"""

from __future__ import annotations

import json
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from ..config import get_settings
from ..db import now_iso
from . import prices

GATE_KEY = "midday_gate"
DAILY_KEY = "daily_ingest"
INTRADAY_KEY = "intraday_ingest"


def last_regular_bar(df: pd.DataFrame | None, symbol: str, tz: str, day: str) -> str | None:
    """Timestamp bar reguler terakhir dengan volume > 0 pada tanggal WIB `day`."""
    if df is None or df.empty:
        return None
    sub = prices.frame_for(df, symbol)
    if sub is None or sub.empty:
        return None
    stamps = []
    for ts, row in sub.iterrows():
        stamp = ts.tz_convert(tz) if getattr(ts, "tzinfo", None) else ts
        if stamp.date().isoformat() != day or prices.session_of(stamp) != "regular":
            continue
        volume = row.get("Volume")
        if volume is None or pd.isna(volume) or int(volume) <= 0:
            continue
        stamps.append(stamp)
    return max(stamps).isoformat(timespec="seconds") if stamps else None


def write_freshness(conn, key: str, *, as_of_date: str, last_bar_at: str | None, status: str, detail: dict | None = None) -> None:
    conn.execute(
        """
        INSERT INTO data_freshness (key, as_of_date, last_bar_at, status, detail, checked_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          as_of_date = excluded.as_of_date, last_bar_at = excluded.last_bar_at,
          status = excluded.status, detail = excluded.detail, checked_at = excluded.checked_at
        """,
        (key, as_of_date, last_bar_at, status, json.dumps(detail, ensure_ascii=False) if detail else None, now_iso()),
    )
    conn.commit()


def probe(conn, *, tickers: list[str] | None = None) -> dict:
    """Cek watchlist → status gate, dan simpan ke `data_freshness` (key `midday_gate`)."""
    cfg = get_settings()
    tz = cfg.app.timezone
    today = datetime.now(ZoneInfo(tz)).date().isoformat()
    symbols = tickers or cfg.freshness_probe_tickers
    gate_min = cfg.midday["gate_min_bar_time"]

    df = prices.fetch(
        symbols,
        "",
        "",
        retries=cfg.ingest["retries"],
        backoff=cfg.ingest["backoff_seconds"],
        interval="5m",
        period="1d",
    )

    probes = []
    last_bar_at = None
    for symbol in symbols:
        stamp = last_regular_bar(df, symbol, tz, today)
        probes.append({"ticker": symbol.removesuffix(".JK"), "last_bar_at": stamp})
        if stamp and (last_bar_at is None or stamp > last_bar_at):
            last_bar_at = stamp

    # lolos kalau ada bar hari ini yang jamnya >= gate (bar dari hari lain sudah disaring di atas)
    ok = bool(last_bar_at) and last_bar_at[11:16] >= gate_min
    result = {
        "gate": "ok" if ok else "stale",
        "as_of_date": today,
        "last_bar_at": last_bar_at,
        "required_bar_time": gate_min,
        "probes": probes,
    }
    write_freshness(
        conn,
        GATE_KEY,
        as_of_date=today,
        last_bar_at=last_bar_at,
        status=result["gate"],
        detail={"required_bar_time": gate_min, "probes": probes},
    )
    return result


def daily_ingest_status(conn) -> dict:
    """Status `daily_ingest` dihitung dari `price_daily` (tanpa tabel bantu).

    shortcut: hari libur bursa tidak dikenal, jadi hanya Sabtu/Minggu yang dilewati.
    """
    cfg = get_settings()
    today = datetime.now(ZoneInfo(cfg.app.timezone)).date()
    last_bar = conn.execute("SELECT MAX(date) FROM price_daily").fetchone()[0]
    last_ingested = conn.execute("SELECT MAX(ingested_at) FROM price_daily").fetchone()[0]
    expected = str(np.busday_offset(today.isoformat(), 0, roll="backward"))
    if not last_bar:
        status = "failed"
    else:
        status = "ok" if last_bar >= expected else "stale"
    return {"status": status, "last_data_at": last_ingested, "last_bar_date": last_bar, "expected_bar_date": expected}


def read(conn) -> dict:
    """Bentuk respons `GET /api/v1/freshness` (docs/05 §1)."""
    row = conn.execute("SELECT * FROM data_freshness WHERE key = ?", (GATE_KEY,)).fetchone()
    detail = json.loads(row["detail"]) if row and row["detail"] else {}
    gate = {
        "status": row["status"] if row else "stale",
        "as_of_date": row["as_of_date"] if row else None,
        "last_bar_at": row["last_bar_at"] if row else None,
        "required_bar_time": detail.get("required_bar_time"),
        "probes": detail.get("probes", []),
        "checked_at": row["checked_at"] if row else None,
    }
    return {"midday_gate": gate, "daily_ingest": daily_ingest_status(conn)}
