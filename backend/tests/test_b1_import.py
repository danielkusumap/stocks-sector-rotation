"""B1 — import Excel (aturan parsing: docs/02 §6)."""

from __future__ import annotations

from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from backend.app import db
from backend.app.config import ROOT
from backend.app.ingest import excel
from backend.tests.fixtures import BOARDS, FIXTURE_SHEETS, PER_SECTOR, write_xlsx

REAL_XLSX = ROOT / "saham_sektoral.xlsx"


# --- parsing helpers ---------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("BBCA", "BBCA"),
        ("bbca", "BBCA"),
        (" BBCA ", "BBCA"),
        ("BBCA.JK", "BBCA"),
        ("bbca.jk", "BBCA"),
        ("BCA", None),
        ("BCAA1", None),
        (None, None),
        ("", None),
    ],
)
def test_normalize_ticker(raw, expected):
    assert excel.normalize_ticker(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("06 Jul 2021", "2021-07-06"),
        ("6 Agt 1999", "1999-08-06"),
        ("01 Okt 2010", "2010-10-01"),
        ("25 Des 2020", "2020-12-25"),
        ("2021-07-06", "2021-07-06"),
        (datetime(2021, 7, 6), "2021-07-06"),
        ("tanggal tidak jelas", None),
        ("06 Foo 2021", None),
        (None, None),
    ],
)
def test_parse_listing_date(raw, expected):
    assert excel.parse_listing_date(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (8603416176, 8603416176),
        (8603416176.0, 8603416176),
        ("8.603.416.176", 8603416176),
        ("929675000", 929675000),
        (None, None),
        ("", None),
        ("tidak ada", None),
    ],
)
def test_parse_shares(raw, expected):
    assert excel.parse_shares(raw) == expected


def test_db_init_seeds_11_sectors(tmp_db):
    conn = db.connect(tmp_db)
    try:
        rows = conn.execute("SELECT code, sort_order, color_hex FROM sector ORDER BY sort_order").fetchall()
    finally:
        conn.close()
    codes = [r["code"] for r in rows]
    assert sorted(codes) == sorted(PER_SECTOR)
    assert len(codes) == 11
    assert [r["sort_order"] for r in rows] == list(range(1, 12))
    assert all(r["color_hex"].startswith("#") for r in rows)


# --- import file nyata -------------------------------------------------------


def test_import_real_file_then_force(tmp_db):
    data = REAL_XLSX.read_bytes()
    r1 = excel.import_excel(data, REAL_XLSX.name, db_path=tmp_db)
    assert r1["inserted"] == 962
    assert r1["updated"] == 0
    assert r1["deactivated"] == 0
    assert r1["errors"] == []
    assert r1["sheet_count"] == 11

    conn = db.connect(tmp_db)
    try:
        assert conn.execute("SELECT COUNT(*) FROM stock").fetchone()[0] == 962
        assert conn.execute("SELECT COUNT(*) FROM stock WHERE is_active = 1").fetchone()[0] == 962
        per_sector = {
            r["code"]: r["n"]
            for r in conn.execute(
                "SELECT s.code, COUNT(*) AS n FROM stock st JOIN sector s ON s.id = st.sector_id GROUP BY s.code"
            )
        }
        assert per_sector == PER_SECTOR
        boards = {r["board"]: r["n"] for r in conn.execute("SELECT board, COUNT(*) AS n FROM stock GROUP BY board")}
        assert boards == BOARDS
        for col in ("listing_date", "shares_outstanding"):
            sql = "SELECT COUNT(*) FROM stock WHERE listing_date IS NOT NULL"
            if col == "shares_outstanding":
                sql = "SELECT COUNT(*) FROM stock WHERE shares_outstanding IS NOT NULL"
            assert conn.execute(sql).fetchone()[0] >= 0.95 * 962, col
        bmhs = conn.execute(
            "SELECT ticker, yahoo_symbol, listing_date, shares_outstanding, board FROM stock WHERE ticker = 'BMHS'"
        ).fetchone()
        assert tuple(bmhs) == ("BMHS", "BMHS.JK", "2021-07-06", 8603416176, "Utama")

        # sha256 sama → ditolak, kecuali force
        with pytest.raises(excel.AlreadyImported):
            excel.import_excel(data, REAL_XLSX.name, db_path=tmp_db)
        r2 = excel.import_excel(data, REAL_XLSX.name, force=True, db_path=tmp_db)
        assert (r2["inserted"], r2["updated"], r2["deactivated"]) == (0, 962, 0)
        assert conn.execute("SELECT COUNT(*) FROM stock").fetchone()[0] == 962
        assert conn.execute("SELECT COUNT(*) FROM excel_import").fetchone()[0] == 1
        assert conn.execute("SELECT rows_ok FROM excel_import").fetchone()[0] == 962
    finally:
        conn.close()


