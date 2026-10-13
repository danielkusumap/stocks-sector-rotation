"""Bukti B18b: basis bar plan = `date <= week_end` (bukan snapshot `stock_metrics` terakhir).

DB di luar repo (`E:/rotation-b18-test`) + config salinan (`ROTATION_CONFIG`); `data/rotation.db` tidak disentuh.
Basis LAMA direproduksi dengan membaca baris `stock_metrics` terakhir (as_of 2026-10-13) — bukan menurunkan kode lama.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

os.environ["ROTATION_CONFIG"] = "E:/rotation-b18-test/config.yaml"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from backend.app import db  # noqa: E402
from backend.app.compute import plan  # noqa: E402
from backend.app.config import get_settings  # noqa: E402

get_settings.cache_clear()
cfg = get_settings()
OUT = Path("docs/evidence/b18b")
OUT.mkdir(parents=True, exist_ok=True)
LOG: list[str] = []

LOG.append(f"db-init: {json.dumps(db.init_db(), ensure_ascii=False)}")
WEEK, OLD_WEEK = "2026-10-09", "2026-06-19"

conn = db.connect()
try:
    LOG.append("stock_metrics (d1) di DB uji: " + json.dumps(
        {r["as_of_date"]: r["n"] for r in conn.execute(
            "SELECT as_of_date, COUNT(*) AS n FROM stock_metrics WHERE timeframe = 'd1' GROUP BY 1")}, ensure_ascii=False))

    # 1) ticker yang snapshot-nya HANYA 13 Okt (BNBA) → basis lama = look-ahead 2 hari bursa
    look = "BNBA"
    bnb = plan.load_bars(conn, look, WEEK)
    new_ind = plan.indicators_from_bars(bnb, cfg)
    snap = dict(conn.execute(
        "SELECT as_of_date, sma20, sma50, rsi14, atr14 FROM stock_metrics WHERE ticker = ? AND timeframe = 'd1'"
        " ORDER BY as_of_date DESC LIMIT 1", (look,)).fetchone())
    LOG.append(f"1) {look} (bar terakhir <= {WEEK}: {bnb['date'].max()}) — basis lama vs baru:")
    LOG.append("   LAMA (stock_metrics terakhir): " + json.dumps(
        {k: (round(v, 6) if isinstance(v, float) else v) for k, v in snap.items()}, ensure_ascii=False))
    LOG.append("   BARU (bar <= week_end):        " + json.dumps(
        {k: round(v, 6) for k, v in new_ind.items() if v is not None}, ensure_ascii=False))
    LOG.append("   selisih: atr14 %+.6f · sma20 %+.6f · rsi14 %+.6f" % (
        new_ind["atr14"] - snap["atr14"], new_ind["sma20"] - snap["sma20"], new_ind["rsi14"] - snap["rsi14"]))

    # 2) pick nyata MPXL: snapshot-nya sudah 9 Okt → lama & baru identik (konsistensi rumus)
    pick = "MPXL"
    rows_old = conn.execute("SELECT COUNT(*) FROM stock_metrics WHERE ticker = ? AND as_of_date = ?", (pick, OLD_WEEK)).fetchone()[0]
    ind_old_week = plan.indicators_from_bars(plan.load_bars(conn, pick, OLD_WEEK), cfg)
    mp_snap = dict(conn.execute(
        "SELECT as_of_date, sma20, sma50, rsi14, atr14 FROM stock_metrics WHERE ticker = ? AND timeframe = 'd1'"
        " ORDER BY as_of_date DESC LIMIT 1", (pick,)).fetchone())
    mp_new = plan.indicators_from_bars(plan.load_bars(conn, pick, WEEK), cfg)
    LOG.append(f"2) {pick} — snapshot terakhir {mp_snap['as_of_date']} != week_end -> angka berubah: "
               f"atr14 {round(mp_snap['atr14'], 6)} vs {round(mp_new['atr14'], 6)} · "
               f"sma20 {mp_snap['sma20']} vs {mp_new['sma20']}")
    LOG.append(f"3) {pick} pekan lama {OLD_WEEK}: baris stock_metrics={rows_old} (tak ada) tapi dari bar -> "
               f"atr14 {ind_old_week['atr14']:.4f} · sma20 {ind_old_week['sma20']:.4f} "
               f"(riwayat {len(plan.load_bars(conn, pick, OLD_WEEK))} bar)")

    # 4) plan pekan lama tetap punya level (replay) walau stock_metrics tak punya baris tanggal itu
    replay = None
    for ticker in [r["ticker"] for r in conn.execute("SELECT ticker FROM stock WHERE is_active = 1 ORDER BY ticker LIMIT 80")]:
        sid_t = conn.execute("SELECT sector_id FROM stock WHERE ticker = ?", (ticker,)).fetchone()[0]
        built = plan.build_plans(conn, OLD_WEEK, [{"row": {"ticker": ticker, "sector_id": sid_t}}], cfg)[ticker]
        if built and built["stop"]["level"] is not None:
            replay = (ticker, built)
            break
    if replay:
        ticker, built = replay
        (OUT / f"plan_pekan_lama_{OLD_WEEK}.json").write_text(json.dumps(built, ensure_ascii=False, indent=1), encoding="utf-8")
        LOG.append(f"4) plan pekan lama {OLD_WEEK} (replay): {ticker} regime {built['regime']} · "
                   f"stop {built['stop']['level']} ({built['stop']['basis']}) · tp1 {built['tp1']['level']} · "
                   f"tp2 {built['tp2']['level']} · plan_ok {built['plan_ok']}")
    else:
        LOG.append(f"4) plan pekan lama {OLD_WEEK}: tak ada contoh berlevel di 80 ticker pertama")

    # 5) potongan `signal_weekly` hasil compute_signals (alasan pekan lama dulu selalu plan NULL)
    LOG.append("5) potongan `signal_weekly` (max week_end), sesudah B18b:")
    for row in conn.execute(
        "SELECT week_end, ref_id, regime, ROUND(stop,2) AS stop, ROUND(tp1,2) AS tp1, ROUND(tp2,2) AS tp2,"
        " ROUND(stop_pct,4) AS stop_pct, ROUND(rr_tp2,3) AS rr_tp2, plan_ok FROM signal_weekly WHERE scope='stock'"
        " AND week_end = (SELECT MAX(week_end) FROM signal_weekly) ORDER BY ref_id"
    ):
        LOG.append("   " + " · ".join(f"{k}={v}" for k, v in dict(row).items()))
    LOG.append("   store plan (semua minggu): " + " · ".join(
        f"{k}={v}" for k, v in dict(conn.execute(
            "SELECT COUNT(*) AS baris, SUM(plan_json IS NOT NULL) AS punya_plan, SUM(regime IS NULL) AS tanpa_plan"
            " FROM signal_weekly WHERE scope='stock'").fetchone()).items()))
finally:
    conn.close()

text = "\n".join(LOG)
(OUT / "DIGEST.md").write_text("# Bukti B18b\n\n```\n" + text + "\n```\n", encoding="utf-8")
print(text)
