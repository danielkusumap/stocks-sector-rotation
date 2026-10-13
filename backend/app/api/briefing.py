"""Endpoint briefing pagi (docs/05 §3) — satu panggilan untuk laporan Hermes.

Wajib tetap `200` walau data stale/partial: kesegaran dilaporkan di `data_status` & `watch[]`.
"""

from __future__ import annotations

import json
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query

from .. import cache, db
from ..config import get_settings
from ..ingest import freshness
from ..labels import format_id_number, quadrant_label
from ..repo import read
from .rrg import _check
from .schemas import BriefingResponse
from .weekly import SECTORS_SQL as WEEK_SECTORS_SQL, STOCKS_SQL as WEEK_STOCKS_SQL

router = APIRouter(prefix="/api/v1", tags=["briefing"])
_API_VERSION = "1.0"

# docs/05 §3: kalimat ringkasan ≤ 140 karakter, watchlist maks 3 item, disusun rule-based (tanpa LLM).
MAX_LINE = 140
MAX_WATCHLIST = 3

NOTES_FOR_REPORT = (
    "Susun 5–8 paragraf: kondisi pasar, sektor kuat/lemah, perubahan kuadran, fokus mingguan "
    "(sebut streak), risiko & catatan data."
)

IHSG_SQL = "SELECT date, close FROM price_daily WHERE ticker = ? ORDER BY date DESC LIMIT 6"
SECTOR_SQL = """
    SELECT s.code, s.name_id, r.quadrant, r.score AS rrg_score, r.as_of_date, m.score, m.ret_1w,
           i.ret_1d, i.advancers, i.decliners, i.unchanged, i.index_close
    FROM rrg_daily r
    JOIN sector s ON s.code = r.ref_id
    LEFT JOIN sector_metrics m ON m.sector_id = s.id AND m.as_of_date = r.as_of_date
                              AND m.timeframe = r.timeframe AND m.weighting = r.weighting
    LEFT JOIN sector_index_daily i ON i.sector_id = s.id AND i.weighting = r.weighting
        AND i.date = (SELECT MAX(date) FROM sector_index_daily
                      WHERE sector_id = s.id AND weighting = r.weighting AND date <= r.as_of_date)
    WHERE r.scope = 'sector' AND r.timeframe = ? AND r.weighting = ? AND r.as_of_date = ?
    ORDER BY s.sort_order
"""
CHANGES_SQL = """
    SELECT r.ref_id, s.name_id AS name, r.quadrant_prev, r.quadrant, r.as_of_date
    FROM rrg_daily r JOIN sector s ON s.code = r.ref_id
    WHERE r.scope = 'sector' AND r.timeframe = ? AND r.weighting = ? AND r.as_of_date = ?
      AND r.quadrant_prev IS NOT NULL AND r.quadrant_prev != r.quadrant
    ORDER BY r.ref_id
"""
MIDDAY_SQL = """
    SELECT s.code, m.ret_intraday, m.intraday_move, m.projected_quadrant, m.as_of_date
    FROM sector_metrics m JOIN sector s ON s.id = m.sector_id
    WHERE m.timeframe = 'midday'
      AND m.as_of_date = (SELECT MAX(as_of_date) FROM sector_metrics WHERE timeframe = 'midday')
    ORDER BY s.sort_order
"""
SERIES_SQL = """
    SELECT date, index_close FROM sector_index_daily
    WHERE sector_id = (SELECT id FROM sector WHERE code = ?) AND weighting = ? AND date <= ?
    ORDER BY date DESC LIMIT 30
"""


def regime_of(sectors_up: int, sectors_down: int, threshold: int, total: int) -> tuple[str, str]:
    """docs/05 §3: `risk_off` bila turun ≥ ambang, `risk_on` bila naik ≥ ambang, sisanya `mixed`."""
    if sectors_down >= threshold:
        return "risk_off", f"{sectors_down} dari {total} sektor turun; uang keluar dari siklikal."
    if sectors_up >= threshold:
        return "risk_on", f"{sectors_up} dari {total} sektor naik; rotasi masuk ke pasar."
    return "mixed", f"{sectors_up} naik / {sectors_down} turun dari {total} sektor — pasar campur, pilih sektor."


# --- teks ringkas `summary_lines`/`watchlist` (docs/05 §3) — template, tanpa LLM -------


def _short(text: str) -> str:
    """Potong ke ≤ `MAX_LINE` karakter (batas kontrak)."""
    return text if len(text) <= MAX_LINE else text[: MAX_LINE - 1].rstrip() + "…"