def test_small_file_deactivates_missing(tmp_db):
    excel.import_excel(REAL_XLSX.read_bytes(), REAL_XLSX.name, db_path=tmp_db)
    fixture = write_xlsx(tmp_db.parent / "kecil.xlsx", FIXTURE_SHEETS)
    r = excel.import_excel(fixture, "kecil.xlsx", db_path=tmp_db)

    assert r["inserted"] == 0
    assert r["updated"] == 5
    assert r["deactivated"] == 957  # hilang dari file → is_active=0, baris tidak dihapus
    assert [e["reason"] for e in r["errors"]] == ["invalid_ticker", "duplicate_ticker"]
    assert r["errors"][0]["raw_value"] == "BCA"
    assert r["errors"][1]["raw_value"] == "BBCA"

    conn = db.connect(tmp_db)
    try:
        assert conn.execute("SELECT COUNT(*) FROM stock").fetchone()[0] == 962
        assert conn.execute("SELECT COUNT(*) FROM stock WHERE is_active = 1").fetchone()[0] == 5
        assert conn.execute("SELECT COUNT(*) FROM excel_import_error").fetchone()[0] == 2
    finally:
        conn.close()


def test_unknown_sheet_is_error_unless_strict(tmp_db, tmp_path):
    data = write_xlsx(
        tmp_path / "asing.xlsx",
        {"IDXFINANCE": FIXTURE_SHEETS["IDXFINANCE"], "FOO": [("AAAA", None, None, None, None)]},
    )

    with pytest.raises(excel.UnknownSheet):
        excel.import_excel(data, "asing.xlsx", strict=True, db_path=tmp_db)

    r = excel.import_excel(data, "asing.xlsx", db_path=tmp_db)
    assert r["inserted"] == 5
    assert [e["reason"] for e in r["errors"]] == ["unknown_sheet"]
    assert r["errors"][0]["sheet"] == "FOO"


def test_no_valid_rows_refused(tmp_db, tmp_path):
    data = write_xlsx(tmp_path / "kosong.xlsx", {"IDXBASIC": [("XX", "bukan kode", None, None, None)]})
    with pytest.raises(excel.NoValidRows):
        excel.import_excel(data, "kosong.xlsx", db_path=tmp_db)


# --- endpoint -----------------------------------------------------------------


def test_admin_import_endpoint(tmp_db, fixture_xlsx, monkeypatch):
    monkeypatch.setattr(db, "db_path", lambda: tmp_db)
    from backend.app.main import app

    client = TestClient(app)
    files = {"file": ("kecil.xlsx", fixture_xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}

    r = client.post("/api/v1/admin/import/excel", files=files)
    assert r.status_code == 200, r.text
    assert r.json()["inserted"] == 5

    r2 = client.post("/api/v1/admin/import/excel", files=files)
    assert r2.status_code == 409
    body = r2.json()
    assert body["api_version"] == "1.0"
    assert body["error"]["code"] == "already_imported"

    r3 = client.post("/api/v1/admin/import/excel?force=true", files=files)
    assert r3.status_code == 200
    assert r3.json()["updated"] == 5
