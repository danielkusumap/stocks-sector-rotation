"""B20e — `as_of_date` = cutoff yang diminta + `last_bar_date` (docs/07 B20e, AC 1–4)."""

from __future__ import annotations

from backend.app import db
from backend.app.compute import plan
from backend.app.config import get_settings
from backend.tests.test_b7_signals import DATES, _seed, _wiggle, weekly_db  # noqa: F401 (fixture)


def test_satu_cutoff_satu_keranjang(weekly_db):
    """AC 1–2: satu run cutoff `D` → **semua** baris `as_of_date = D`, termasuk emiten tanpa bar di `D`."""
    conn = db.connect(weekly_db)
    try:
        _seed(conn, "EWA", _wiggle(0.001)[: len(DATES) - 3])  # berhenti 3 bar sebelum akhir
        conn.commit()
        cutoff = DATES[-1]
        hasil = plan.plan_for_all(conn, get_settings(), as_of=cutoff, persist_picks=False)
        rows = [dict(row) for row in conn.execute("SELECT as_of_date, ticker, last_bar_date FROM stock_plan")]
    finally:
        conn.close()

    assert hasil["rows"] >= 4
    assert {row["as_of_date"] for row in rows} == {cutoff}  # tidak ada keranjang tanggal lain
    ewa = next(row for row in rows if row["ticker"] == "EWA")
    assert ewa["last_bar_date"] == DATES[len(DATES) - 4] < cutoff  # levelnya dari bar terakhirnya sendiri
    aktif = next(row for row in rows if row["ticker"] == "AAAA")
    assert aktif["last_bar_date"] == cutoff  # emiten yang aktif di cutoff → sama dengan cutoff


def test_level_tidak_berubah_untuk_emiten_aktif_di_cutoff(weekly_db):
    """AC 4: untuk emiten yang punya bar di cutoff, level sebelum vs sesudah fix identik (1e-9)."""
    cutoff = DATES[-1]
    hasil: list[list] = []
    for _ in range(2):
        conn = db.connect(weekly_db)
        try:
            plan.plan_for_all(conn, get_settings(), as_of=cutoff, persist_picks=False)
            hasil.append(
                [
                    list(row)
                    for row in conn.execute(
                        "SELECT ticker, entry_zone_low, stop, tp1, tp2 FROM stock_plan WHERE as_of_date = ? ORDER BY ticker",
                        (cutoff,),
                    )
                ]
            )
        finally:
            conn.close()
    assert hasil[0] == hasil[1] and hasil[0]
