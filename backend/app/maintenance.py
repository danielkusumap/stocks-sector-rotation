"""Perawatan DB (docs/07 B10): pangkas data lama sesuai `config.retention`, VACUUM bila file besar."""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from . import db
from .config import get_settings

INTRADAY_DELETE_SQL = "DELETE FROM price_intraday WHERE substr(ts, 1, 10) < ?"
MIDDAY_RRG_DELETE_SQL = "DELETE FROM rrg_daily WHERE timeframe = 'midday' AND as_of_date < ?"
MIDDAY_METRICS_DELETE_SQL = "DELETE FROM sector_metrics WHERE timeframe = 'midday' AND as_of_date < ?"
STOCK_PLAN_DELETE_SQL = "DELETE FROM stock_plan WHERE as_of_date < ?"
PLAN_PICK_DELETE_SQL = "DELETE FROM plan_pick WHERE as_of_date < ?"


def retention(*, db_path=None) -> dict:
    """Hapus bar intraday & baris `midday` yang lebih tua dari ambang di config.

    `logging.keep_days` sengaja tidak dipakai: tidak ada tabel log — pesan run hidup di
    `ingest_run` yang justru ingin disimpan user sebagai riwayat (ADR-026).
    """
    cfg = get_settings()
    today = datetime.now(ZoneInfo(cfg.app.timezone)).date()
    intraday_cutoff = (today - timedelta(days=cfg.retention["intraday_days"])).isoformat()
    midday_cutoff = (today - timedelta(days=cfg.retention["midday_rrg_days"])).isoformat()
    plan_cutoff = (today - timedelta(days=cfg.retention["plan_days"])).isoformat()

    conn = db.connect(db_path)
    try:
        intraday = conn.execute(INTRADAY_DELETE_SQL, (intraday_cutoff,)).rowcount
        rrg = conn.execute(MIDDAY_RRG_DELETE_SQL, (midday_cutoff,)).rowcount
        metrics = conn.execute(MIDDAY_METRICS_DELETE_SQL, (midday_cutoff,)).rowcount
        plans = conn.execute(STOCK_PLAN_DELETE_SQL, (plan_cutoff,)).rowcount
        picks = conn.execute(PLAN_PICK_DELETE_SQL, (plan_cutoff,)).rowcount
        conn.commit()

        target = Path(db_path) if db_path else db.db_path()
        size_mb = target.stat().st_size / 1_000_000
        vacuumed = False
        if size_mb >= cfg.retention["vacuum_min_file_mb"]:
            conn.execute("VACUUM")
            vacuumed = True
        return {
            "intraday_deleted": intraday,
            "midday_rrg_deleted": rrg,
            "midday_metrics_deleted": metrics,
            "stock_plan_deleted": plans,
            "plan_pick_deleted": picks,
            "intraday_cutoff": intraday_cutoff,
            "midday_cutoff": midday_cutoff,
            "plan_cutoff": plan_cutoff,
            "size_mb": round(size_mb, 1),
            "vacuumed": vacuumed,
        }
    finally:
        conn.close()