def _pct(value: float | None, *, decimals: int = 1) -> str | None:
    """Persen format Indonesia dengan tanda: `+1,8%` / `−4,3%`."""
    if value is None:
        return None
    return f"{'+' if value >= 0 else '−'}{format_id_number(abs(value) * 100, decimals)}%"


def _price(value: float | None) -> str | None:
    return None if value is None else format_id_number(value)


def _rule_hits(row: dict) -> dict:
    """`rule_hits` JSON dari `signal_weekly` → dict (kosong bila tidak ada/rusak)."""
    try:
        return json.loads(row["rule_hits"]) if row["rule_hits"] else {}
    except (TypeError, ValueError):
        return {}


def _sector_phrase(row: dict) -> str:
    """`Keuangan (Memimpin 2 minggu berturut-turut)` — label dilewati kalau kuadran tidak tersimpan."""
    streak = row["streak_weeks"] or 0
    label = quadrant_label(_rule_hits(row).get("quadrant"))
    isi = f"{label} {streak} minggu berturut-turut" if label else f"{streak} minggu berturut-turut"
    return f"{row['name']} ({isi})"


def build_summary(
    *,
    ihsg_ret_1d: float | None,
    note: str,
    flat: float,
    sectors: list[dict],
    changes: list[dict],
    sector_picks: list[dict],
    stock_picks: list[dict],
    watch: list[dict],
) -> list[str]:
    """3–6 kalimat Bahasa Indonesia berisi angka siap baca; bagian tanpa isi dilewati (docs/05 §3)."""
    lines: list[str] = []

    def push(text: str | None) -> None:
        if text:
            lines.append(_short(text))

    if ihsg_ret_1d is not None:
        arah = "datar" if abs(ihsg_ret_1d) <= flat else ("naik" if ihsg_ret_1d > 0 else "turun")
        besar = f"{format_id_number(abs(ihsg_ret_1d) * 100, 2)}%"
        awal = f"IHSG nyaris tidak bergerak hari ini ({besar})" if arah == "datar" else f"IHSG {arah} {besar} hari ini"
        push(f"{awal}; {note}")
    elif sectors:
        push(f"Kutipan IHSG belum tersedia; {note}")

    naik = sorted([s for s in sectors if (s.get("ret_1d") or 0) > 0], key=lambda s: -s["ret_1d"])[:2]
    turun = sorted([s for s in sectors if (s.get("ret_1d") or 0) < 0], key=lambda s: s["ret_1d"])[:1]
    bagian = []
    if naik:
        bagian.append("Yang masih naik: " + " dan ".join(f"{s['name_id']} ({_pct(s['ret_1d'])})" for s in naik))
    if turun:
        bagian.append("Turun paling dalam: " + ", ".join(f"{s['name_id']} ({_pct(s['ret_1d'])})" for s in turun))
    if bagian:
        push(". ".join(bagian) + ".")

    if changes:
        rincian = "; ".join(
            f"{c['name']} dari {quadrant_label(c['from'])} ke {quadrant_label(c['to'])}" for c in changes[:3]
        )
        push(f"Berpindah kuadran: {rincian}.")

    fokus = [_sector_phrase(r) for r in sector_picks[:2]]
    fokus += [
        f"{r['ticker']} ({r['streak_weeks'] or 0} minggu masuk daftar, entry {_price(r['entry_ref'])}, stop {_price(r['stop'])})"
        for r in stock_picks[:1]
    ]
    if fokus:
        push("Perhatikan minggu depan: " + ", ".join(fokus) + ".")

    if watch:  # catatan data/peringatan (tanpa penanda markdown)
        push(watch[0]["message"].replace("`", ""))
    return lines


