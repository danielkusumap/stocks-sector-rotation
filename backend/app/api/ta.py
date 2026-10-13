"""Endpoint analisa teknikal & backtest MA (docs/05 §2): `/ta/summary`, `/ta/{scope}/{ref_id}`.

Statistik TIDAK disimpan (docs/04 §4) — diagregasi di sini setiap permintaan supaya tidak ada angka basi.
Rumusnya di `compute/ta.py`; angka ambang hanya dari `config ta.*`.
"""

from __future__ import annotations

from statistics import median

from fastapi import APIRouter, HTTPException, Query

from .. import db
from ..compute import ta as ta_compute
from ..config import get_settings
from ..repo import read
from .rrg import _check
from .schemas import TaDetailResponse, TaSummaryResponse

router = APIRouter(prefix="/api/v1", tags=["ta"])
_API_VERSION = "1.0"
PRICE_BASIS = "adj_close"  # docs/03 §10: selalu harga penyesuaian, bukan `close` mentah

REF_SQL = {
    "stock": """
        SELECT st.ticker AS ref_id, st.name, sec.code AS sector_code
        FROM stock st JOIN sector sec ON sec.id = st.sector_id
        WHERE st.is_active = 1 ORDER BY st.ticker
    """,
    "sector": "SELECT code AS ref_id, name_id AS name, NULL AS sector_code FROM sector WHERE is_active = 1 ORDER BY sort_order",
}
HEAD_SQL = {
    "stock": """
        SELECT st.name, sec.code AS sector_code FROM stock st JOIN sector sec ON sec.id = st.sector_id
        WHERE st.ticker = ?
    """,
    "sector": "SELECT name_id AS name, NULL AS sector_code FROM sector WHERE code = ?",
}
# Bar terakhir (`rn = 1`) + MA `p` bar terakhir. `n` dipakai untuk menolak jendela parsial (docs/03 §10.1).
LAST_SQL = {
    "stock": """
        SELECT ref_id, date, close, ma, n FROM (
          SELECT ticker AS ref_id, date, adj_close AS close,
                 AVG(adj_close) OVER (PARTITION BY ticker ORDER BY date ROWS BETWEEN ?-1 PRECEDING AND CURRENT ROW) AS ma,
                 COUNT(*) OVER (PARTITION BY ticker) AS n,
                 ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC) AS rn
          FROM price_daily WHERE adj_close IS NOT NULL AND date <= ?
        ) WHERE rn = 1
    """,
    "sector": """
        SELECT ref_id, date, close, ma, n FROM (
          SELECT s.code AS ref_id, i.date, i.index_close AS close,
                 AVG(i.index_close) OVER (PARTITION BY s.code ORDER BY i.date ROWS BETWEEN ?-1 PRECEDING AND CURRENT ROW) AS ma,
                 COUNT(*) OVER (PARTITION BY s.code) AS n,
                 ROW_NUMBER() OVER (PARTITION BY s.code ORDER BY i.date DESC) AS rn
          FROM sector_index_daily i JOIN sector s ON s.id = i.sector_id
          WHERE s.is_active = 1 AND i.weighting = ? AND i.date <= ?
        ) WHERE rn = 1
    """,
}
EVENTS_SQL = """
    SELECT ref_id, signal_date, entry_date, entry_price, entry_basis, result, exit_date, exit_price, periods
    FROM ta_breakout WHERE scope = ? AND ma_period = ? AND trend_filter = ?
    ORDER BY signal_date
"""
REF_EVENTS_SQL = """
    SELECT signal_date, entry_date, entry_price, entry_basis, result, exit_date, exit_price, periods
    FROM ta_breakout WHERE scope = ? AND ref_id = ? AND ma_period = ? AND trend_filter = ?
    ORDER BY signal_date
"""
SINCE_SQL = {
    "stock": "SELECT COUNT(*) FROM price_daily WHERE ticker = ? AND adj_close IS NOT NULL AND date > ? AND date <= ?",
    "sector": """
        SELECT COUNT(*) FROM sector_index_daily i JOIN sector s ON s.id = i.sector_id
        WHERE s.code = ? AND i.weighting = ? AND i.date > ? AND i.date <= ?
    """,
}
TESTED_SQL = {
    "stock": ("SELECT COUNT(*) FROM (SELECT ticker FROM price_daily WHERE adj_close IS NOT NULL GROUP BY ticker HAVING COUNT(*) >= ?)", False),
    "sector": (
        """SELECT COUNT(*) FROM (SELECT i.sector_id FROM sector_index_daily i JOIN sector s ON s.id = i.sector_id
           WHERE s.is_active = 1 AND i.weighting = ? GROUP BY i.sector_id HAVING COUNT(*) >= ?)""",
        True,
    ),
}
ACTIVE_SQL = {"stock": "SELECT COUNT(*) FROM stock WHERE is_active = 1", "sector": "SELECT COUNT(*) FROM sector WHERE is_active = 1"}
BARS_MAX_SQL = {
    "stock": "SELECT MAX(date) FROM price_daily WHERE adj_close IS NOT NULL",
    "sector": """SELECT MAX(i.date) FROM sector_index_daily i JOIN sector s ON s.id = i.sector_id
                 WHERE s.is_active = 1 AND i.weighting = ?""",
}
BARS_RANGE_SQL = {
    "stock": "SELECT MIN(date), MAX(date) FROM price_daily WHERE adj_close IS NOT NULL",
    "sector": """SELECT MIN(i.date), MAX(i.date) FROM sector_index_daily i JOIN sector s ON s.id = i.sector_id
                 WHERE i.weighting = ? AND s.is_active = 1""",
}
SORT_COLUMN = {
    "win_rate": "win_rate",
    "median_periods": "median_periods_win",
    "events": "n_events",
    "ref_id": "ref_id",
}


