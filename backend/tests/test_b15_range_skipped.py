"""Follow-up kontrak docs/05: §0 `data_status.range_*`, §3 `week_start`/`week_label`, §4.3 run `skipped`.

Bukan task bernomor B — tiga perbaikan kontrak setelah gladi bersih (lihat `docs/DECISIONS.md` ADR-033…035).
"""

from __future__ import annotations

import re
from datetime import date, timedelta

from fastapi.testclient import TestClient

from backend.app import cache, db
from backend.app.compute import signals
from backend.app.repo import read
from backend.tests.test_b14_audit import two_sector_inputs  # noqa: F401
from backend.tests.test_b7_signals import signal_inputs, weekly_db  # noqa: F401
from backend.tests.test_b8_read import client, read_db  # noqa: F401

MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
LABEL_RE = re.compile(r"^\d{1,2}–\d{1,2} [A-Z][a-z]{2} \d{4}$")


def _upload(client: TestClient, name: str, data: bytes, query: str = ""):
    files = {"file": (name, data, MIME)}
    return client.post(f"/api/v1/admin/import/excel{query}", files=files)


# --- A) run `already_imported` = skipped, bukan failed -------------------------


def test_already_imported_tercatat_skipped(tmp_db, fixture_xlsx, monkeypatch):
    """Import file yang sama 2×: run kedua `skipped` (prasyarat terpenuhi), HTTP tetap 409."""
    monkeypatch.setattr(db, "db_path", lambda: tmp_db)
    from backend.app.main import app

    c = TestClient(app)
    first = _upload(c, "kecil.xlsx", fixture_xlsx)
    assert first.status_code == 200 and first.json()["inserted"] == 5

    second = _upload(c, "kecil.xlsx", fixture_xlsx)
    assert second.status_code == 409  # kontrak HTTP tidak berubah
    assert second.json()["error"]["code"] == "already_imported"
    assert second.json()["error"]["detail"]["import_id"] == first.json()["import_id"]
    assert second.json()["error"]["detail"]["sha256"]

    runs = c.get("/api/v1/admin/runs").json()["runs"]
    assert [r["status"] for r in runs[:2]] == ["skipped", "ok"]
    assert runs[0]["message"] == f"file sudah pernah diimport (import_id={first.json()['import_id']})"
    assert runs[0]["kind"] == "import_excel"


def test_kegagalan_nyata_tetap_failed(tmp_db, tmp_path, monkeypatch):
    """File rusak & file tanpa baris valid bukan "sudah pernah diimport" — tetap `failed`."""
    monkeypatch.setattr(db, "db_path", lambda: tmp_db)
    from backend.app.main import app
    from backend.tests.fixtures import write_xlsx

    # file rusak melempar error dari openpyxl (belum dipetakan ke 400 — dicatat di PROGRESS);
    # yang diuji di sini: run-nya `failed`, bukan `skipped`.
    c = TestClient(app, raise_server_exceptions=False)
    assert _upload(c, "rusak.xlsx", b"ini bukan file xlsx").status_code >= 400

    assert _upload(c, "kosong.xlsx", write_xlsx(tmp_path / "kosong.xlsx", {"IDXBASIC": [("XX", "bukan kode", None, None, None)]})).status_code == 400

    runs = c.get("/api/v1/admin/runs").json()["runs"]
    assert [r["status"] for r in runs[:2]] == ["failed", "failed"]
    assert all("sudah pernah diimport" not in (r["message"] or "") for r in runs[:2])


# --- B) data_status.range_from / range_to / range_label ------------------------


def test_data_status_range_w1_fri_senin_jumat(two_sector_inputs, monkeypatch):
    """`w1_fri` = Senin..Jumat minggu itu, tidak terpengaruh `window`; label dibaca manusia."""
    monkeypatch.setattr(db, "db_path", lambda: two_sector_inputs)
    cache.clear()
    from backend.app.main import app

    body = TestClient(app).get("/api/v1/rrg?timeframe=w1_fri&window=3m").json()
    status = body["data_status"]
    assert status["as_of"] == body["as_of"]
    assert date.fromisoformat(status["range_from"]).weekday() == 0  # Senin
    assert date.fromisoformat(status["range_to"]).weekday() == 4  # Jumat
    assert status["range_to"] == body["as_of"]
    assert status["range_label"] == read.range_label(status["range_from"], status["range_to"])
    assert LABEL_RE.match(status["range_label"]), status["range_label"]


def test_range_d1_ikut_window_untuk_kolom_return(read_db, monkeypatch):
    """`d1` tanpa window = satu hari; dengan `window` = bar terjauh kolom return/ekor (docs/05 §0)."""
    monkeypatch.setattr(db, "db_path", lambda: read_db)
    cache.clear()
    from backend.app.main import app

    c = TestClient(app)
    windows = {
        "1w": 7,
        "1m": 31,
        "3m": 92,
        "6m": 183,
        "1y": 366,
    }
    for window, days in windows.items():
        status = c.get(f"/api/v1/rrg?timeframe=d1&window={window}").json()["data_status"]
        as_of = date.fromisoformat(status["as_of"])
        assert status["range_to"] == status["as_of"]
        assert date.fromisoformat(status["range_from"]) == as_of - timedelta(days=days), window


