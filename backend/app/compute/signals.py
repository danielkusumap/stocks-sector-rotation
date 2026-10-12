"""Sinyal mingguan (docs/03 §6) → `signal_weekly`.

Kandidat sektor (§6.1) dari `rrg_daily` timeframe `w1_fri` + `sector_metrics`; kandidat saham
(§6.2) hanya dari sektor kandidat, memakai indikator **harian** (`stock_metrics` d1) sesuai
`docs/03` §6.2. `streak_weeks` dihitung ulang untuk seluruh minggu historis memakai kalender
minggu dari data (bukan selisih tanggal).
"""

from __future__ import annotations

import json
from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd

from ..config import get_settings
from ..db import connect, now_iso
from . import rrg as rrg_module

SECTOR_ROWS_SQL = """
    SELECT r.ref_id AS code, s.id AS sector_id, s.name_id, r.quadrant, r.quadrant_prev,
           r.quadrant_age_periods, r.rs_ratio, r.rs_momentum, r.rs_momentum_change_1p, r.score,
           m.ret_1m AS ret_4w
    FROM rrg_daily r
    JOIN sector s ON s.code = r.ref_id
    LEFT JOIN sector_metrics m ON m.sector_id = s.id AND m.as_of_date = r.as_of_date
                              AND m.timeframe = r.timeframe AND m.weighting = r.weighting
    WHERE r.scope = 'sector' AND r.timeframe = 'w1_fri' AND r.weighting = ? AND r.as_of_date = ?
    ORDER BY r.ref_id
"""
CONSTITUENTS_SQL = """
    SELECT constituents_count FROM sector_index_daily
    WHERE sector_id = ? AND weighting = ? AND date <= ? ORDER BY date DESC LIMIT 1
"""
CALENDAR_SQL = "SELECT DISTINCT date FROM price_daily WHERE ticker = ? ORDER BY date"
STOCK_ROWS_SQL = """
    SELECT sm.ticker, st.name, st.board, sec.code AS sector_code, sec.id AS sector_id,
           sm.close, sm.ret_5d, sm.sma20, sm.sma50, sm.rsi14, sm.atr14, sm.median_turnover_20d_idr,
           r.rs_ratio, r.rs_momentum
    FROM stock_metrics sm
    JOIN stock st ON st.ticker = sm.ticker
    JOIN sector sec ON sec.id = st.sector_id
    JOIN _candidate_sector cand ON cand.code = sec.code
    LEFT JOIN rrg_daily r ON r.scope = 'stock' AND r.ref_id = sm.ticker
                         AND r.as_of_date = sm.as_of_date AND r.timeframe = 'd1'
    WHERE sm.timeframe = 'd1' AND st.is_active = 1
      AND sm.as_of_date = (SELECT MAX(as_of_date) FROM stock_metrics WHERE timeframe = 'd1')
    ORDER BY sm.ticker
"""
LAST_BAR_SQL = "SELECT MAX(date) FROM price_daily WHERE ticker = ? AND date <= ?"
CLOSE_SQL = "SELECT close FROM price_daily WHERE ticker = ? AND date <= ? ORDER BY date DESC LIMIT 1"

QUADRANT_LABEL = {"leading": "Memimpin", "improving": "Membaik", "weakening": "Melemah", "lagging": "Tertinggal"}


def gate_final_week(cfg=None, now=None) -> dict:
    """Apakah minggu final sudah tertutup (kode 409 `gate_weekly_not_final`, docs/05 §4.1)."""
    cfg = cfg or get_settings()
    now = now or datetime.now(ZoneInfo(cfg.app.timezone))
    weekday = now.weekday()  # 0=Senin … 4=Jumat, 5=Sabtu, 6=Minggu
    if weekday in (5, 6):
        allowed = True  # Jumat sudah tutup
    elif weekday == 4:
        allowed = now.strftime("%H:%M") >= cfg.weekly["final_after_time"]
    else:
        allowed = False
    return {"gate": "ok" if allowed else "not_final", "weekday": now.strftime("%A"), "checked_at": now.isoformat(timespec="seconds")}


def weekly_calendar(conn, benchmark: str, *, final_only: bool = True) -> list[str]:
    """Label Jumat dari data (dipakai untuk pemilihan minggu final & streak)."""
    dates = [r[0] for r in conn.execute(CALENDAR_SQL, (benchmark,))]
    proxy = pd.Series(range(len(dates)), index=dates, dtype=float)
    return list(rrg_module.weekly(proxy, final_only=final_only).index)