def _error(status: int, code: str, message: str, detail: dict | None = None) -> HTTPException:
    return HTTPException(status, {"code": code, "message": message, "detail": detail or {}})


def _ma_period_or_default(ma_period: int | None, cfg) -> int:
    """`config.ta.ma_default` sebagai default; nilai sah hanya `config.ta.ma_periods` (docs/05 §2)."""
    ma_period = cfg.ta["ma_default"] if ma_period is None else int(ma_period)
    if ma_period not in cfg.ta["ma_periods"]:
        raise _error(
            400,
            "invalid_ma_period",
            f"ma_period harus salah satu dari: {', '.join(str(p) for p in cfg.ta['ma_periods'])}",
            {"received": ma_period, "allowed": list(cfg.ta["ma_periods"])},
        )
    return ma_period


def _check_scope(scope: str) -> str:
    if scope not in ("sector", "stock"):
        raise _error(400, "invalid_scope", "scope harus sector atau stock", {"received": scope})
    return scope


def _stats(rows) -> dict:
    """docs/05 §2: `win_rate = win/(win+loss)`; `expired`/`open` bukan kekalahan; median, bukan mean."""
    counts = {key: 0 for key in ("win", "loss", "expired", "open")}
    periods: dict[str, list[int]] = {"win": [], "loss": []}
    for row in rows:
        result = row["result"]
        if result not in counts:
            continue
        counts[result] += 1
        if result in periods and row["periods"] is not None:
            periods[result].append(row["periods"])
    decided = counts["win"] + counts["loss"]
    return {
        "n_events": len(rows),
        "win": counts["win"],
        "loss": counts["loss"],
        "expired": counts["expired"],
        "open": counts["open"],
        "win_rate": round(counts["win"] / decided, 4) if decided else None,
        "median_periods_win": median(periods["win"]) if periods["win"] else None,
        "median_periods_loss": median(periods["loss"]) if periods["loss"] else None,
    }


def _last_bars(conn, scope: str, weighting: str, ma_period: int, as_of: str) -> dict[str, tuple]:
    """`ref_id → (close, ma)` pada `as_of`; `ma` `None` bila riwayat kurang dari `ma_period`."""
    params = (ma_period, as_of) if scope == "stock" else (ma_period, weighting, as_of)
    return {
        row["ref_id"]: (row["close"], None if row["n"] < ma_period else row["ma"])
        for row in conn.execute(LAST_SQL[scope], params)
    }


def _bars_since(conn, scope: str, ref_id: str, weighting: str, entry_date: str, as_of: str) -> int:
    """Periode bursa dari `entry_date` sampai `as_of` (bar entry = 0, docs/03 §10.6)."""
    params = (ref_id, entry_date, as_of) if scope == "stock" else (ref_id, weighting, entry_date, as_of)
    return conn.execute(SINCE_SQL[scope], params).fetchone()[0]


