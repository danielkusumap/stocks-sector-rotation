"""RRG: RS-Ratio & RS-Momentum (docs/03 §2–§4) → tabel `rrg_daily`.

Rumus diimplementasi apa adanya: normalisasi EMA vs SMA(EMA), ROC `roc_lag` periode,
lalu EMA dari ROC. Sektor memakai IHSG sebagai benchmark; saham memakai indeks sektornya.
"""

from __future__ import annotations

import pandas as pd

from ..config import get_settings
from ..db import connect, now_iso
from . import indicators

SECTOR_INDEX_SQL = "SELECT date, index_close FROM sector_index_daily WHERE sector_id = ? AND weighting = ? ORDER BY date"
PRICE_SQL = "SELECT date, adj_close FROM price_daily WHERE ticker = ? ORDER BY date"


def weekly(daily: pd.Series, *, final_only: bool) -> pd.Series:
    """Bar minggu Senin–Jumat berlabel tanggal Jumat (docs/02 §4).

    `final_only` membuang minggu yang belum ditutup Jumat (dipakai timeframe `w1_fri`).
    """
    frame = pd.DataFrame({"value": daily.to_numpy(), "max_date": pd.to_datetime(daily.index)}, index=pd.to_datetime(daily.index))
    grouped = frame.resample("W-FRI").agg({"value": "last", "max_date": "max"})
    labels = grouped.index.strftime("%Y-%m-%d")
    if final_only:
        grouped = grouped[grouped["max_date"].dt.strftime("%Y-%m-%d").eq(labels)]  # bar terakhir minggu itu = Jumat
        labels = grouped.index.strftime("%Y-%m-%d")
    return pd.Series(grouped["value"].to_numpy(), index=labels).dropna()


def rrg_series(bench: pd.Series, series: pd.Series, *, ema_span: int, roc_lag: int, min_points: int) -> pd.DataFrame:
    """Kolom `rs`, `rs_ratio`, `rs_momentum` untuk satu seri terhadap benchmark-nya."""
    joined = pd.concat([series.rename("x"), bench.rename("bench")], axis=1).dropna()
    if len(joined) < min_points:
        return pd.DataFrame(columns=["rs", "rs_ratio", "rs_momentum"])
    rs = 100 * (joined["x"] / joined["bench"]) / (joined["x"].iloc[0] / joined["bench"].iloc[0])
    ema_rs = indicators.ema(rs, ema_span)
    rs_ratio = 100 * ema_rs / indicators.sma(ema_rs, ema_span)
    roc = rs_ratio / rs_ratio.shift(roc_lag) - 1
    rs_momentum = 100 + 100 * indicators.ema(roc, ema_span)
    out = pd.DataFrame({"rs": rs, "rs_ratio": rs_ratio, "rs_momentum": rs_momentum})
    return out.iloc[min_points - 1 :].dropna()


def quadrant(rs_ratio: float, rs_momentum: float, previous: str | None = None) -> str:
    """docs/03 §3 — tepat 100 ikut kuadran sebelumnya, kalau tidak ada → leading."""
    if rs_ratio == 100 or rs_momentum == 100:
        return previous or "leading"
    if rs_ratio > 100:
        return "leading" if rs_momentum > 100 else "weakening"
    return "improving" if rs_momentum > 100 else "lagging"


def rrg_rows(frame: pd.DataFrame, *, scope: str, ref_id: str, timeframe: str, weighting: str, bench_ref: str, score=None) -> list[tuple]:
    """Baris `rrg_daily` lengkap dengan kuadran, umur kuadran, transisi, dan perubahan 1 periode."""
    rows = []
    prev_quadrant = None
    age = 0
    prev_ratio = prev_momentum = None
    for date, r in frame.iterrows():
        quad = quadrant(float(r["rs_ratio"]), float(r["rs_momentum"]), prev_quadrant)
        age = age + 1 if quad == prev_quadrant else 1
        rows.append(
            (
                str(date),
                scope,
                ref_id,
                timeframe,
                weighting,
                None if pd.isna(r["rs"]) else float(r["rs"]),
                float(r["rs_ratio"]),
                float(r["rs_momentum"]),
                quad,
                prev_quadrant,
                f"{prev_quadrant}→{quad}" if prev_quadrant and prev_quadrant != quad else None,
                age,
                None if prev_ratio is None else float(r["rs_ratio"]) - prev_ratio,
                None if prev_momentum is None else float(r["rs_momentum"]) - prev_momentum,
                score,
                bench_ref,
            )
        )
        prev_quadrant, prev_ratio, prev_momentum = quad, float(r["rs_ratio"]), float(r["rs_momentum"])
    return rows


