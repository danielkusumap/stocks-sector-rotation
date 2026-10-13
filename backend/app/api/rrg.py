"""Endpoint diagram, matriks, heatmap, dan seri (docs/05 §2)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from .. import cache, db
from ..config import get_settings
from ..constants import WEIGHTINGS
from ..labels import QUADRANT_DESC, QUADRANT_LABEL
from ..repo import read
from .schemas import HeatmapResponse, MatrixResponse, RrgResponse, SeriesSectorResponse

router = APIRouter(prefix="/api/v1", tags=["read"])
_API_VERSION = "1.0"
_RRG_API_VERSION = "1.1"  # field tambahan (Δ1p, streak) sesuai contoh docs/05 §2

ITEMS_SQL = """
    SELECT r.ref_id, r.as_of_date AS as_of, r.rs_ratio, r.rs_momentum, r.rs_ratio_change_1p, r.rs_momentum_change_1p,
           r.quadrant, r.quadrant_prev, r.transition, r.quadrant_age_periods, r.score, r.bench_ref,
           CASE WHEN r.scope = 'sector' THEN s.name_id ELSE st.name END AS name,
           CASE WHEN r.scope = 'sector' THEN s.color_hex ELSE sec.color_hex END AS color_hex,
           sec.code AS stock_sector, m.median_turnover_20d_idr, m.rank_score
    FROM rrg_daily r
    LEFT JOIN sector s   ON r.scope = 'sector' AND s.code = r.ref_id
    LEFT JOIN stock st   ON r.scope = 'stock'  AND st.ticker = r.ref_id
    LEFT JOIN sector sec ON sec.id = st.sector_id
    LEFT JOIN sector_metrics m ON r.scope = 'sector' AND m.sector_id = s.id
                              AND m.as_of_date = r.as_of_date AND m.timeframe = r.timeframe
                              AND m.weighting = r.weighting
    WHERE r.timeframe = ? AND r.weighting = ? AND r.as_of_date = ? AND r.scope = ?
"""
TAIL_SQL = """
    SELECT as_of_date, ref_id, rs_ratio, rs_momentum FROM rrg_daily
    WHERE timeframe = ? AND weighting = ? AND scope = ? AND as_of_date <= ?
    ORDER BY as_of_date
"""
RET_1W_SQL = """
    SELECT ret_1w FROM sector_metrics WHERE sector_id = (SELECT id FROM sector WHERE code = ?)
    AND as_of_date = ? AND timeframe = ? AND weighting = ?
"""
RET_5D_SQL = "SELECT ret_5d FROM stock_metrics WHERE ticker = ? AND timeframe = ? ORDER BY as_of_date DESC LIMIT 1"
SERIES_SQL = """
    SELECT i.date, i.index_close, i.turnover_idr, r.rs, b.close AS bench_close
    FROM sector_index_daily i
    JOIN sector s ON s.id = i.sector_id
    LEFT JOIN rrg_daily r ON r.scope = 'sector' AND r.ref_id = s.code AND r.as_of_date = i.date
                         AND r.timeframe = 'd1' AND r.weighting = i.weighting
    LEFT JOIN price_daily b ON b.ticker = ? AND b.date = i.date
    WHERE s.code = ? AND i.weighting = ? AND i.date BETWEEN ? AND ?
    ORDER BY i.date
"""
MATRIX_SQL = """
    SELECT r.ref_id, r.quadrant, r.quadrant_prev, r.as_of_date,
           CASE WHEN r.scope = 'sector' THEN s.name_id ELSE st.name END AS name
    FROM rrg_daily r
    LEFT JOIN sector s ON r.scope = 'sector' AND s.code = r.ref_id
    LEFT JOIN stock st ON r.scope = 'stock' AND st.ticker = r.ref_id
    WHERE r.timeframe = ? AND r.weighting = ? AND r.scope = ? AND r.as_of_date <= ?
      AND r.as_of_date >= ?
    ORDER BY r.as_of_date DESC
"""
HEATMAP_SQL = """
    SELECT s.code, s.name_id, m.ret_1w, m.ret_1m, m.ret_3m, i.ret_1d
    FROM sector s
    LEFT JOIN sector_metrics m ON m.sector_id = s.id AND m.as_of_date = ? AND m.timeframe = ? AND m.weighting = ?
    LEFT JOIN sector_index_daily i ON i.sector_id = s.id AND i.weighting = ?
        AND i.date = (SELECT MAX(date) FROM sector_index_daily WHERE sector_id = s.id AND weighting = ? AND date <= ?)
    WHERE s.is_active = 1 ORDER BY s.sort_order