def _coverage(conn, scope: str, weighting: str, min_history: int) -> dict:
    sql, needs_weighting = TESTED_SQL[scope]
    tested = conn.execute(sql, (weighting, min_history) if needs_weighting else (min_history,)).fetchone()[0]
    total = conn.execute(ACTIVE_SQL[scope]).fetchone()[0]
    bars = conn.execute(BARS_RANGE_SQL[scope], (weighting,) if scope == "sector" else ()).fetchone()
    return {
        "refs_tested": tested,
        "refs_skipped_short_history": max(0, total - tested),
        "bars_from": bars[0],
        "bars_to": bars[1],
        "price_basis": PRICE_BASIS,
    }


def _max_bar_date(conn, scope: str, weighting: str) -> str | None:
    """`as_of` cadangan: kalau `rrg_daily` belum ada hasil hitung, pakai bar harga terakhir."""
    return conn.execute(BARS_MAX_SQL[scope], (weighting,) if scope == "sector" else ()).fetchone()[0]


def _last_breakout(conn, scope: str, ref_id: str, weighting: str, row, close: float | None, as_of: str) -> dict:
    """Konteks "sekarang" untuk event terbaru (docs/03 §10.6) — dihitung saat dipanggil, tidak disimpan."""
    gain = close / row["entry_price"] - 1 if close is not None else None
    return {
        "signal_date": row["signal_date"],
        "entry_date": row["entry_date"],
        "entry_price": row["entry_price"],
        "entry_basis": row["entry_basis"],
        "periods_since": _bars_since(conn, scope, ref_id, weighting, row["entry_date"], as_of),
        "gain_since": gain,
        "result": row["result"],
        "exit_date": row["exit_date"],
        "exit_price": row["exit_price"],
        "periods": row["periods"],
    }


@router.get("/ta/summary", response_model=TaSummaryResponse)
def ta_summary(
    scope: str = "sector",
    timeframe: str = "d1",
    weighting: str | None = None,
    ma_period: int | None = None,
    trend_filter: bool | None = None,
    sector: list[str] = Query(default=[]),
    q: str | None = None,
    min_events: int = 0,
    sort: str = "win_rate",
    dir: str = "desc",
    limit: int = Query(50, ge=1, le=500),
    offset: int = 0,
) -> dict:
    """Ringkasan backtest MA satu baris per entitas (docs/05 §2 `/ta/summary`)."""
    cfg = get_settings()
    _check_scope(scope)
    weighting = weighting or cfg.universe["weighting"]
    _check(timeframe, weighting, cfg)
    ma_period = _ma_period_or_default(ma_period, cfg)
    trend_filter = bool(cfg.ta["trend_filter"]) if trend_filter is None else bool(trend_filter)

    conn = db.connect()
    try:
        as_of = read.resolve_as_of(conn, timeframe, scope=scope, weighting=weighting) or _max_bar_date(conn, scope, weighting)
        last_bars = _last_bars(conn, scope, weighting, ma_period, as_of) if as_of else {}
        if not last_bars:
            raise _error(409, "prereq_no_prices", "belum ada bar harga — jalankan 'Ambil harga harian' dulu")

        events: dict[str, list] = {}
        for row in conn.execute(EVENTS_SQL, (scope, ma_period, int(trend_filter))):
            events.setdefault(row["ref_id"], []).append(row)

        items = []
        for ref in conn.execute(REF_SQL[scope]):
            ref_id = ref["ref_id"]
            rows = events.get(ref_id, [])
            stats = _stats(rows)
            if stats["n_events"] < int(min_events):  # baris tetap tampil, angkanya `null` (docs/05 §2)
                stats = {key: None for key in stats}
            close, ma = last_bars.get(ref_id, (None, None))
            items.append(
                {
                    "ref_id": ref_id,
                    "name": ref["name"],
                    "sector_code": ref["sector_code"],
                    "close": close,
                    "ma": ma,
                    "above_ma": None if (close is None or ma is None) else close > ma,
                    **stats,
                    "last_breakout": _last_breakout(conn, scope, ref_id, weighting, rows[-1], close, as_of) if rows else None,
                }
            )

        wanted = read.split_multi(sector)
        if wanted:
            items = [i for i in items if i["sector_code"] in wanted]
        if q:
            needle = q.strip().lower()
            items = [i for i in items if needle in i["ref_id"].lower() or needle in (i["name"] or "").lower()]

        if sort in ("last_breakout", "gain_since_breakout"):  # dua kunci itu ada di dalam `last_breakout`
            field = "signal_date" if sort == "last_breakout" else "gain_since"
            value_of = lambda i: (i["last_breakout"] or {}).get(field)
        else:
            key = SORT_COLUMN.get(sort, "win_rate")
            value_of = lambda i: i[key]
        items.sort(key=lambda i: (value_of(i) is None, value_of(i) or 0), reverse=(dir != "asc"))

        body = {
            "api_version": _API_VERSION,
            "scope": scope,
            "timeframe": timeframe,
            "ma_period": ma_period,
            "trend_filter": trend_filter,
            "total": len(items),
            "limit": int(limit),
            "offset": int(offset),
            "items": items[int(offset) : int(offset) + int(limit)],
            "coverage": _coverage(conn, scope, weighting, cfg.ta["min_history"]),
            "data_status": read.data_status(conn, as_of=as_of, timeframe=timeframe, weighting=weighting),
        }
    finally:
        conn.close()
    return body


