"""`summary_lines` + `watchlist` di briefing (docs/05 §3) — template rule-based, tanpa LLM.

Nama test yang diminta: `test_summary_lines_panjang_maksimal`, `test_watchlist_maks_3`,
`test_summary_kosong_bila_belum_ada_hasil`.
"""

from __future__ import annotations

import json
import re

from backend.app import db
from backend.app.api.briefing import MAX_LINE, MAX_WATCHLIST
from backend.tests.test_b8_read import read_db  # noqa: F401
from backend.tests.test_b9_briefing import client  # noqa: F401

# Istilah mentah yang dilarang muncul di kalimat user (docs/05 §3: pakai istilah Indonesia).
JARGON = ("RS-Ratio", "RS-", "improving", "lagging", "leading", "weakening", "quadrant", "streak")
WATCH_FIELDS = {"kind", "ref_id", "name", "quadrant", "streak_weeks", "reason"}


def test_summary_lines_panjang_maksimal(client):
    """3–6 kalimat, masing-masing ≤ 140 karakter, angka Indonesia, tanpa istilah teknis mentah."""
    body = client.get("/api/v1/briefing/morning").json()
    lines = body["summary_lines"]

    assert 3 <= len(lines) <= 6, lines
    assert all(line.strip() for line in lines)
    assert all(len(line) <= MAX_LINE for line in lines), [len(line) for line in lines]
    assert not any(jargon.lower() in " ".join(lines).lower() for jargon in JARGON), lines
    assert all("`" not in line and "\n" not in line for line in lines)  # teks siap tampil

    # (1) dibuka kondisi pasar + regime, angkanya format Indonesia (koma desimal)
    assert lines[0].startswith("IHSG") and "%" in lines[0]
    assert re.search(r"\d,\d+%", lines[0]), lines[0]
    assert body["market"]["regime_note"].split(";")[0] in lines[0]

    # (2) sektor naik/turun teratas disebut dengan angka bila ada yang bergerak
    if body["market"]["sectors_up"] + body["market"]["sectors_down"] > 0:
        assert any(line.startswith(("Yang masih naik", "Turun paling dalam")) for line in lines)


def test_watchlist_maks_3(client, read_db):
    """Maks 3 item, sektor dulu lalu saham, urut skor menurun, `reason` 1 kalimat ≤ 140 karakter."""
    two = client.get("/api/v1/briefing/morning").json()["watchlist"]
    assert [i["kind"] for i in two] == ["sector", "stock"]  # sektor dulu
    assert all(set(i) == WATCH_FIELDS for i in two)
    assert all(len(i["reason"]) <= MAX_LINE for i in two)

    # tambah kandidat sampai lebih dari 3 → dipotong ke 3
    conn = db.connect(read_db)
    try:
        for code, score in (("IDXENERGY", 95.0), ("IDXBASIC", 90.0)):
            sector_id = conn.execute("SELECT id FROM sector WHERE code = ?", (code,)).fetchone()[0]
            conn.execute(
                "INSERT INTO signal_weekly (week_end, scope, ref_id, sector_id, timeframe, rank, score,"
                " streak_weeks, rule_hits, rationale, computed_at)"
                " VALUES ('2026-10-09','sector',?,?,'w1_fri',1,?,3,?,'uji','2026-10-13T00:00:00+07:00')",
                (code, sector_id, score, json.dumps({"quadrant": "leading", "quadrant_age_periods": 3})),
            )
        conn.commit()
    finally:
        conn.close()

    items = client.get("/api/v1/briefing/morning").json()["watchlist"]
    assert len(items) == MAX_WATCHLIST == 3
    assert [i["kind"] for i in items] == ["sector"] * 3
    assert [i["ref_id"] for i in items] == ["IDXENERGY", "IDXBASIC", "IDXFINANCE"]  # skor 95 > 90 > 80
    assert items[0]["quadrant"] == "leading" and items[0]["streak_weeks"] == 3
    assert items[0]["reason"] == "Memimpin 3 minggu berturut-turut, kekuatan relatif masih naik."
    assert all(len(i["reason"]) <= MAX_LINE for i in items)


def test_summary_kosong_bila_belum_ada_hasil(tmp_db, monkeypatch):
    """Belum ada hasil hitung → `summary_lines` dan `watchlist` kosong, endpoint tetap 200."""
    monkeypatch.setattr(db, "db_path", lambda: tmp_db)
    from backend.app import cache
    from backend.app.main import app
    from fastapi.testclient import TestClient

    cache.clear()
    response = TestClient(app).get("/api/v1/briefing/morning")
    body = response.json()

    assert response.status_code == 200
    assert body["summary_lines"] == [] and body["watchlist"] == []
    assert body["data_status"]["status"] == "stale" and body["leaders"] == [] and body["weekly_focus"]["week_end"] is None
