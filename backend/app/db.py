"""SQLite: koneksi + PRAGMA, db-init (schema.sql), runner migrasi bernomor (docs/04 §7)."""

from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path

from .config import ROOT, get_settings

DB_DIR = Path(__file__).resolve().parent / "db"
SCHEMA_FILE = DB_DIR / "schema.sql"
SEED_SECTORS_FILE = DB_DIR / "seed_sectors.sql"
MIGRATIONS_DIR = DB_DIR / "migrations"


def now_iso() -> str:
    """Timestamp ISO-8601 dengan offset lokal (+07:00 di mesin user)."""
    return datetime.now().astimezone().isoformat(timespec="seconds")


def db_path() -> Path:
    p = Path(get_settings().database.path)
    return p if p.is_absolute() else ROOT / p


def connect(path: str | Path | None = None) -> sqlite3.Connection:
    """Buka koneksi (+PRAGMA dari config). Pemanggil yang menutup."""
    target = Path(path) if path else db_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    cfg = get_settings().database
    conn = sqlite3.connect(target)
    conn.row_factory = sqlite3.Row
    # PRAGMA tidak menerima parameter binding; nilainya dari config lokal (bukan input request).
    conn.execute(f"PRAGMA journal_mode={cfg.journal_mode}")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute(f"PRAGMA busy_timeout={int(cfg.busy_timeout_ms)}")
    return conn


def table_count(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0]


def _statements(sql: str) -> list[str]:
    """Potong berkas migrasi jadi statement satu per satu.

    Komentar `--` (baris penuh maupun di ujung baris) dibuang **sebelum** memotong, karena komentar
    bisa memuat `;` (mis. keterangan kolom) dan akan memotong statement di tengah.
    """
    lines = [line.split("--", 1)[0] for line in sql.splitlines()]
    return [part.strip() for part in "\n".join(line for line in lines if line.strip()).split(";") if part.strip()]


def apply_migrations(conn: sqlite3.Connection) -> int:
    """Jalankan `db/migrations/NNN_*.sql` berurutan; versi terakhir dicatat di PRAGMA user_version.

    Setiap statement dijalankan sendiri dan `ADD COLUMN` untuk kolom yang sudah ada diabaikan
    (`duplicate column name`) — db baru sudah memuat kolomnya dari schema.sql, dan db yang sebagian
    sudah termigrasi tetap melanjutkan sampai statement terakhir (docs/04 §7: idempotent-safe).
    """
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if not MIGRATIONS_DIR.is_dir():
        return version
    for f in sorted(MIGRATIONS_DIR.glob("[0-9]*_*.sql")):
        n = int(f.name.split("_", 1)[0])
        if n <= version:
            continue
        for statement in _statements(f.read_text(encoding="utf-8")):
            try:
                conn.execute(statement)
            except sqlite3.OperationalError as exc:
                if "duplicate column name" not in str(exc):
                    raise
        conn.execute(f"PRAGMA user_version={n}")
        version = n
    return version


def init_db(path: str | Path | None = None) -> dict:
    """Buat/perbarui skema. Aman dijalankan berulang (semua objek IF NOT EXISTS)."""
    target = Path(path) if path else db_path()
    conn = connect(target)
    try:
        conn.executescript(SCHEMA_FILE.read_text(encoding="utf-8"))
        conn.executescript(SEED_SECTORS_FILE.read_text(encoding="utf-8"))  # master 11 sektor (INSERT OR IGNORE)
        version = apply_migrations(conn)
        conn.commit()
        return {"path": str(target), "tables": table_count(conn), "user_version": version}
    finally:
        conn.close()
