"""Bukti B18c: distribusi `plan_ok` sebelum/sesudah + 2 plan yang berubah (MPXL & SMDR)."""

from __future__ import annotations

import json
import os
from pathlib import Path

os.environ["ROTATION_CONFIG"] = "E:/rotation-b18-test/config.yaml"

from backend.app import db  # noqa: E402
from backend.app.compute import signals  # noqa: E402
from backend.app.config import get_settings  # noqa: E402

get_settings.cache_clear()
OUT = Path("docs/evidence/b18c")
OUT.mkdir(parents=True, exist_ok=True)
LOG: list[str] = []

result = signals.compute_signals()
LOG.append(f"compute_signals (kode B18c): {json.dumps(result, ensure_ascii=False)}")

conn = db.connect()
try:
    row = conn.execute(
        """
        SELECT COUNT(*) AS baris, SUM(plan_json IS NOT NULL) AS punya_plan, SUM(plan_ok = 1) AS ok,
               SUM(plan_ok = 0) AS tidak_ok,
               SUM(plan_ok = 0 AND entry_mode = 'no_trade') AS gagal_no_trade,
               SUM(plan_ok = 0 AND rr_tp2 < 3.0 - 1e-9) AS gagal_rr,
               SUM(plan_json LIKE '%lebar untuk swing%') AS ada_peringatan_lebar,
               SUM(stop_pct < -0.08) AS stop_di_atas_8pct
        FROM signal_weekly WHERE scope = 'stock'
        """
    ).fetchone()
    LOG.append("distribusi `plan_ok` SESUDAH B18c: " + " · ".join(f"{k}={row[k]}" for k in row.keys()))
    LOG.append("(SEBELUM B18c, dari docs/evidence/b18/RUN-LOG.txt: baris=50 · punya_plan=34 · plan_tidak_ok=29 — semuanya stop > 8%)")

    week = conn.execute("SELECT MAX(week_end) FROM signal_weekly WHERE scope = 'stock'").fetchone()[0]
    for ticker in ("MPXL", "SMDR"):
        found = conn.execute(
            "SELECT * FROM signal_weekly WHERE scope = 'stock' AND ref_id = ? AND week_end = ?", (ticker, week)
        ).fetchone()
        if not found:
            continue
        plan = json.loads(found["plan_json"])
        (OUT / f"plan_{ticker}_{week}.json").write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
        LOG.append(
            f"{ticker} @ {week}: plan_ok={found['plan_ok']} · stop={found['stop']:.2f} ({found['stop_pct'] * 100:.2f}%) "
            f"· rr_tp2={found['rr_tp2']:.3f} · risk_pct={plan['risk_pct']:.4f} · notes={json.dumps(plan['notes'], ensure_ascii=False)}"
        )
finally:
    conn.close()

text = "\n".join(LOG)
(OUT / "RUN-LOG.txt").write_text(text + "\n", encoding="utf-8")
print(text)
