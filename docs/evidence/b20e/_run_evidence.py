"""Bukti B20e: `as_of_date` = cutoff + `last_bar_date` — potret SEBELUM vs SESUDAH pada DB dev."""

from __future__ import annotations

import json
import time
from pathlib import Path

from backend.app import db
from backend.app.compute import plan
from backend.app.config import get_settings

cfg = get_settings()
OUT = Path("docs/evidence/b20e")
OUT.mkdir(parents=True, exist_ok=True)
LOG: list[str] = []
CONToh = ("ABBA", "ADCP", "ADHI", "AIMS", "ALMI")
PEMBANDING = ("BBRI", "TLKM", "ASII")

conn = db.connect()
try:
    LOG.append("=== SEBELUM (run #51 lama) ===")
    for row in conn.execute("SELECT as_of_date, COUNT(*) FROM stock_plan GROUP BY 1 ORDER BY 1 DESC LIMIT 3"):
        LOG.append(f"  stock_plan {row[0]} → {row[1]} baris")
    LOG.append(f"  emiten aktif (stock.is_active=1): {conn.execute('SELECT COUNT(*) FROM stock WHERE is_active = 1').fetchone()[0]}")
    for ticker in CONToh:
        row = conn.execute(
            "SELECT as_of_date FROM stock_plan WHERE ticker = ? ORDER BY as_of_date DESC LIMIT 1", (ticker,)
        ).fetchone()
        bars = conn.execute("SELECT MAX(date) FROM price_daily WHERE ticker = ?", (ticker,)).fetchone()[0]
        LOG.append(f"  {ticker}: as_of_date {row[0] if row else None} · bar terakhir di price_daily {bars} (kolom last_bar_date belum ada)")
    before_levels = {
        ticker: conn.execute(
            "SELECT as_of_date, entry_zone_low, stop, tp1, tp2 FROM stock_plan WHERE ticker = ? ORDER BY as_of_date DESC LIMIT 1",
            (ticker,),
        ).fetchone()
        for ticker in PEMBANDING
    }
    LOG.append("  level 3 pembanding: " + json.dumps({k: list(v) if v else None for k, v in before_levels.items()}, default=str))

    info = db.init_db()  # migrasi 009
    LOG.append(f"\n=== migrasi 009 ===\n  {json.dumps(info)}")

    dates = [row[0] for row in conn.execute("SELECT DISTINCT date FROM price_daily ORDER BY date DESC LIMIT 5")][::-1]
    LOG.append(f"\n=== SESUDAH: plan_for_all per cutoff {dates} ===")
    started = time.monotonic()
    for date in dates:
        result = plan.plan_for_all(conn, cfg, as_of=date)
        LOG.append(f"  cutoff {date}: rows {result['rows']} · picks_saved {result['picks_saved']}")
    LOG.append(f"  total {time.monotonic() - started:.1f} s")

    LOG.append("\n  stock_plan per tanggal (AC 3):")
    for row in conn.execute("SELECT as_of_date, COUNT(*) FROM stock_plan GROUP BY 1 ORDER BY 1 DESC"):
        LOG.append(f"    {row[0]} → {row[1]}")
    LOG.append("  plan_pick per tanggal (AC 3):")
    for row in conn.execute("SELECT as_of_date, COUNT(*) FROM plan_pick GROUP BY 1 ORDER BY 1 DESC"):
        LOG.append(f"    {row[0]} → {row[1]}")

    cutoff = dates[-1]
    LOG.append(f"\n  contoh emiten tanpa bar di cutoff {cutoff} (AC 2):")
    for ticker in CONToh:
        row = conn.execute(
            "SELECT as_of_date, last_bar_date, regime, stop FROM stock_plan WHERE ticker = ? AND as_of_date = ?",
            (ticker, cutoff),
        ).fetchone()
        LOG.append(f"    {ticker}: as_of_date {row[0]} · last_bar_date {row[1]} · regime {row[2]} · stop {row[3]}" if row else f"    {ticker}: (tidak ada baris)")

    LOG.append(f"\n  level 3 pembanding setelah fix (AC 4):")
    for ticker in PEMBANDING:
        row = conn.execute(
            "SELECT as_of_date, entry_zone_low, stop, tp1, tp2 FROM stock_plan WHERE ticker = ? AND as_of_date = ?",
            (ticker, cutoff),
        ).fetchone()
        sama = row and before_levels[ticker] and list(row)[1:] == list(before_levels[ticker])[1:]
        LOG.append(f"    {ticker}: {list(row) if row else None} · identik dengan sebelum: {sama}")

    LOG.append("\n  /plan/picks screened per tanggal (AC 5):")
    for date in dates:
        body = plan.load_picks(conn, cfg, as_of=date)
        LOG.append(f"    {date} → as_of {body['as_of'] if body else None} · screened {body['screened'] if body else None} · picks {len(body['picks']) if body else 0}")
finally:
    conn.close()

text = "\n".join(LOG)
(OUT / "RUN-LOG.txt").write_text(text + "\n", encoding="utf-8")
print(text)
