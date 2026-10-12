"""Hitung ulang tengah hari (docs/03 §4, tombol 6 `docs/05` §4.1).

Seri harian ditambah satu bar "hari ini" dari bar intraday reguler terakhir, lalu RRG & metrik
`timeframe='midday'` dihitung ulang **untuk sektor saja** (11 sektor × bobot default).
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from ..config import get_settings
from ..db import connect, now_iso
from . import rrg

INTRADAY_LAST_SQL = """
    SELECT i.ticker, i.close FROM price_intraday i
    WHERE i.session = 'regular' AND substr(i.ts, 1, 10) = ?
      AND i.ts = (SELECT MAX(ts) FROM price_intraday j
                  WHERE j.ticker = i.ticker AND j.session = 'regular' AND substr(j.ts, 1, 10) = ?)
    GROUP BY i.ticker
"""
PREV_CLOSE_SQL = """
    SELECT ticker, close FROM price_daily p
    WHERE date = (SELECT MAX(date) FROM price_daily WHERE ticker = p.ticker AND date < ?)
"""
METRICS_SQL = """
    INSERT INTO sector_metrics (sector_id, as_of_date, timeframe, weighting, ret_intraday,
                                median_turnover_20d_idr, rrg_rs_ratio, rrg_rs_momentum, intraday_move,
                                projected_quadrant, data_status, computed_at)
    VALUES (?, ?, 'midday', ?, ?, ?, ?, ?, ?, ?, 'ok', ?)
    ON CONFLICT(sector_id, as_of_date, timeframe, weighting) DO UPDATE SET
      ret_intraday = excluded.ret_intraday, median_turnover_20d_idr = excluded.median_turnover_20d_idr,
      rrg_rs_ratio = excluded.rrg_rs_ratio, rrg_rs_momentum = excluded.rrg_rs_momentum,
      intraday_move = excluded.intraday_move, projected_quadrant = excluded.projected_quadrant,
      computed_at = excluded.computed_at
"""


def intraday_returns(conn, today: str) -> tuple[dict[str, float], dict[str, float]]:
    """Return intraday (bar reguler terakhir hari ini vs penutupan sebelumnya) per ticker & per sektor."""
    previous = {r["ticker"]: r["close"] for r in conn.execute(PREV_CLOSE_SQL, (today,))}
    per_stock: dict[str, float] = {}
    for row in conn.execute(INTRADAY_LAST_SQL, (today, today)):
        base = previous.get(row["ticker"])
        if base and row["close"]:
            per_stock[row["ticker"]] = row["close"] / base - 1

    sector_of = {r["ticker"]: r["sector_id"] for r in conn.execute("SELECT ticker, sector_id FROM stock WHERE is_active = 1")}
    buckets: dict[int, list[float]] = {}
    for ticker, value in per_stock.items():
        if ticker in sector_of:
            buckets.setdefault(sector_of[ticker], []).append(value)
    per_sector = {sector_id: sum(values) / len(values) for sector_id, values in buckets.items()}
    return per_stock, per_sector


def direction(value: float | None, flat_pct: float) -> str | None:
    """`naik` / `turun` / `datar` memakai ambang `config.midday.move_flat_pct`."""
    if value is None:
        return None
    if value > flat_pct:
        return "naik"
    if value < -flat_pct:
        return "turun"
    return "datar"


def compute_midday(*, db_path=None, report=None) -> dict:
    """RRG + metrik `midday` untuk `as_of` = hari ini (WIB). Mengembalikan jumlah baris ditulis."""
    cfg = get_settings()
    weighting = cfg.universe["weighting"]
    today = datetime.now(ZoneInfo(cfg.app.timezone)).date().isoformat()
    span, lag, min_points = rrg.tf_params("midday", cfg)
    benchmark = cfg.ingest["benchmark_alias"]

    conn = connect(db_path)
    try:
        per_stock, per_sector = intraday_returns(conn, today)
        if not per_stock:
            return {"rows": 0, "sectors": 0, "as_of": today, "message": "belum ada bar intraday hari ini"}

        bench_daily = rrg.load_price_series(conn, benchmark)
        # shortcut: IHSG tanpa bar intraday → pakai rata-rata return semua saham sebagai proksi pasar.
        market_ret = per_stock.get(benchmark, sum(per_stock.values()) / len(per_stock))
        if not bench_daily.empty:
            bench_daily = bench_daily.copy()
            bench_daily.loc[today] = float(bench_daily.iloc[-1]) * (1 + market_ret)

        sectors = [dict(r) for r in conn.execute("SELECT id, code FROM sector WHERE is_active = 1 ORDER BY sort_order")]
        rows = 0
        midday_rows = 0
        for sector in sectors:
            daily = rrg.load_index_series(conn, sector["id"], weighting)
            if daily.empty:
                continue
            series = daily.copy()
            sector_ret = per_sector.get(sector["id"])
            if sector_ret is not None:
                series.loc[today] = float(series.iloc[-1]) * (1 + sector_ret)

            frame = rrg.rrg_series(bench_daily, series, ema_span=span, roc_lag=lag, min_points=min_points)
            if frame.empty or today not in frame.index:
                continue
            rows += rrg.upsert_rows(
                conn,
                rrg.rrg_rows(frame, scope="sector", ref_id=sector["code"], timeframe="midday", weighting=weighting, bench_ref=benchmark),
                now_iso(),
            )
            latest = frame.loc[today]
            turnover = conn.execute(
                "SELECT median_turnover_20d_idr FROM sector_metrics WHERE sector_id = ? AND timeframe != 'midday'"
                " ORDER BY as_of_date DESC LIMIT 1",
                (sector["id"],),
            ).fetchone()
            conn.execute(
                METRICS_SQL,
                (
                    sector["id"],
                    today,
                    weighting,
                    sector_ret,
                    turnover[0] if turnover else None,
                    float(latest["rs_ratio"]),
                    float(latest["rs_momentum"]),
                    direction(sector_ret, cfg.midday["move_flat_pct"]),
                    rrg.quadrant(float(latest["rs_ratio"]), float(latest["rs_momentum"])),
                    now_iso(),
                ),
            )
            midday_rows += 1
        conn.commit()
        if report:
            report(rows=rows, phase="compute_midday", message=f"{midday_rows} sektor")
        return {"rows": rows, "sectors": midday_rows, "as_of": today, "market_ret_intraday": market_ret}
    finally:
        conn.close()
