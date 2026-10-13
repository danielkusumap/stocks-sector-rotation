"""Bukti B19–B22: durasi `plan_for_all`, dump `/plan/stock` & `/series/stock` untuk 3 rezim, perf 400 bar."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

os.environ["ROTATION_CONFIG"] = "E:/rotation-b18-test/config.yaml"

from fastapi.testclient import TestClient  # noqa: E402

from backend.app import db  # noqa: E402
from backend.app.compute import plan  # noqa: E402
from backend.app.config import get_settings  # noqa: E402
from backend.app.main import app  # noqa: E402

LOG: list[str] = []
cfg = get_settings()
client = TestClient(app)

conn = db.connect()
try:
    started = time.monotonic()
    result = plan.plan_for_all(conn, cfg)
    duration = time.monotonic() - started
    LOG.append(f"plan_for_all: {json.dumps(result, ensure_ascii=False)} · durasi {duration:.1f} s")
    regimes = [row[0] for row in conn.execute("SELECT DISTINCT regime FROM stock_plan")]
    LOG.append("rezim tersedia: " + ", ".join(sorted(regimes)))
    picks: list[tuple[str, str]] = []
    for regime in ("tren_naik", "range", "tipis", "tidak_cukup_data"):
        found = conn.execute(
            "SELECT ticker FROM stock_plan WHERE regime = ? AND plan_json IS NOT NULL ORDER BY ticker LIMIT 1", (regime,)
        ).fetchone()
        if not found:
            found = conn.execute("SELECT ticker FROM stock_plan WHERE regime = ? ORDER BY ticker LIMIT 1", (regime,)).fetchone()
        if found:
            picks.append((regime, found[0]))
    LOG.append("sampel: " + json.dumps(picks))
    cross = conn.execute(
        "SELECT COUNT(*) FROM stock_plan sp JOIN signal_weekly sw ON sw.ref_id = sp.ticker AND sw.week_end = sp.as_of_date"
        " WHERE sw.scope = 'stock' AND sw.plan_json IS NOT NULL AND abs(sp.stop - sw.stop) < 0.01 AND sw.regime = sp.regime"
    ).fetchone()[0]
    total = conn.execute(
        "SELECT COUNT(*) FROM stock_plan sp JOIN signal_weekly sw ON sw.ref_id = sp.ticker AND sw.week_end = sp.as_of_date"
        " WHERE sw.scope = 'stock' AND sw.plan_json IS NOT NULL"
    ).fetchone()[0]
    LOG.append(f"uji silang stock_plan vs signal_weekly: {cross}/{total} baris identik (stop ±0,01 & rezim)")
finally:
    conn.close()

for regime, ticker in picks:
    detail = client.get(f"/api/v1/plan/stock/{ticker}").json()
    Path("docs/evidence/b20").mkdir(parents=True, exist_ok=True)
    (Path("docs/evidence/b20") / f"plan_{regime}_{ticker}.json").write_text(
        json.dumps(detail, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    LOG.append(
        f"{ticker} ({regime}): plan_ok={detail['plan'] and detail['plan']['plan_ok']} · skenario={bool(detail['scenario'])} "
        f"· kalimat={len(detail['summary_lines'])} · level_baris={len(detail['levels_table'])}"
    )
    series = client.get(f"/api/v1/series/stock/{ticker}?window=6m").json()
    Path("docs/evidence/b19").mkdir(parents=True, exist_ok=True)
    (Path("docs/evidence/b19") / f"series_{regime}_{ticker}.json").write_text(
        json.dumps(series, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    LOG.append(
        f"{ticker}: candles={len(series['candles'])} · ma20={len(series['overlays']['ma']['20'])} "
        f"· kanal={len(series['overlays']['channels'])} · event={len(series['events'])} · lapisan={series['layers']}"
    )

if picks:
    ticker = picks[0][1]
    started = time.monotonic()
    full = client.get(f"/api/v1/series/stock/{ticker}?bars=400&layers=indicators&layers=smc&layers=elliott").json()
    elapsed = (time.monotonic() - started) * 1000
    Path("docs/evidence/b21").mkdir(parents=True, exist_ok=True)
    Path("docs/evidence/b22").mkdir(parents=True, exist_ok=True)
    (Path("docs/evidence/b21") / f"indicators_{ticker}.json").write_text(
        json.dumps(full["indicators"], ensure_ascii=False, indent=1), encoding="utf-8"
    )
    (Path("docs/evidence/b22") / f"smc_elliott_{ticker}.json").write_text(
        json.dumps({"smc": full["smc"], "elliott": full["elliott"]}, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    detail = client.get(f"/api/v1/plan/stock/{ticker}").json()
    same_levels = full["levels"] is None or (
        detail["plan"] is not None and full["levels"]["stop"] == detail["plan"]["stop"]["level"]
    )
    LOG.append(
        f"perf semua lapisan aktif ({ticker}, bars=400): {elapsed:.0f} ms · ursi={len(full['indicators']['ursi']['points'])} "
        f"· vwap={len(full['indicators']['vwap']['points'])} · poc={full['indicators']['poc']['poc']} "
        f"· bos={len(full['smc']['bos'])} · fvg={len(full['smc']['fvg'])} · elliott={full['elliott']['status']}"
        f" · stop_grafik=sama_dengan_plan:{same_levels}"
    )

text = "\n".join(LOG)
Path("docs/evidence/b20").mkdir(parents=True, exist_ok=True)
Path("docs/evidence/b20/RUN-LOG.txt").write_text(text + "\n", encoding="utf-8")
print(text)
