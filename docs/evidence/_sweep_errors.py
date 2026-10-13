"""Sapu SEMUA error sekaligus (bukan berhenti di yang pertama).

- `plan_for_all` dijalankan **per emiten** dengan `try/except` (jalur kode asli, isolasi per ticker)
  → satu laporan berisi tiap emiten yang gagal + jenis error.
- Endpoint `/plan/stock` & `/series/stock` disapu untuk sampel + kasus tepi (tanpa bar, tak ada, lapisan).
Output: docs/evidence/SWEEP-ERRORS.txt (juga dicetak).
"""

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

cfg = get_settings()
client = TestClient(app)
failures: list[str] = []
notes: list[str] = []

conn = db.connect()
try:
    tickers = [row[0] for row in conn.execute("SELECT ticker FROM stock WHERE is_active = 1 ORDER BY ticker")]
    original = plan.ACTIVE_STOCKS_SQL
    started = time.monotonic()
    ok = 0
    for index, ticker in enumerate(tickers, 1):
        plan.ACTIVE_STOCKS_SQL = f"SELECT ticker FROM stock WHERE is_active = 1 AND ticker = '{ticker}'"  # 1 emiten saja
        try:
            plan.plan_for_all(conn, cfg)
            ok += 1
        except Exception as error:  # noqa: BLE001 — sapu semua, laporkan, lanjut emiten berikutnya
            plan.ACTIVE_STOCKS_SQL = original
            conn.rollback()
            failures.append(f"plan_for_all[{ticker}] {type(error).__name__}: {str(error)[:160]}")
        plan.ACTIVE_STOCKS_SQL = original
        if index % 200 == 0:
            notes.append(f"  … {index}/{len(tickers)} emiten, gagal {len(failures)}")
    notes.append(f"plan_for_all per emiten: {ok} ok, {len(failures)} gagal, {time.monotonic() - started:.1f} s")

    # Endpoint: sampel tiap 25 emiten + emiten tanpa bar + ticker tak ada + variasi lapisan.
    sample = tickers[::25][:40]
    for ticker in sample:
        for url, layers in (
            (f"/api/v1/plan/stock/{ticker}", None),
            (f"/api/v1/series/stock/{ticker}?window=6m", None),
            (f"/api/v1/series/stock/{ticker}?bars=400&layers=indicators&layers=smc&layers=elliott", None),
            (f"/api/v1/series/stock/{ticker}?layers=", None),
        ):
            try:
                response = client.get(url)
                if response.status_code != 200:
                    failures.append(f"GET {url} → {response.status_code} {str(response.json())[:120]}")
            except Exception as error:  # noqa: BLE001
                failures.append(f"GET {url} → {type(error).__name__}: {str(error)[:140]}")
    for url in ("/api/v1/plan/stock/ZZZZ", "/api/v1/series/stock/ZZZZ"):
        response = client.get(url)
        if response.status_code != 404:
            failures.append(f"GET {url} → harus 404, dapat {response.status_code}")
    for url in (
        f"/api/v1/series/stock/{tickers[0]}?bars=500",
        f"/api/v1/series/stock/{tickers[0]}?events=200",
        f"/api/v1/series/stock/{tickers[0]}?layers=foo",
    ):
        response = client.get(url)
        if response.status_code != 422:
            failures.append(f"GET {url} → harus 422, dapat {response.status_code}")
finally:
    conn.close()

text = "\n".join(notes + [""] + (failures or ["(tanpa kegagalan)"]))
Path("docs/evidence").mkdir(parents=True, exist_ok=True)
Path("docs/evidence/SWEEP-ERRORS.txt").write_text(text + "\n", encoding="utf-8")
print(text)
print("\nRINGKASAN:", json.dumps({"emiten": len(tickers), "kegagalan": len(failures)}))