def upsert_rows(conn, rows: list[tuple], computed_at: str) -> int:
    conn.executemany(
        """
        INSERT INTO rrg_daily (as_of_date, scope, ref_id, timeframe, weighting, rs, rs_ratio, rs_momentum,
                               quadrant, quadrant_prev, transition, quadrant_age_periods,
                               rs_ratio_change_1p, rs_momentum_change_1p, score, bench_ref, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(as_of_date, scope, ref_id, timeframe, weighting) DO UPDATE SET
          rs = excluded.rs, rs_ratio = excluded.rs_ratio, rs_momentum = excluded.rs_momentum,
          quadrant = excluded.quadrant, quadrant_prev = excluded.quadrant_prev, transition = excluded.transition,
          quadrant_age_periods = excluded.quadrant_age_periods, rs_ratio_change_1p = excluded.rs_ratio_change_1p,
          rs_momentum_change_1p = excluded.rs_momentum_change_1p, score = excluded.score,
          bench_ref = excluded.bench_ref, computed_at = excluded.computed_at
        """,
        [(*row, computed_at) for row in rows],
    )
    return len(rows)


def tf_params(timeframe: str, cfg) -> tuple[int, int, int]:
    """(ema_span, roc_lag, min_points) untuk timeframe tertentu (docs/03 §2)."""
    is_weekly = timeframe in ("w1", "w1_fri")
    span = cfg.rrg["weekly"]["ema_span"] if is_weekly else cfg.rrg["ema_span"]
    lag = cfg.rrg["weekly"]["roc_lag"] if is_weekly else cfg.rrg["roc_lag"]
    return span, lag, cfg.rrg["min_points"][timeframe]


def load_index_series(conn, sector_id: int, weighting: str) -> pd.Series:
    rows = conn.execute(SECTOR_INDEX_SQL, (sector_id, weighting)).fetchall()
    return pd.Series({r[0]: r[1] for r in rows}, dtype=float)


def load_price_series(conn, ticker: str) -> pd.Series:
    rows = conn.execute(PRICE_SQL, (ticker,)).fetchall()
    return pd.Series({r[0]: r[1] for r in rows}, dtype=float)


def compute_rrg(*, timeframes: list[str] | None = None, weightings: list[str] | None = None, db_path=None, report=None) -> dict:
    """Hitung `rrg_daily` untuk 11 sektor (semua bobot) dan semua saham aktif (bobot default)."""
    cfg = get_settings()
    timeframes = timeframes or ["d1", "w1"]
    sector_weightings = weightings or ["equal", "turnover", "captier"]
    stock_weighting = cfg.universe["weighting"]
    if stock_weighting not in sector_weightings:
        sector_weightings = [*sector_weightings, stock_weighting]  # saham butuh indeks bobot default
    conn = connect(db_path)
    try:
        bench_daily = load_price_series(conn, cfg.ingest["benchmark_alias"])
        sectors = conn.execute("SELECT id, code FROM sector WHERE is_active = 1 ORDER BY sort_order").fetchall()
        stocks = conn.execute(
            """
            SELECT st.ticker, sec.id AS sector_id, sec.code AS sector_code
            FROM stock st JOIN sector sec ON sec.id = st.sector_id
            WHERE st.is_active = 1 ORDER BY st.ticker
            """
        ).fetchall()
        total = 0
        for timeframe in timeframes:
            span, lag, min_points = tf_params(timeframe, cfg)
            final_only = timeframe == "w1_fri"
            bench = weekly(bench_daily, final_only=final_only) if timeframe != "d1" else bench_daily

            for weighting in sector_weightings:
                for sector in sectors:
                    daily = load_index_series(conn, sector["id"], weighting)
                    if daily.empty:
                        continue
                    series = weekly(daily, final_only=final_only) if timeframe != "d1" else daily
                    frame = rrg_series(bench, series, ema_span=span, roc_lag=lag, min_points=min_points)
                    total += upsert_rows(
                        conn,
                        rrg_rows(
                            frame,
                            scope="sector",
                            ref_id=sector["code"],
                            timeframe=timeframe,
                            weighting=weighting,
                            bench_ref=cfg.ingest["benchmark_alias"],
                        ),
                        now_iso(),
                    )
                conn.commit()
                if report:
                    report(rows=total, phase="compute_rrg", message=f"sektor {timeframe}/{weighting} selesai")

            for i, stock in enumerate(stocks, start=1):
                bench_sector = load_index_series(conn, stock["sector_id"], stock_weighting)
                if bench_sector.empty:
                    continue
                bench_series = weekly(bench_sector, final_only=final_only) if timeframe != "d1" else bench_sector
                price = load_price_series(conn, stock["ticker"])
                price_series = weekly(price, final_only=final_only) if timeframe != "d1" else price
                frame = rrg_series(bench_series, price_series, ema_span=span, roc_lag=lag, min_points=min_points)
                total += upsert_rows(
                    conn,
                    rrg_rows(
                        frame,
                        scope="stock",
                        ref_id=stock["ticker"],
                        timeframe=timeframe,
                        weighting=stock_weighting,
                        bench_ref=stock["sector_code"],
                    ),
                    now_iso(),
                )
                if i % 100 == 0:
                    conn.commit()
                    if report:
                        report(rows=total, phase="compute_rrg", message=f"saham {timeframe} {i}/{len(stocks)}")
            conn.commit()
        return {"rows": total, "timeframes": timeframes, "sector_weightings": sector_weightings, "stock_weighting": stock_weighting}
    finally:
        conn.close()