def test_range_midday_dan_w1(read_db, monkeypatch):
    """`midday` = hari ini..hari ini; `w1` = Senin minggu berjalan..hari bursa terakhir."""
    monkeypatch.setattr(db, "db_path", lambda: read_db)
    cache.clear()
    from backend.app.main import app

    c = TestClient(app)
    for timeframe in ("w1", "midday"):
        status = c.get(f"/api/v1/sectors/summary?timeframe={timeframe}").json()["data_status"]
        if status["as_of"] is None:  # fixture tidak punya hasil hitung timeframe itu
            assert (status["range_from"], status["range_to"], status["range_label"]) == (None, None, None)
            continue
        assert status["range_to"] == status["as_of"]
        if timeframe == "midday":
            assert status["range_from"] == status["as_of"]
            assert status["range_label"] == read.range_label(status["as_of"], status["as_of"])


def test_range_null_bila_belum_ada_hasil(tmp_db, monkeypatch):
    """DB baru tanpa hasil hitung: ketiga field `null` (UI menampilkan "belum ada data")."""
    monkeypatch.setattr(db, "db_path", lambda: tmp_db)
    cache.clear()
    from backend.app.main import app

    c = TestClient(app)
    for path in ("/api/v1/sectors/summary", "/api/v1/rrg", "/api/v1/heatmap", "/api/v1/rotation/matrix", "/api/v1/briefing/morning"):
        status = c.get(path).json().get("data_status")
        assert status is not None, path  # setiap response hasil hitung wajib punya blok ini
        assert status["as_of"] is None and status["status"] == "stale", path
        assert (status["range_from"], status["range_to"], status["range_label"]) == (None, None, None), path


def test_data_status_muncul_di_heatmap_matrix_dan_detail_saham(read_db, monkeypatch):
    """Endpoint yang tadinya tanpa `data_status` kini membawanya (docs/05 §0)."""
    monkeypatch.setattr(db, "db_path", lambda: read_db)
    cache.clear()
    from backend.app.main import app

    c = TestClient(app)
    for path in ("/api/v1/heatmap", "/api/v1/rotation/matrix", "/api/v1/stocks/AAAA"):
        status = c.get(path).json()["data_status"]
        assert status["range_label"], path
        assert set(status) == {
            "as_of",
            "timeframe",
            "status",
            "last_data_at",
            "computed_at",
            "range_from",
            "range_to",
            "range_label",
            "partial_sectors",
            "detail",
        }


def test_series_label_konsisten(read_db, monkeypatch):
    """`/series/sector/{code}` memakai label rentang yang sama dengan `data_status` (docs/05 §0)."""
    monkeypatch.setattr(db, "db_path", lambda: read_db)
    cache.clear()
    from backend.app.main import app

    body = TestClient(app).get("/api/v1/series/sector/IDXFINANCE?from=2026-09-01").json()
    assert body["range_from"] == "2026-09-01"
    assert body["range_label"] == read.range_label(body["range_from"], body["range_to"])
    assert body["points"] and body["points"][0]["date"] >= "2026-09-01"


# --- C) /weekly/picks: week_start + week_label ---------------------------------


def test_weekly_picks_week_start_dan_label(signal_inputs, monkeypatch):
    """`week_start` = Senin minggu `week_end`, `week_label` = "5–9 Okt 2026" (docs/05 §3, api 1.1)."""
    monkeypatch.setattr(db, "db_path", lambda: signal_inputs)
    cache.clear()
    signals.compute_signals(db_path=signal_inputs)
    from backend.app.main import app

    body = TestClient(app).get("/api/v1/weekly/picks").json()
    assert body["api_version"] == "1.1"
    assert body["sectors"], "fixture harus punya pick"
    assert date.fromisoformat(body["week_end"]).weekday() == 4  # Jumat
    assert date.fromisoformat(body["week_start"]).weekday() == 0  # Senin
    assert body["week_label"] == read.range_label(body["week_start"], body["week_end"])
    assert LABEL_RE.match(body["week_label"]), body["week_label"]


def test_weekly_picks_kosong_tetap_punya_field_baru(tmp_db, monkeypatch):
    monkeypatch.setattr(db, "db_path", lambda: tmp_db)
    cache.clear()
    from backend.app.main import app

    body = TestClient(app).get("/api/v1/weekly/picks").json()
    assert body["api_version"] == "1.1"
    assert body["week_end"] is None and body["week_start"] is None and body["week_label"] is None
    assert body["sectors"] == [] and body["stocks"] == [] and body["is_final"] is False