"""


def _check(timeframe: str, weighting: str, cfg) -> None:
    if timeframe not in cfg.timeframes["allowed"]:
        raise HTTPException(
            400,
            {
                "code": "invalid_timeframe",
                "message": f"timeframe harus salah satu dari: {', '.join(cfg.timeframes['allowed'])}",
                "detail": {"received": timeframe},
            },
        )
    if weighting not in WEIGHTINGS:
        raise HTTPException(
            400,
            {"code": "invalid_weighting", "message": f"weighting harus salah satu dari: {', '.join(WEIGHTINGS)}", "detail": {"received": weighting}},
        )


def _window_params(window: str, timeframe: str) -> int:
    return read.PERIODS_PER_WINDOW.get(timeframe, read.PERIODS_PER_WINDOW["d1"]).get(window, 13)


@router.get("/rrg", response_model=RrgResponse, response_model_exclude_none=False)
def get_rrg(
    timeframe: str = "d1",
    as_of: str | None = None,
    scope: str = "sector",
    sector: list[str] = Query(default=[]),
    window: str = "3m",
    weighting: str | None = None,
    tail_points: int | None = None,
    limit: int | None = None,
) -> dict:
    """Titik + ekor RRG. `sector` filter juga berlaku untuk `scope=stock` (sektor induknya)."""
    cfg = get_settings()
    weighting = weighting or cfg.universe["weighting"]
    _check(timeframe, weighting, cfg)
    if scope not in ("sector", "stock"):
        raise HTTPException(400, {"code": "invalid_scope", "message": "scope harus sector atau stock", "detail": {"received": scope}})

    params = {"timeframe": timeframe, "scope": scope, "window": window, "weighting": weighting, "tail_points": tail_points, "limit": limit, "sector": sorted(sector)}

    conn = db.connect()
    try:
        as_of = read.resolve_as_of(conn, timeframe, scope=scope, weighting=weighting, as_of=as_of)
        # Kunci cache memuat `as_of`: tanpa itu permintaan tanggal lain dilayani badan respons
        # permintaan pertama selama TTL (docs/07 B16).
        cached = cache.get("rrg", params, as_of)
        if cached is not None:
            return cached

        wanted = read.split_multi(sector)
        rows = [dict(r) for r in conn.execute(ITEMS_SQL, (timeframe, weighting, as_of, scope))]
        if wanted:
            rows = [r for r in rows if (r["ref_id"] if scope == "sector" else r["stock_sector"]) in wanted]
        rows.sort(key=lambda r: (r["score"] is None, -(r["score"] or 0), r["ref_id"]))
        if limit:
            rows = rows[: int(limit)]

        tails = {r["ref_id"]: [] for r in rows}
        start = read.window_start(as_of, window)
        for point in conn.execute(TAIL_SQL, (timeframe, weighting, scope, as_of)):
            if point["ref_id"] in tails and (start is None or point["as_of_date"] >= start):
                tails[point["ref_id"]].append(point)
        points = read.tail_points(tail_points, default_periods=_window_params(window, timeframe))

        streaks = read.streak_map(conn)
        items = []
        for row in rows:
            ret_1w = _ret_1w(conn, row, timeframe, weighting, scope)
            items.append(
                {
                    "ref_id": row["ref_id"],
                    "name": row["name"],
                    "color_hex": row["color_hex"] or "#94A3B8",
                    "rs_ratio": row["rs_ratio"],
                    "rs_momentum": row["rs_momentum"],
                    "rs_ratio_change_1p": row["rs_ratio_change_1p"],
                    "rs_momentum_change_1p": row["rs_momentum_change_1p"],
                    "quadrant": row["quadrant"],
                    "quadrant_prev": row["quadrant_prev"],
                    "transition": row["transition"],
                    "quadrant_age_periods": row["quadrant_age_periods"],
                    "score": row["score"],
                    "rank_score": row["rank_score"] if scope == "sector" else None,
                    "streak_weeks": streaks.get(row["ref_id"], 0),
                    "ret_1w": ret_1w,
                    "median_turnover_20d_idr": row["median_turnover_20d_idr"],
                    "tail": [
                        {"as_of": p["as_of_date"], "rs_ratio": p["rs_ratio"], "rs_momentum": p["rs_momentum"]}
                        for p in tails[row["ref_id"]][-points:]
                    ],
                }
            )
        body = {
            "api_version": _RRG_API_VERSION,
            "timeframe": timeframe,
            "as_of": as_of,
            "window": window,
            "weighting": weighting,
            "quadrants": {q: sum(1 for i in items if i["quadrant"] == q) for q in QUADRANT_LABEL},
            "items": items,
            "data_status": read.data_status(conn, as_of=as_of, timeframe=timeframe, weighting=weighting, window=window),
        }
    finally:
        conn.close()
    cache.put("rrg", params, as_of, body)
    return body


def _ret_1w(conn, row, timeframe: str, weighting: str, scope: str) -> float | None:
    """`ret_1w` dari `sector_metrics`; untuk saham dipakai `ret_5d` (`stock_metrics` tidak punya ret_1w)."""
    if scope == "sector":
        value = conn.execute(RET_1W_SQL, (row["ref_id"], row["as_of"], timeframe, weighting)).fetchone()
    else:
        value = conn.execute(RET_5D_SQL, (row["ref_id"], timeframe)).fetchone()
    return value[0] if value else None


@router.get("/rotation/matrix", response_model=MatrixResponse)
def get_matrix(timeframe: str = "d1", window: str = "3m", scope: str = "sector", weighting: str | None = None) -> dict:
    """Transisi kuadran antar periode terakhir di dalam `window` (docs/05 §2)."""
    cfg = get_settings()
    weighting = weighting or cfg.universe["weighting"]
    _check(timeframe, weighting, cfg)

    conn = db.connect()
    try:
        latest = read.resolve_as_of(conn, timeframe, scope=scope, weighting=weighting)
        start = read.window_start(latest, window)
        rows = [dict(r) for r in conn.execute(MATRIX_SQL, (timeframe, weighting, scope, latest, start or "0000-01-01"))]
        status = read.data_status(conn, as_of=latest, timeframe=timeframe, weighting=weighting, window=window)
    finally:
        conn.close()

    if not rows:
        return {
            "api_version": _API_VERSION,
            "timeframe": timeframe,
            "from": None,
            "to": None,
            "cells": [],
            "changes": [],
            "data_status": status,
        }

    to_date = max(r["as_of_date"] for r in rows)
    previous = sorted({r["as_of_date"] for r in rows if r["as_of_date"] < to_date})
    from_date = previous[-1] if previous else None
    current = [r for r in rows if r["as_of_date"] == to_date and r["quadrant_prev"] != r["quadrant"]]

    cells: dict[tuple, list[str]] = {}
    for row in current:
        cells.setdefault((row["quadrant_prev"], row["quadrant"]), []).append(row["ref_id"])
    return {
        "api_version": _API_VERSION,
        "timeframe": timeframe,
        "from": from_date,
        "to": to_date,
        "cells": [
            {"from": key[0], "to": key[1], "count": len(refs), "refs": sorted(refs)} for key, refs in sorted(cells.items(), key=lambda kv: -len(kv[1]))
        ],
        "changes": sorted(
            [{"ref_id": r["ref_id"], "name": r["name"], "from": r["quadrant_prev"], "to": r["quadrant"], "as_of": r["as_of_date"]} for r in current],
            key=lambda c: c["ref_id"],
        ),
        "data_status": status,
    }


@router.get("/heatmap", response_model=HeatmapResponse)
def get_heatmap(timeframe: str = "d1", as_of: str | None = None, weighting: str | None = None) -> dict:
    """Return sektor per kolom `1d,1w,1m,3m` (nilai return, bukan persen)."""
    cfg = get_settings()
    weighting = weighting or cfg.universe["weighting"]
    _check(timeframe, weighting, cfg)

    conn = db.connect()
    try:
        as_of = read.resolve_as_of(conn, timeframe, scope="sector", weighting=weighting, as_of=as_of)
        rows = [dict(r) for r in conn.execute(HEATMAP_SQL, (as_of, timeframe, weighting, weighting, weighting, as_of))]
        # kolom heatmap paling jauh `3m` → awal rentang = 3 bulan ke belakang (docs/05 §0)
        status = read.data_status(conn, as_of=as_of, timeframe=timeframe, weighting=weighting, window="3m")
    finally:
        conn.close()
    columns = ["1d", "1w", "1m", "3m"]
    return {
        "api_version": _API_VERSION,
        "columns": columns,
        "rows": [
            {
                "code": r["code"],
                "name_id": r["name_id"],
                "values": {"1d": r["ret_1d"], "1w": r["ret_1w"], "1m": r["ret_1m"], "3m": r["ret_3m"]},
            }
            for r in rows
        ],
        "data_status": status,
    }


@router.get("/series/sector/{code}", response_model=SeriesSectorResponse)
def get_sector_series(
    code: str,
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    timeframe: str = "d1",
    weighting: str | None = None,
) -> dict:
    """Seri indeks sektor + benchmark + RS mentah (`docs/05` §2). `from`/`to` = rentang tanggal."""
    cfg = get_settings()
    weighting = weighting or cfg.universe["weighting"]
    _check(timeframe, weighting, cfg)
    benchmark = cfg.ingest["benchmark_alias"]

    conn = db.connect()
    try:
        exists = conn.execute("SELECT 1 FROM sector WHERE code = ?", (code.upper(),)).fetchone()
        if not exists:
            raise HTTPException(404, {"code": "not_found", "message": f"sektor {code} tidak ada", "detail": {"code": code}})
        latest = read.resolve_as_of(conn, timeframe, scope="sector", weighting=weighting)
        start = from_ or read.window_start(latest, "3m")
        end = to or latest
        points = [
            {"date": r["date"], "index_close": r["index_close"], "bench_close": r["bench_close"], "rs": r["rs"], "turnover_idr": r["turnover_idr"]}
            for r in conn.execute(SERIES_SQL, (benchmark, code.upper(), weighting, start, end))
        ]
    finally:
        conn.close()
    return {
        "api_version": _API_VERSION,
        "code": code.upper(),
        "range_from": start,
        "range_to": end,
        "range_label": read.range_label(start, end),
        "points": points,
    }