def build_watchlist(sector_picks: list[dict], stock_picks: list[dict]) -> list[dict]:
    """Maks 3 kandidat `signal_weekly` terakhir: sektor dulu, lalu saham, masing-masing urut skor (docs/05 §3)."""

    def by_score(rows: list[dict]) -> list[dict]:
        return sorted(rows, key=lambda r: -(r["score"] or 0))

    quadrant_of = {r["ref_id"]: _rule_hits(r).get("quadrant") for r in sector_picks}
    items: list[dict] = []
    for row in by_score(sector_picks):
        streak = row["streak_weeks"] or 0
        quadrant = _rule_hits(row).get("quadrant")
        label = quadrant_label(quadrant)
        reason = (
            f"{label} {streak} minggu berturut-turut, kekuatan relatif masih naik."
            if label and streak > 1
            else f"Kandidat baru di {label or 'daftar mingguan'}, kekuatan relatif mulai naik."
        )
        items.append(
            {
                "kind": "sector",
                "ref_id": row["ref_id"],
                "name": row["name"] or row["ref_id"],  # data lama bisa tanpa nama → pakai kodenya
                "quadrant": quadrant,
                "streak_weeks": streak,
                "reason": _short(reason),
            }
        )
    for row in by_score(stock_picks):
        streak = row["streak_weeks"] or 0
        awal = f"{streak} minggu berturut-turut masuk daftar" if streak > 1 else "Baru masuk daftar mingguan"
        reason = f"{awal}; entry {_price(row['entry_ref'])}, stop {_price(row['stop'])}."
        items.append(
            {
                "kind": "stock",
                "ref_id": row["ticker"],
                "name": row["name"] or row["ticker"],
                "quadrant": quadrant_of.get(row["sector_code"]),
                "streak_weeks": streak,
                "reason": _short(reason),
            }
        )
    return items[:MAX_WATCHLIST]