def evaluate_sector(row, constituents: int | None, cfg) -> dict:
    """Aturan §6.1 (semua wajib) → hasil evaluasi + `rule_hits`."""
    min_age = cfg.weekly["min_quadrant_age_periods"]
    hits = {
        "quadrant": row["quadrant"],
        "quadrant_ok": row["quadrant"] in ("improving", "leading"),
        "age_ok": row["quadrant_age_periods"] >= min_age and row["quadrant_prev"] in ("improving", "leading"),
        "momentum_ok": bool(
            row["rs_momentum"] and row["rs_momentum"] > 100 and row["rs_momentum_change_1p"] and row["rs_momentum_change_1p"] > 0
        ),
        "ret_4w_ok": bool(row["ret_4w"] is not None and row["ret_4w"] > 0),
        "constituents_ok": bool(constituents is not None and constituents >= cfg.universe["min_constituents"]),
        "rs_momentum": row["rs_momentum"],
        "rs_momentum_change_1p": row["rs_momentum_change_1p"],
        "ret_4w": row["ret_4w"],
        "constituents_count": constituents,
        "quadrant_age_periods": row["quadrant_age_periods"],
    }
    required = ("quadrant_ok", "age_ok", "momentum_ok", "ret_4w_ok", "constituents_ok")
    return {"ok": all(hits[key] for key in required), "rule_hits": hits, "score": row["score"], "row": row}


def evaluate_stock(row, *, close: float | None, last_bar: str | None, cutoff: str, cfg) -> dict:
    """Aturan §6.2 (semua wajib). `cutoff` = tanggal bar ke-5 terakhir (batas suspend)."""
    uni = cfg.universe
    hits = {
        "liquidity_ok": bool(row["median_turnover_20d_idr"] and row["median_turnover_20d_idr"] >= uni["min_turnover_idr"]),
        "price_ok": bool(close is not None and close >= uni["min_price_idr"]),
        "trend_ok": bool(close is not None and row["sma20"] and row["sma50"] and close > row["sma20"] > row["sma50"]),
        "rs_ok": bool(row["rs_ratio"] and row["rs_ratio"] > 100),
        "momentum_ok": bool(row["ret_5d"] is not None and row["ret_5d"] > 0),
        "rsi_ok": bool(row["rsi14"] is not None and row["rsi14"] < uni["max_rsi"]),
        "no_suspension": bool(last_bar is not None and last_bar >= cutoff),
        "board_ok": not (uni["exclude_pemantauan_khusus"] and row["board"] == "Pemantauan Khusus"),
        "close": close,
        "sma20": row["sma20"],
        "median_turnover_20d_idr": row["median_turnover_20d_idr"],
        "rs_ratio": row["rs_ratio"],
        "ret_5d": row["ret_5d"],
        "rsi14": row["rsi14"],
        "last_bar_date": last_bar,
    }
    required = ("liquidity_ok", "price_ok", "trend_ok", "rs_ok", "momentum_ok", "rsi_ok", "no_suspension", "board_ok")
    return {"ok": all(hits[key] for key in required), "rule_hits": hits, "row": row, "close": close}


