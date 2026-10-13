"""Query tabel `ingest_run` (docs/04 §4) — riwayat & progres job pipeline."""

from __future__ import annotations

import json
import sqlite3

from ..db import now_iso


def start(conn: sqlite3.Connection, kind: str, params: dict, triggered_by: str = "cli") -> int:
    cur = conn.execute(
        """
        INSERT INTO ingest_run (kind, status, started_at, params_json, triggered_by)
        VALUES (?, 'queued', ?, ?, ?)
        """,
        (kind, now_iso(), json.dumps(params, ensure_ascii=False, default=str), triggered_by),
    )
    conn.commit()
    return cur.lastrowid


def mark_running(conn: sqlite3.Connection, run_id: int) -> None:
    conn.execute("UPDATE ingest_run SET status = 'running' WHERE id = ?", (run_id,))
    conn.commit()


def report(
    conn: sqlite3.Connection,
    run_id: int,
    *,
    rows: int | None = None,
    rows_total: int | None = None,
    message: str | None = None,
    phase: str | None = None,
) -> None:
    """Tulis progres (dipanggil per batch, bukan per baris — docs/07 B12 #5).

    Best-effort: job panjang boleh menahan kunci tulis saat koneksi lain menulis. Progres kosmetik,
    jadi kegagalan `locked` dilewati supaya tidak membunuh job 60 detik hanya karena UI memantau.
    """
    percent = round(rows * 100.0 / rows_total, 1) if rows is not None and rows_total else None
    try:
        conn.execute(
            """
            UPDATE ingest_run
            SET rows = COALESCE(?, rows), rows_total = COALESCE(?, rows_total), percent = COALESCE(?, percent),
                message = COALESCE(?, message), phase = COALESCE(?, phase)
            WHERE id = ?
            """,
            (rows, rows_total, percent, message, phase, run_id),
        )
        conn.commit()
    except sqlite3.OperationalError as exc:
        if "locked" not in str(exc):
            raise
        try:
            conn.rollback()
        except sqlite3.Error:
            pass


def finish(
    conn: sqlite3.Connection,
    run_id: int,
    status: str,
    *,
    rows: int | None = None,
    message: str | None = None,
    result: dict | None = None,
) -> None:
    conn.execute(
        """
        UPDATE ingest_run
        SET status = ?, finished_at = ?, rows = COALESCE(?, rows), percent = ?, message = COALESCE(?, message),
            result_json = ?
        WHERE id = ?
        """,
        (
            status,
            now_iso(),
            rows,
            100.0 if status in ("ok", "partial") else None,
            message,
            json.dumps(result, ensure_ascii=False, default=str) if result is not None else None,
            run_id,
        ),
    )
    conn.commit()


def _shape(row: sqlite3.Row) -> dict:
    """Bentuk respons `docs/05` §4.3. `params_json`/`result_json` ikut (dibutuhkan panel riwayat F12)."""
    result = json.loads(row["result_json"]) if row["result_json"] else None
    return {
        "run_id": row["id"],
        "kind": row["kind"],
        "status": row["status"],
        "phase": row["phase"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
        "rows": row["rows"],
        "rows_total": row["rows_total"],
        "percent": row["percent"],
        "message": row["message"],
        "triggered_by": row["triggered_by"],
        "failed_tickers": (result or {}).get("failed_tickers") or [],
        "params_json": json.loads(row["params_json"]) if row["params_json"] else None,
        "result_json": result,
    }


def get(conn: sqlite3.Connection, run_id: int) -> dict | None:
    row = conn.execute("SELECT * FROM ingest_run WHERE id = ?", (run_id,)).fetchone()
    return _shape(row) if row else None


def list_recent(conn: sqlite3.Connection, limit: int = 20) -> list[dict]:
    rows = conn.execute("SELECT * FROM ingest_run ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [_shape(r) for r in rows]