@router.get("/briefing/morning", response_model=BriefingResponse)
def briefing_morning(
    as_of: str | None = None,
    include_series: bool = False,
    top_n: int = Query(3, ge=1, le=11),
    timeframe: str = "d1",
    window: str = "3m",
    weighting: str | None = None,
) -> dict:
    """Ringkasan pasar + pemimpin/tertinggal + perubahan kuadran + fokus mingguan + kondisi midday."""
    cfg = get_settings()
    weighting = weighting or cfg.universe["weighting"]
    _check(timeframe, weighting, cfg)
    benchmark = cfg.ingest["benchmark_alias"]

    cached = cache.get("briefing/morning", {"as_of": as_of, "top_n": top_n, "timeframe": timeframe, "window": window, "weighting": weighting}, None)
    if cached is not None and not include_series:
        return cached

    conn = db.connect()
    try:
        as_of = read.resolve_as_of(conn, timeframe, scope="sector", weighting=weighting, as_of=as_of)
        bars = [dict(r) for r in conn.execute(IHSG_SQL, (benchmark,))]
        sectors = [dict(r) for r in conn.execute(SECTOR_SQL, (timeframe, weighting, as_of))]
        streaks = read.streak_map(conn)
        for row in sectors:
            row["score"] = row["score"] if row["score"] is not None else row["rrg_score"]
            row["streak_weeks"] = streaks.get(row["code"], 0)

        up = sum(1 for s in sectors if (s["ret_1d"] or 0) > 0)
        down = sum(1 for s in sectors if (s["ret_1d"] or 0) < 0)
        total = len(sectors) or 11
        regime, note = regime_of(up, down, cfg.briefing["regime_sector_threshold"], total)

        leaders = sorted([s for s in sectors if s["score"] is not None], key=lambda s: -s["score"])[:top_n]
        laggards = sorted([s for s in sectors if s["score"] is not None], key=lambda s: s["score"])[:top_n]

        def brief(row: dict) -> dict:
            item = {
                "code": row["code"],
                "name_id": row["name_id"],
                "quadrant": row["quadrant"],
                "score": row["score"],
                "ret_1w": row["ret_1w"],
                "streak_weeks": row["streak_weeks"],
            }
            if include_series:
                item["series"] = [
                    {"date": r["date"], "index_close": r["index_close"]}
                    for r in reversed(conn.execute(SERIES_SQL, (row["code"], weighting, as_of)).fetchall())
                ]
            return item

        leaders_out = [brief(s) for s in leaders]
        laggards_out = [brief(s) for s in laggards]

        changes = [
            {"ref_id": r["ref_id"], "name": r["name"], "from": r["quadrant_prev"], "to": r["quadrant"], "as_of": r["as_of_date"]}
            for r in conn.execute(CHANGES_SQL, (timeframe, weighting, as_of))
        ]

        # sinyal yang lebih baru dari `as_of` tidak ikut: briefing ini "per tanggal itu" (docs/05 §3)
        week = conn.execute(
            "SELECT MAX(week_end) FROM signal_weekly WHERE week_end <= ?", (as_of or "9999-12-31",)
        ).fetchone()[0]
        weekly = {"week_end": week, "sectors": [], "stocks": []}
        sector_picks: list[dict] = []
        stock_picks: list[dict] = []
        if week:
            sector_picks = [dict(r) for r in conn.execute(WEEK_SECTORS_SQL, (1, week))]
            stock_picks = [dict(r) for r in conn.execute(WEEK_STOCKS_SQL, (1, week))]
            weekly["sectors"] = [
                {"code": r["ref_id"], "streak_weeks": r["streak_weeks"], "rationale": r["rationale"]}
                for r in sector_picks
            ]
            weekly["stocks"] = [
                {
                    "ticker": r["ticker"],
                    "entry_ref": r["entry_ref"],
                    "stop": r["stop"],
                    "target": r["target"],
                    "streak_weeks": r["streak_weeks"],
                    "rationale": r["rationale"],
                }
                for r in stock_picks
            ]

        midday_rows = [dict(r) for r in conn.execute(MIDDAY_SQL)]
        gate = freshness.read(conn)["midday_gate"]
        midday = {
            "available": bool(midday_rows),
            "as_of": midday_rows[0]["as_of_date"] if midday_rows else None,
            "gate": gate["status"],
            "moves": [
                {"code": r["code"], "ret_intraday": r["ret_intraday"], "direction": r["intraday_move"], "projected_quadrant": r["projected_quadrant"]}
                for r in midday_rows
            ],
        }
        status = read.data_status(conn, as_of=as_of, timeframe=timeframe, weighting=weighting)
    finally:
        conn.close()

    watch: list[dict] = []
    if gate["status"] != "ok":
        required = gate.get("required_bar_time") or get_settings().midday["gate_min_bar_time"]
        when = gate["last_bar_at"]
        terakhir = f" (bar terakhir {when})" if when else ""  # docs/05 §3: contoh tanpa tanda kurung bila belum ada bar
        watch.append(
            {
                "level": "warning",
                "message": f"Data intraday Yahoo belum sampai {required} WIB{terakhir}; angka midday = penutupan sebelumnya.",
            }
        )
    if status["status"] != "ok":
        detail = ", ".join(status["partial_sectors"]) if status["partial_sectors"] else "data harian belum lengkap"
        watch.append({"level": "info", "message": f"Status data `{status['status']}`: {detail}."})
    if not weekly["sectors"] and not weekly["stocks"]:
        watch.append({"level": "info", "message": "Belum ada sinyal mingguan — jalankan 'Hitung mingguan' setelah penutupan Jumat."})
    if not midday["available"]:
        watch.append({"level": "info", "message": "Angka tengah hari belum tersedia — jalankan tombol 'Tengah hari'."})

    if len(bars) >= 2:
        ihsg_ret_1d = bars[0]["close"] / bars[1]["close"] - 1
        ihsg_ret_1w = bars[0]["close"] / bars[5]["close"] - 1 if len(bars) >= 6 else None
    else:
        ihsg_ret_1d = ihsg_ret_1w = None

    summary = [] if as_of is None else build_summary(
        ihsg_ret_1d=ihsg_ret_1d,
        note=note,
        flat=cfg.market.move_flat_pct,
        sectors=sectors,
        changes=changes,
        sector_picks=sector_picks,
        stock_picks=stock_picks,
        watch=watch,
    )
    watchlist = [] if as_of is None else build_watchlist(sector_picks, stock_picks)

    body = {
        "api_version": _API_VERSION,
        "generated_at": datetime.now(ZoneInfo(cfg.app.timezone)).isoformat(timespec="seconds"),
        "data_status": status,
        "market": {
            "ihsg_close": bars[0]["close"] if bars else None,
            "ihsg_ret_1d": ihsg_ret_1d,
            "ihsg_ret_1w": ihsg_ret_1w,
            "sectors_up": up,
            "sectors_down": down,
            "breadth": {
                "advancers": sum(s["advancers"] or 0 for s in sectors),
                "decliners": sum(s["decliners"] or 0 for s in sectors),
                "unchanged": sum(s["unchanged"] or 0 for s in sectors),
            },
            "regime": regime,
            "regime_note": note,
        },
        "leaders": leaders_out,
        "laggards": laggards_out,
        "changes": changes,
        "weekly_focus": weekly,
        "midday": midday,
        "watch": watch,
        "notes_for_report": NOTES_FOR_REPORT,
        "summary_lines": summary,
        "watchlist": watchlist,
    }
    if not include_series:
        cache.put("briefing/morning", {"as_of": as_of, "top_n": top_n, "timeframe": timeframe, "window": window, "weighting": weighting}, None, body)
    return body
