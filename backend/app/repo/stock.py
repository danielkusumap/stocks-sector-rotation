"""Query tabel `stock` (universe). Dipakai pengecekan prasyarat job (docs/05 §4.1)."""

from __future__ import annotations

import sqlite3


def active_count(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) FROM stock WHERE is_active = 1").fetchone()[0]


def prices_coverage(conn: sqlite3.Connection) -> float:
    """Bagian emiten aktif yang sudah punya bar harian di `price_daily` (prasyarat compute)."""
    total = active_count(conn)
    if not total:
        return 0.0
    covered = conn.execute(
        """
        SELECT COUNT(*) FROM stock st
        WHERE st.is_active = 1 AND EXISTS (SELECT 1 FROM price_daily p WHERE p.ticker = st.ticker)
        """
    ).fetchone()[0]
    return covered / total
