"""Jalankan bukti B17 di server uji :8100 (config salinan, DB di luar repo) — dipakai sekali untuk evidence."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8100/api/v1"
OUT = Path(r"E:/stocks-sector-rotation/docs/evidence/b17")
OUT.mkdir(parents=True, exist_ok=True)
LOG: list[str] = []


def call(path: str, payload: dict | None = None):
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(BASE + path, data=data, method="POST" if data else "GET",
                                     headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as exc:
        return exc.code, json.load(exc)


def poll(run_id: int, limit: int = 400):
    seen = []
    for _ in range(limit):
        _, body = call(f"/admin/runs/{run_id}")
        run = body["run"]
        seen.append({"status": run["status"], "phase": run["phase"], "rows": run["rows"], "percent": run["percent"], "message": run["message"]})
        if run["status"] in ("ok", "partial", "failed", "skipped"):
            return run, seen
        time.sleep(0.02)
    return run, seen


def dump(name: str, path: str) -> None:
    status, body = call(path)
    (OUT / name).write_text(json.dumps(body, ensure_ascii=False, indent=1), encoding="utf-8")
    size = (OUT / name).stat().st_size
    LOG.append(f"GET {path} -> HTTP {status}, disimpan {name} ({size} byte)")


def main() -> None:
    # (1) stage=ta lewat HTTP (docs/07 B17 AC 8)
    status, body = call("/admin/compute?async=true", {"stage": "ta"})
    LOG.append(f'POST /admin/compute?async=true {{"stage":"ta"}} -> HTTP {status} {json.dumps(body)}')
    run, seen = poll(body["run_id"])
    LOG.append(f"polling {len(seen)}x: {json.dumps(seen[:2])} … {json.dumps(seen[-1])}")
    LOG.append(f"result_json compute_ta: {json.dumps(run['result_json'], ensure_ascii=False)}")

    # (2) stage=all menyertakan TA (docs/07 B17 AC 9)
    status, body = call("/admin/compute?async=true", {"stage": "all", "timeframe": "d1"})
    LOG.append(f'POST /admin/compute?async=true {{"stage":"all"}} -> HTTP {status} {json.dumps(body)}')
    run_all, seen_all = poll(body["run_id"], limit=2000)
    LOG.append(f"polling {len(seen_all)}x (contoh): {json.dumps(seen_all[:1])} … {json.dumps(seen_all[-1])}")
    LOG.append(f"result_json compute_all: {json.dumps(run_all['result_json'], ensure_ascii=False)[:600]}")

    # (3) ingest_run setelah stage=all
    status, runs = call("/admin/runs?limit=6")
    (OUT / "admin_runs.json").write_text(json.dumps(runs, ensure_ascii=False, indent=1), encoding="utf-8")
    for item in runs["runs"]:
        LOG.append(f"ingest_run #{item['run_id']} kind={item['kind']} status={item['status']} rows={item['rows']} percent={item['percent']}")

    # (4) dump 3 endpoint (1 sektor + 1 saham + ringkasan)
    dump("ta_summary_stock_ma20.json", "/ta/summary?scope=stock&ma_period=20&trend_filter=false&limit=100")
    dump("ta_summary_sector_ma20.json", "/ta/summary?scope=sector&ma_period=20&trend_filter=false&limit=100")
    dump("ta_stock_BBRI_ma20.json", "/ta/stock/BBRI?ma_period=20")
    dump("ta_sector_IDXFINANCE_ma20.json", "/ta/sector/IDXFINANCE?ma_period=20")

    # (5) 400 ma_period di luar config + entitas tanpa event
    status, body = call("/ta/summary?scope=stock&ma_period=7")
    LOG.append(f"GET /ta/summary?scope=stock&ma_period=7 -> HTTP {status} {json.dumps(body, ensure_ascii=False)}")
    status, body = call("/ta/stock/EXCL?ma_period=20")
    LOG.append(
        "GET /ta/stock/EXCL?ma_period=20 -> HTTP %d latest=%s events=%d n_events=%s"
        % (status, json.dumps(body.get("latest"), ensure_ascii=False)[:80], len(body.get("events", [])), body.get("stats", {}).get("filter_off", {}).get("n_events"))
    )

    (OUT / "RUN-LOG.txt").write_text("\n".join(LOG) + "\n", encoding="utf-8")
    print("\n".join(LOG))


if __name__ == "__main__":
    main()