@router.get("/ta/{scope}/{ref_id}", response_model=TaDetailResponse)
def ta_detail(
    scope: str,
    ref_id: str,
    timeframe: str = "d1",
    weighting: str | None = None,
    ma_period: int | None = None,
    trend_filter: bool | None = None,
    window: str = "3m",
    as_of: str | None = None,
    events: int = Query(20, ge=1, le=200),
) -> dict:
    """Detail satu entitas: seri MA, statistik dua varian filter, event terakhir (docs/05 §2 `/ta/{scope}/{ref_id}`)."""
    cfg = get_settings()
    _check_scope(scope)
    weighting = weighting or cfg.universe["weighting"]
    _check(timeframe, weighting, cfg)
    ma_period = _ma_period_or_default(ma_period, cfg)
    trend_filter = bool(cfg.ta["trend_filter"]) if trend_filter is None else bool(trend_filter)
    ref_id = ref_id.upper() if scope == "stock" else ref_id

    conn = db.connect()
    try:
        head = conn.execute(HEAD_SQL[scope], (ref_id,)).fetchone()
        if head is None:
            raise _error(404, "not_found", f"{scope} {ref_id} tidak ada", {"ref_id": ref_id})
        bars = ta_compute.load_bars(conn, scope, ref_id, weighting)
        if not bars:
            raise _error(409, "prereq_no_prices", f"belum ada bar harga untuk {ref_id}")

        as_of = as_of or read.resolve_as_of(conn, timeframe, scope=scope, weighting=weighting) or bars[-1][0]
        close = [b[1] for b in bars]
        ma_values = ta_compute.sma(close, ma_period)
        start = read.window_start(as_of, window)
        ma_series = [
            {"date": date, "close": value, "ma": ma}
            for (date, value, _), ma in zip(bars, ma_values)
            if ma is not None and date <= as_of and (start is None or date >= start)
        ]

        rows = {variant: list(conn.execute(REF_EVENTS_SQL, (scope, ref_id, ma_period, variant))) for variant in (1, 0)}
        chosen = rows[1 if trend_filter else 0]
        last_close = next((b[1] for b in reversed(bars) if b[0] <= as_of), None)
        body = {
            "api_version": _API_VERSION,
            "scope": scope,
            "ref_id": ref_id,
            "name": head["name"],
            "ma_period": ma_period,
            "trend_filter": trend_filter,
            "price_basis": PRICE_BASIS,
            "ma_series": ma_series,
            "stats": {"filter_on": _stats(rows[1]), "filter_off": _stats(rows[0])},
            "latest": _last_breakout(conn, scope, ref_id, weighting, chosen[-1], last_close, as_of) if chosen else None,
            "events": [
                {
                    "signal_date": row["signal_date"],
                    "entry_date": row["entry_date"],
                    "entry_price": row["entry_price"],
                    "result": row["result"],
                    "periods": row["periods"],
                    "exit_date": row["exit_date"],
                    "exit_price": row["exit_price"],
                }
                for row in reversed(chosen[-int(events) :])
            ],
            "coverage": _coverage(conn, scope, weighting, cfg.ta["min_history"]),
            "data_status": read.data_status(conn, as_of=as_of, timeframe=timeframe, weighting=weighting),
        }
    finally:
        conn.close()
    return body
