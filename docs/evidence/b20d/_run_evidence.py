"""Bukti B20d: backfill `plan_days=5` → isi `plan_pick` per tanggal + durasi endpoint + 1 pick lengkap."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

os.environ["ROTATION_CONFIG"] = "E:/rotation-b18-test/config.yaml"

from fastapi.testclient import TestClient  # noqa: E402

from backend.app import db, jobs  # noqa: E402
from backend.app.config import get_settings  # noqa: E402
from backend.app.main import app  # noqa: E402

cfg = get_settings()
client = TestClient(app)
OUT = Path("docs/evidence/b20d")
OUT.mkdir(parents=True, exist_ok=True)
LOG: list[str] = []

db.init_db("E:/rotation-b18-test/rotation.db")

started = time.monotonic()
backfill = jobs.compute({"stage": "ta", "plan_days": 5}, lambda **kw: None)
LOG.append(f"jobs.compute(stage=ta, plan_days=5) → durasi {time.monotonic() - started:.1f} s")
LOG.append("result_json: " + json.dumps({k: v for k, v in backfill.items() if k != "ta_result"}, ensure_ascii=False)[:600])

conn = db.connect()
try:
    LOG.append("isi plan_pick per tanggal:")
    for row in conn.execute("SELECT as_of_date, COUNT(*) AS n, MAX(rank) AS max_rank FROM plan_pick GROUP BY 1 ORDER BY 1 DESC"):
        LOG.append(f"  {row['as_of_date']} → {row['n']} baris (rank maksimum {row['max_rank']})")
    dates = [row[0] for row in conn.execute("SELECT DISTINCT as_of_date FROM plan_pick ORDER BY 1 DESC LIMIT 5")]
    LOG.append("available_dates dari respons: lihat di bawah")
finally:
    conn.close()

LOG.append("durasi GET /plan/picks (time.perf_counter, 3× per tanggal):")
for date in dates:
    for url in (f"/api/v1/plan/picks?as_of={date}", f"/api/v1/plan/picks?as_of={date}&limit=10"):
        tests = []
        for _ in range(3):
            mark = time.perf_counter()
            response = client.get(url)
            tests.append(time.perf_counter() - mark)
        body = response.json()
        LOG.append(
            f"  {url} → {response.status_code} · min {min(tests) * 1000:.0f} ms · median {sorted(tests)[1] * 1000:.0f} ms"
            f" · screened {body.get('screened')} · picks {len(body.get('picks', []))}"
        )

mark = time.perf_counter()
default_body = client.get("/api/v1/plan/picks").json()
LOG.append(f"GET /plan/picks (default) → {(time.perf_counter() - mark) * 1000:.0f} ms · as_of {default_body['as_of']}")
(OUT / "respons_default.json").write_text(
    json.dumps({k: v for k, v in default_body.items() if k != "picks"}, ensure_ascii=False, indent=1), encoding="utf-8"
)
if default_body["picks"]:
    (OUT / f"pick_lengkap_{default_body['as_of']}.json").write_text(
        json.dumps(default_body["picks"][0], ensure_ascii=False, indent=1), encoding="utf-8"
    )
    first = default_body["picks"][0]
    LOG.append(
        f"pick pertama: {first['ticker']} · status {first['status']} · bars_sejak_asof {first['bars_sejak_asof']}"
        f" · ret_sejak_asof {first['ret_sejak_asof']} · mfe {first['mfe_pct']} / mae {first['mae_pct']}"
    )
    LOG.append("status_note: " + first["status_note"])

missing = client.get("/api/v1/plan/picks?as_of=2020-01-02")
LOG.append(f"as_of tak ada → {missing.status_code} · {json.dumps(missing.json(), ensure_ascii=False)[:200]}")

text = "\n".join(LOG)
(OUT / "RUN-LOG.txt").write_text(text + "\n", encoding="utf-8")
print(text)