def levels(entry_ref: float, atr14: float | None, cfg) -> tuple[float | None, float | None, int | None]:
    """stop / target / lots (docs/03 §6.2). `None` bila ATR belum tersedia."""
    if atr14 is None:
        return None, None, None
    stop = entry_ref - cfg.weekly["atr_stop_mult"] * atr14
    target = entry_ref + cfg.weekly["rr_target"] * (entry_ref - stop)
    risk = (entry_ref - stop) * 100  # 1 lot = 100 lembar
    return stop, target, int(cfg.weekly["risk_per_trade_idr"] // risk) if risk > 0 else None


def rationale_sector(name: str, quadrant: str, age: int, momentum: float) -> str:
    return (
        f"{name} bertahan {age} periode di kuadran {QUADRANT_LABEL.get(quadrant, quadrant)} dengan "
        f"momentum relatif {momentum:.1f} (>100) yang masih naik."
    )


def rationale_stock(streak: int, close: float, sma20: float, rsi: float, turnover_idr: int) -> str:
    prefix = "Baru masuk daftar" if streak <= 1 else f"{streak} minggu berturut-turut masuk daftar"
    text = (
        f"{prefix}; harga {close:,.0f} di atas SMA20 {sma20:,.0f} dan SMA50, RSI {rsi:.0f}, "
        f"nilai transaksi harian rata-rata Rp {turnover_idr / 1e9:.1f} M."
    )
    return text.replace(",", ".")


def compute_streaks(weeks: list[str], rows: list[tuple]) -> dict[tuple[str, str], int]:
    """Streak terhadap kalender minggu dari data (docs/03 §6.3)."""
    order = {week: i for i, week in enumerate(weeks)}
    positions: dict[tuple[str, str], set[int]] = {}
    for week, scope, ref_id in rows:
        positions.setdefault((scope, ref_id), set()).add(order[week])
    streaks = {}
    for key, seen in positions.items():
        streak = 1
        cursor = max(seen)
        while cursor - 1 in seen:
            streak += 1
            cursor -= 1
        streaks[key] = streak
    return streaks


def upsert(conn, rows: list[tuple], computed_at: str) -> int:
    conn.executemany(
        """
        INSERT INTO signal_weekly (week_end, scope, ref_id, sector_id, timeframe, rank, score, streak_weeks,
                                   rule_hits, entry_ref, stop, target, atr14, lots_hint, rationale, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(week_end, scope, ref_id) DO UPDATE SET
          sector_id = excluded.sector_id, timeframe = excluded.timeframe, rank = excluded.rank,
          score = excluded.score, streak_weeks = excluded.streak_weeks, rule_hits = excluded.rule_hits,
          entry_ref = excluded.entry_ref, stop = excluded.stop, target = excluded.target, atr14 = excluded.atr14,
          lots_hint = excluded.lots_hint, rationale = excluded.rationale, computed_at = excluded.computed_at
        """,
        [(*row, computed_at) for row in rows],
    )
    return len(rows)


def _cutoff_date(dates: list[str], week_end: str, bars: int) -> str:
    """Tanggal bar ke-`bars` terakhir sampai `week_end` (batas aturan tidak suspend)."""
    past = [d for d in dates if d <= week_end]
    return past[-bars] if len(past) >= bars else (past[0] if past else week_end)


def _score_candidates(rows: list[tuple], cfg) -> list[tuple]:
    """`score` kandidat saham = persentil antar kandidat **pada minggu yang sama** (docs/03 §6.2)."""
    if not rows:
        return []
    frame = pd.DataFrame(
        [
            {
                "i": i,
                "week": r[0],
                "rs_ratio": json.loads(r[8]).get("rs_ratio") or 0.0,
                "ret_5d": json.loads(r[8]).get("ret_5d") or 0.0,
                "turnover": json.loads(r[8]).get("median_turnover_20d_idr") or 0,
            }
            for i, r in enumerate(rows)
        ]
    )
    sc = cfg.scoring["stock"]
    weights = {"rs_ratio": sc["weight_rs_ratio"], "ret_5d": sc["weight_return_5d"], "turnover": sc["weight_turnover"]}
    score = pd.Series(0.0, index=frame.index)
    for column, weight in weights.items():
        score += frame.groupby("week")[column].rank(pct=True, method="average") * 100 * weight
    score = score.clip(0, 100).round(1)
    by_index = dict(zip(frame["i"], score))
    return [(*row[:6], by_index[i], *row[7:]) for i, row in enumerate(rows)]


def week_picks(conn, week_end: str, *, weighting: str, trading_dates: list[str], cfg) -> tuple[list[tuple], list[tuple]]:
    """(baris sektor, baris saham) untuk satu minggu; saham hanya dari sektor kandidat."""
    sectors = [
        evaluate_sector(
            row,
            (conn.execute(CONSTITUENTS_SQL, (row["sector_id"], weighting, week_end)).fetchone() or [None])[0],
            cfg,
        )
        for row in conn.execute(SECTOR_ROWS_SQL, (weighting, week_end))
    ]
    selectable = sorted([s for s in sectors if s["ok"]], key=lambda s: -(s["score"] or 0.0))[: cfg.weekly["max_sectors"]]

    sector_rows = []
    for rank, candidate in enumerate(selectable, start=1):
        row, hits = candidate["row"], candidate["rule_hits"]
        sector_rows.append(
            (
                week_end,
                "sector",
                row["code"],
                row["sector_id"],
                "w1_fri",
                rank,
                candidate["score"] or 0.0,
                "{}",  # streak diisi di akhir (dihitung lintas minggu)
                json.dumps(hits, ensure_ascii=False),
                None,
                None,
                None,
                None,
                None,
                rationale_sector(row["name_id"], row["quadrant"], hits["quadrant_age_periods"], hits["rs_momentum"]),
            )
        )

    if not selectable:
        return sector_rows, []

    conn.execute("CREATE TEMP TABLE IF NOT EXISTS _candidate_sector (code TEXT PRIMARY KEY)")
    conn.execute("DELETE FROM _candidate_sector")  # tabel temp bertahan sepanjang koneksi (dipakai per minggu)
    conn.executemany("INSERT OR IGNORE INTO _candidate_sector (code) VALUES (?)", [(s["row"]["code"],) for s in selectable])
    cutoff = _cutoff_date(trading_dates, week_end, bars=5)

    stock_rows = []
    for sector in selectable:
        picks = []
        for row in conn.execute(STOCK_ROWS_SQL):
            if row["sector_code"] != sector["row"]["code"]:
                continue
            close = conn.execute(CLOSE_SQL, (row["ticker"], week_end)).fetchone()
            last = conn.execute(LAST_BAR_SQL, (row["ticker"], week_end)).fetchone()
            evaluated = evaluate_stock(
                row, close=close[0] if close else None, last_bar=last[0] if last else None, cutoff=cutoff, cfg=cfg
            )
            if evaluated["ok"]:
                picks.append(evaluated)
        picks.sort(key=lambda p: p["rule_hits"]["rs_ratio"] or 0, reverse=True)
        for rank, pick in enumerate(picks[: cfg.weekly["max_stocks_per_sector"]], start=1):
            row = pick["row"]
            stop, target, lots = levels(pick["close"], row["atr14"], cfg)
            stock_rows.append(
                (
                    week_end,
                    "stock",
                    row["ticker"],
                    row["sector_id"],
                    "w1_fri",
                    rank,
                    0.0,  # diisi persentil antar kandidat minggu itu
                    "{}",
                    json.dumps(pick["rule_hits"], ensure_ascii=False),
                    pick["close"],
                    stop,
                    target,
                    row["atr14"],
                    lots,
                    None,  # rationale menunggu streak
                )
            )
    return sector_rows, _score_candidates(stock_rows, cfg)


def compute_signals(*, weighting: str | None = None, db_path=None, report=None) -> dict:
    """`signal_weekly` untuk semua minggu final; streak dihitung ulang dari nol tiap kali."""
    cfg = get_settings()
    weighting = weighting or cfg.universe["weighting"]
    benchmark = cfg.ingest["benchmark_alias"]
    conn = connect(db_path)
    try:
        weeks = weekly_calendar(conn, benchmark, final_only=True)  # minggu berjalan tidak ikut
        trading_dates = [r[0] for r in conn.execute(CALENDAR_SQL, (benchmark,))]

        sector_rows: list[tuple] = []
        stock_rows: list[tuple] = []
        for i, week in enumerate(weeks, start=1):
            sectors, stocks = week_picks(conn, week, weighting=weighting, trading_dates=trading_dates, cfg=cfg)
            sector_rows.extend(sectors)
            stock_rows.extend(stocks)
            if report and i % 20 == 0:
                report(
                    rows=len(sector_rows) + len(stock_rows),
                    phase="compute_signals",
                    message=f"minggu {i}/{len(weeks)}",
                )

        streaks = compute_streaks(weeks, [(r[0], r[1], r[2]) for r in [*sector_rows, *stock_rows]])

        final_rows = []
        for row in stock_rows:
            streak = streaks.get((row[1], row[2]), 1)
            hits = json.loads(row[8])
            rationale = rationale_stock(
                streak,
                float(row[9]),
                float(hits.get("sma20") or row[9]),
                float(hits.get("rsi14") or 0),
                int(hits.get("median_turnover_20d_idr") or 0),
            )
            final_rows.append((*row[:7], streak, row[8], *row[9:14], rationale))
        for row in sector_rows:
            final_rows.append((*row[:7], streaks.get((row[1], row[2]), 1), *row[8:]))

        total = upsert(conn, final_rows, now_iso())
        conn.commit()
        return {
            "rows": total,
            "weeks": len(weeks),
            "sector_rows": len(sector_rows),
            "stock_rows": len(stock_rows),
            "weighting": weighting,
        }
    finally:
        conn.close()
