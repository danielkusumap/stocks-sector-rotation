"""Query baca bersama untuk endpoint `docs/05` §1–§2 (RRG, tabel sektor, saham)."""

from __future__ import annotations

from datetime import date, timedelta

from ..ingest import freshness
from ..labels import WINDOW_DAYS


def split_multi(values) -> list[str]:
    """`?sector=A&sector=B` dan `?sector=A,B` dua-duanya jalan (docs/05 konvensi)."""
    out: list[str] = []
    for value in values or []:
        for part in str(value).split(","):
            part = part.strip().upper()
            if part and part not in out:
                out.append(part)
    return out


def split_kwargs(values) -> list[str]:
    """Kuadran: uppercase juga aman, tapi nilainya lowercase di DB."""
    return [v.lower() for v in split_multi(values)]


def resolve_as_of(conn, timeframe: str, *, scope: str = "sector", weighting: str | None = None, as_of: str | None = None) -> str | None:
    """Default `as_of` = tanggal terakhir yang ada di `rrg_daily` untuk timeframe itu."""
    if as_of:
        return as_of
    sql = "SELECT MAX(as_of_date) FROM rrg_daily WHERE timeframe = ? AND scope = ?"
    params: list = [timeframe, scope]
    if weighting:
        sql += " AND weighting = ?"
        params.append(weighting)
    row = conn.execute(sql, params).fetchone()
    return row[0] if row else None


def data_status(conn, *, as_of: str | None, timeframe: str, weighting: str) -> dict:
    """Blok `data_status` konvensi `docs/05` (status: ok | stale | partial).

    `stale` mengikuti blok `daily_ingest` dari `freshness.read` (dihitung dari `price_daily`), jadi
    tidak ada ambang tanggal yang dikarang di sini (ADR-023).
    """
    partial_sectors = [
        r[0]
        for r in conn.execute(
            "SELECT s.code FROM sector_index_daily i JOIN sector s ON s.id = i.sector_id"
            " WHERE i.date = ? AND i.weighting = ? AND i.partial = 1 ORDER BY s.sort_order",
            (as_of, weighting),
        )
    ]
    computed_at = conn.execute(
        "SELECT MAX(computed_at) FROM rrg_daily WHERE as_of_date = ? AND timeframe = ?", (as_of, timeframe)
    ).fetchone()[0]
    daily = freshness.read(conn).get("daily_ingest") or {}
    if partial_sectors:
        status = "partial"
    elif daily.get("status") in ("stale", "partial", "failed"):
        status = "stale"
    else:
        status = "ok"
    return {
        "as_of": as_of,
        "timeframe": timeframe,
        "status": status,
        "last_data_at": daily.get("last_data_at"),
        "computed_at": computed_at,
        "partial_sectors": partial_sectors,
    }


def streak_map(conn) -> dict[str, int]:
    """`streak_weeks` terakhir per ref_id (0 bila tidak pernah muncul) — `docs/05` §2."""
    rows = conn.execute(
        """
        SELECT ref_id, streak_weeks FROM signal_weekly w
        WHERE week_end = (SELECT MAX(week_end) FROM signal_weekly)
        """
    )
    return {r[0]: r[1] for r in rows}


def window_start(as_of: str | None, window: str) -> str | None:
    """Awal jendela; `ytd` = 1 Januari tahun `as_of`, `1w`..`1y` = hari kalender sesuai `WINDOW_DAYS`."""
    if not as_of or (window != "ytd" and window not in WINDOW_DAYS):
        return None
    if window == "ytd":
        return f"{as_of[:4]}-01-01"
    return (date.fromisoformat(as_of) - timedelta(days=WINDOW_DAYS[window])).isoformat()


def tail_points(requested: int | None, *, default_periods: int) -> int:
    """`tail_points` default = jumlah periode dalam `window`, maks 60."""
    if requested:
        return max(1, min(int(requested), 60))
    return max(2, min(default_periods, 60))


# Perkiraan jumlah periode per window untuk default `tail_points` (docs/05 §2 /rrg).
PERIODS_PER_WINDOW = {
    "d1": {"1w": 5, "1m": 21, "3m": 63, "6m": 126, "1y": 252, "ytd": 120},
    "w1": {"1w": 1, "1m": 4, "3m": 13, "6m": 26, "1y": 52, "ytd": 30},
    "w1_fri": {"1w": 1, "1m": 4, "3m": 13, "6m": 26, "1y": 52, "ytd": 30},
    "midday": {"1w": 5, "1m": 21, "3m": 63, "6m": 126, "1y": 252, "ytd": 120},
}
