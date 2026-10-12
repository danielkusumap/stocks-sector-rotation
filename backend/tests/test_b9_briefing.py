"""B9 — briefing pagi: kontrak §3, regime 3 skenario, watch saat gate midday gagal."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app import cache, db
from backend.app.api.briefing import regime_of
from backend.app.config import get_settings
from backend.app.ingest import freshness
from backend.tests.test_b8_read import read_db  # fixture data kecil yang sama


@pytest.fixture
def client(read_db, monkeypatch):
    monkeypatch.setattr(db, "db_path", lambda: read_db)
    cache.clear()
    from backend.app.main import app

    return TestClient(app)


def test_regime_tiga_skenario():
    """docs/07 B9 AC: regime benar untuk 2/9, 7/4, dan 5/6 sektor (ambang dari config)."""
    threshold = get_settings().briefing["regime_sector_threshold"]

    assert regime_of(2, 9, threshold, 11)[0] == "risk_off"
    assert regime_of(7, 4, threshold, 11)[0] == "risk_on"
    assert regime_of(5, 6, threshold, 11)[0] == "mixed"
    # catatan Bahasa Indonesia menyebut jumlah sektornya
    assert "9 dari 11" in regime_of(2, 9, threshold, 11)[1]
    assert "7 dari 11" in regime_of(7, 4, threshold, 11)[1]


def test_briefing_kontrak_dan_selalu_200(client):
    response = client.get("/api/v1/briefing/morning")
    assert response.status_code == 200  # walau data stale/partial
    body = response.json()

    assert set(body) == {
        "api_version", "generated_at", "data_status", "market", "leaders", "laggards", "changes",
        "weekly_focus", "midday", "watch", "notes_for_report",
    }
    market = body["market"]
    assert set(market) == {"ihsg_close", "ihsg_ret_1d", "ihsg_ret_1w", "sectors_up", "sectors_down", "breadth", "regime", "regime_note"}
    assert market["regime"] in ("risk_on", "risk_off", "mixed")
    assert market["ihsg_close"] and market["ihsg_ret_1d"] is not None
    assert market["sectors_up"] + market["sectors_down"] <= 11
    assert set(market["breadth"]) == {"advancers", "decliners", "unchanged"}
    assert market["breadth"]["advancers"] >= 0

    assert body["leaders"] and body["laggards"]  # top_n default 3 (data hanya 2 sektor berisi)
    assert set(body["leaders"][0]) == {"code", "name_id", "quadrant", "score", "ret_1w", "streak_weeks", "series"}
    assert body["leaders"][0]["score"] >= body["laggards"][0]["score"]
    assert isinstance(body["changes"], list)
    assert set(body["weekly_focus"]) == {"week_end", "sectors", "stocks"}
    assert body["weekly_focus"]["week_end"] == "2026-10-09"
    assert body["weekly_focus"]["sectors"][0]["code"] == "IDXFINANCE"
    assert set(body["weekly_focus"]["stocks"][0]) == {"ticker", "entry_ref", "stop", "target", "streak_weeks", "rationale"}
    assert set(body["midday"]) == {"available", "as_of", "gate", "moves"}
    assert body["midday"]["available"] is False  # belum ada metrik midday
    assert "5–8 paragraf" in body["notes_for_report"]


def test_watch_berisi_pesan_saat_gate_midday_gagal(client, read_db):
    conn = db.connect(read_db)
    try:
        freshness.write_freshness(conn, "midday_gate", status="stale", as_of_date="2026-10-13", last_bar_at="2026-10-13T11:05:00+07:00")
        conn.commit()
    finally:
        conn.close()

    cache.clear()
    body = client.get("/api/v1/briefing/morning").json()
    assert body["midday"]["gate"] == "stale"
    pesan = [w["message"] for w in body["watch"]]
    assert any("11:30" in m and "11:05" in m for m in pesan), pesan
    assert any("Tengah hari" in m for m in pesan)  # menjaga saat midday belum ada
    assert all(set(w) == {"level", "message"} for w in body["watch"])


def test_top_n_dan_include_series(client):
    body = client.get("/api/v1/briefing/morning?top_n=1").json()
    assert len(body["leaders"]) == 1 and len(body["laggards"]) == 1

    with_series = client.get("/api/v1/briefing/morning?include_series=true&top_n=1").json()
    assert with_series["leaders"][0]["series"]
    assert set(with_series["leaders"][0]["series"][0]) == {"date", "index_close"}
