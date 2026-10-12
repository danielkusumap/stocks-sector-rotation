"""Query tabel `stock` (universe). Dipakai pengecekan prasyarat job (docs/05 §4.1)."""

from __future__ import annotations

import sqlite3


def active_count(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) FROM stock WHERE is_active = 1").fetchone()[0]
