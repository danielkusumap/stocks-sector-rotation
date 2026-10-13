"""Bukti B18: run nyata (config salinan + DB di luar repo) → dump `/weekly/picks` + agregat hit rate."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pandas as pd

os.environ["ROTATION_CONFIG"] = "E:/rotation-b18-test/config.yaml"

from backend.app import db  # noqa: E402
from backend.app.compute import signals, ta  # noqa: E402
from backend.app.config import get_settings  # noqa: E402

get_settings.cache_clear()
OUT = Path("docs/evidence/b18")
OUT.mkdir(parents=True, exist_ok=True)
LOG: list[str] = []

LOG.append(f"db-init: {json.dumps(db.init_db(), ensure_ascii=False)}")
LOG.append(f"compute_ta: {json.dumps(ta.compute_ta(), ensure_ascii=False)}")
LOG.append(f"compute_signals: {json.dumps(signals.compute_signals(), ensure_ascii=False)}")

from fastapi.testclient import TestClient  # noqa: E402

from backend.app.main import app  # noqa: E402

client = TestClient(app)
body = client.get("/api/v1/weekly/picks").json()
(OUT / "weekly_picks.json").write_text(json.dumps(body, ensure_ascii=False, indent=1), encoding="utf-8")
LOG.append(
    f"GET /weekly/picks -> api_version {body['api_version']} · week_end {body['week_end']} ({body['week_label']}) · "
    f"is_final {body['is_final']} · sektor {len(body['sectors'])} · saham {len(body['stocks'])}"
)

seen: dict[str, str] = {}
for pick in body["stocks"]:
    plan = pick["plan"] or {}
    LOG.append(
        f"  {pick['ticker']} rank {pick['rank']} skor {pick['score']} · regime {plan.get('regime')} · "
        f"alat {plan.get('entry_tool')} + konfirmasi {plan.get('confirm_tool')} · mode {plan.get('entry_mode')} · "
        f"zona {plan.get('entry_zone', {}).get('low')}–{plan.get('entry_zone', {}).get('high')} · "
        f"stop {plan.get('stop', {}).get('level')} ({plan.get('stop', {}).get('basis')}) · "
        f"tp1 {plan.get('tp1', {}).get('level')} rr {plan.get('tp1', {}).get('rr')} · "
        f"tp2 {plan.get('tp2', {}).get('level')} rr {plan.get('tp2', {}).get('rr')} · "
        f"hit_tp1 {plan.get('hold', {}).get('hit_tp1')} hit_tp2 {plan.get('hold', {}).get('hit_tp2')} · plan_ok {plan.get('plan_ok')}"
    )
    seen.setdefault(plan.get("regime"), pick["ticker"])

# satu contoh pick per rezim (kalau ada) untuk dump penuh
for regime, ticker in seen.items():
    if not regime:
        continue
    pick = next(p for p in body["stocks"] if p["ticker"] == ticker)
    (OUT / f"pick_{regime}.json").write_text(json.dumps(pick, ensure_ascii=False, indent=1), encoding="utf-8")
LOG.append(f"rezim yang muncul pada pick minggu itu: {json.dumps(seen, ensure_ascii=False)}")

# kenapa pick tertentu tanpa plan (atr null / riwayat kurang) — jangan diam-diam
week = body["week_end"]
conn = db.connect()
try:
    from backend.app.compute import plan as plan_mod

    for pick in body["stocks"]:
        if pick["plan"] is not None:
            continue
        m = plan_mod.metrics_for(conn, pick["ticker"], week)
        bars = plan_mod.load_bars(conn, pick["ticker"], week)
        LOG.append(
            f"  tanpa plan: {pick['ticker']} · atr14={m.get('atr14')} · bar riwayat={len(bars)} "
            f"(butuh ≥ {get_settings().weekly['plan']['donchian_slow'] + 1}) · turnover={m.get('median_turnover_20d_idr')}"
        )
finally:
    conn.close()

# rezim `range` tidak muncul pada pick minggu ini → contoh sintetis (disebut apa adanya, docs/07 B18 bukti)
from backend.app.compute import plan as plan_mod  # noqa: E402

cfg = get_settings()
synthetic = plan_mod.plan_levels(
    pd.DataFrame(
        {
            "date": pd.bdate_range("2026-01-05", periods=60).strftime("%Y-%m-%d"),
            "close": [100.0] * 60,
            "high": [100.5] * 60,
            "low": [99.5 if i not in (20, 30) else 97.0 for i in range(60)],
            "volume": [2_000_000] * 60,
        }
    ),
    {"sma20": 100.0, "sma50": 101.0, "rsi14": 30.0, "atr14": 2.0, "median_turnover_20d_idr": 5_000_000_000},
    "range",
    {"n_events": 0},
    cfg,
)
(OUT / "pick_range_sintetis.json").write_text(json.dumps(synthetic, ensure_ascii=False, indent=1), encoding="utf-8")
LOG.append(
    f"contoh sintetis rezim range (tanpa pick nyata): alat {synthetic['entry_tool']} + konfirmasi {synthetic['confirm_tool']} · "
    f"zona {synthetic['entry_zone']['low']}–{synthetic['entry_zone']['high']} · stop {synthetic['stop']['level']} · "
    f"tp1 {synthetic['tp1']['level']} · tp2 {synthetic['tp2']['level']} · plan_ok {synthetic['plan_ok']}"
)

conn = db.connect()
try:
    LOG.append("agregat SQL hit_tp1/hit_tp2 & RR (bareng plan, minggu terakhir):")
    for row in conn.execute(
        """
        SELECT ref_id, regime, entry_tool, confirm_tool, entry_mode, ROUND(rr_tp1, 2) AS rr1, ROUND(rr_tp2, 2) AS rr2,
               ROUND(hit_tp1, 2) AS hit1, ROUND(hit_tp2, 2) AS hit2, hold_median_periods, plan_ok, target, tp2, stop
        FROM signal_weekly WHERE scope = 'stock' AND week_end = (SELECT MAX(week_end) FROM signal_weekly)
        ORDER BY ref_id
        """
    ):
        LOG.append("  · ".join(f"{k}={v}" for k, v in dict(row).items()))
    LOG.append("store plan (semua minggu):")
    for row in conn.execute(
        "SELECT COUNT(*) AS baris, SUM(plan_json IS NOT NULL) AS punya_plan,"
        " SUM(regime IS NULL) AS tanpa_plan, SUM(plan_ok = 0) AS plan_tidak_ok FROM signal_weekly WHERE scope = 'stock'"
    ):
        LOG.append("  " + " · ".join(f"{k}={v}" for k, v in dict(row).items()))
    LOG.append("hit rate nyata dari ta_breakout (mfe_pct) untuk pick teratas:")
    for row in conn.execute(
        """
        SELECT ref_id, COUNT(*) AS n_events,
               ROUND(AVG(CASE WHEN mfe_pct >= 0.03 THEN 1.0 ELSE 0 END), 3) AS hit_3pct,
               ROUND(AVG(CASE WHEN mfe_pct >= 0.05 THEN 1.0 ELSE 0 END), 3) AS hit_5pct,
               ROUND(MAX(mfe_pct), 4) AS mfe_max, ROUND(MIN(mae_pct), 4) AS mae_min
        FROM ta_breakout WHERE scope = 'stock' AND ma_period = 20 AND trend_filter = 1
        GROUP BY ref_id ORDER BY n_events DESC LIMIT 5
        """
    ):
        LOG.append("  " + " · ".join(f"{k}={v}" for k, v in dict(row).items()))
finally:
    conn.close()

text = "\n".join(LOG)
(OUT / "RUN-LOG.txt").write_text(text + "\n", encoding="utf-8")
print(text)
