"""Metrik sektor & saham → `sector_metrics` + `stock_metrics` (docs/04 §4).

Isi: return beberapa jendela, median turnover, pertumbuhan turnover, indikator teknikal,
dan nilai RRG pada tanggal yang sama. Skor & `rank_score` diisi di B6 (sekarang `NULL`).

Cakupan penyimpanan: `sector_metrics` menyimpan seluruh seri (11 sektor × 3 bobot × ~470 tanggal),
`stock_metrics` hanya snapshot `as_of` terakhir per saham (962 × 470 baris tak perlu disimpan —
ekor RRG saham sudah ada di `rrg_daily`).
"""

from __future__ import annotations

import pandas as pd

from ..config import get_settings
from ..db import connect, now_iso
from . import indicators, rrg

RETURN_BARS = {
    "d1": {"1w": 5, "1m": 21, "3m": 63, "6m": 126},
    "w1": {"1w": 1, "1m": 4, "3m": 13, "6m": 26},  # satuan minggu
}
PRICE_SQL = """
    SELECT p.ticker, p.date, p.open, p.high, p.low, p.close, p.adj_close, p.value_idr
    FROM price_daily p JOIN stock st ON st.ticker = p.ticker
    WHERE st.is_active = 1 ORDER BY p.date
"""
SECTOR_INDEX_SQL = """
    SELECT date, index_close, ret_1d, turnover_idr FROM sector_index_daily
    WHERE sector_id = ? AND weighting = ? ORDER BY date
"""
RRG_SQL = """
    SELECT as_of_date, rs_ratio, rs_momentum FROM rrg_daily
    WHERE scope = ? AND ref_id = ? AND timeframe = ? AND weighting = ?
"""
RRG_LATEST_SQL = """
    SELECT as_of_date, rs_ratio, rs_momentum FROM rrg_daily
    WHERE scope = ? AND ref_id = ? AND timeframe = ? AND weighting = ?
    ORDER BY as_of_date DESC LIMIT 1
"""


def _returns(series: pd.Series, date: str, bars: dict[str, int]) -> dict[str, float | None]:
    """Return jendela tetap (satuan bar timeframe) + YTD dari bar terakhir tahun sebelumnya."""
    out: dict[str, float | None] = {}
    if date not in series.index:
        return {**{k: None for k in bars}, "ytd": None}
    pos = series.index.get_loc(date)
    last = float(series.iloc[pos])
    for label, count in bars.items():
        out[label] = None if pos < count or pd.isna(series.iloc[pos - count]) else last / float(series.iloc[pos - count]) - 1
    year = date[:4]
    prev_year = series[series.index.str[:4] < year]
    out["ytd"] = None if prev_year.empty else last / float(prev_year.iloc[-1]) - 1
    return out


def sector_metrics_rows(conn, sectors, weightings: list[str], timeframe: str) -> list[tuple]:
    """Baris `sector_metrics` untuk seluruh seri indeks sektor (skor masih kosong).

    Untuk timeframe mingguan, seri di-resample ke bar Jumat dulu supaya jendela return
    memakai satuan minggu (`RETURN_BARS`).
    """
    weekly_tf = timeframe in ("w1", "w1_fri")
    bars = RETURN_BARS["w1" if weekly_tf else "d1"]
    rows = []
    for sector in sectors:
        for weighting in weightings:
            frame = pd.read_sql(SECTOR_INDEX_SQL, conn, params=(sector["id"], weighting))
            if frame.empty:
                continue
            series = pd.Series(frame["index_close"].to_numpy(), index=frame["date"])
            turnover = pd.Series(frame["turnover_idr"].to_numpy(dtype="float"), index=frame["date"])
            if weekly_tf:
                series = rrg.weekly(series, final_only=timeframe == "w1_fri")
                turnover = rrg.weekly(turnover, final_only=timeframe == "w1_fri")
            median20 = turnover.rolling(20, min_periods=1).median()
            median60 = turnover.rolling(60, min_periods=1).median()
            rrg_map = {
                r["as_of_date"]: (r["rs_ratio"], r["rs_momentum"])
                for r in conn.execute(RRG_SQL, ("sector", sector["code"], timeframe, weighting))
            }
            for date in series.index:
                ret = _returns(series, date, bars)
                growth = float(median20.loc[date] / median60.loc[date] - 1) if median60.loc[date] else None
                ratio, momentum = rrg_map.get(date, (None, None))
                rows.append(
                    (
                        sector["id"],
                        date,
                        timeframe,
                        weighting,
                        ret["1w"],
                        ret["1m"],
                        ret["3m"],
                        ret["6m"],
                        ret["ytd"],
                        None,  # ret_intraday: hanya timeframe=midday
                        int(median20.loc[date]) if pd.notna(median20.loc[date]) else None,
                        growth,
                        ratio,
                        momentum,
                        None,  # score (B6)
                        None,  # rank_score (B6)
                        None,  # intraday_move
                        None,  # projected_quadrant
                        "ok",
                    )
                )
    return rows


def stock_metrics_rows(conn, timeframe: str) -> list[tuple]:
    """Snapshot `stock_metrics` untuk `as_of` terakhir tiap saham (indikator + RRG vs sektornya)."""
    frame = pd.read_sql(PRICE_SQL, conn)
    if frame.empty:
        return []
    rows = []
    for ticker, group in frame.groupby("ticker", sort=True):
        group = group.set_index("date")
        close = group["close"].astype(float)
        adj = group["adj_close"].astype(float)
        date = adj.last_valid_index()
        if date is None or date not in close.index:
            continue
        pos = adj.index.get_loc(date)
        ret = _returns(adj, date, RETURN_BARS["d1"])  # snapshot saham selalu satuan harian (docs/03 §6.2)
        ret_1d = None if pos < 1 else float(close.iloc[pos]) / float(close.iloc[pos - 1]) - 1
        sma20 = close.rolling(20).mean()
        sma50 = close.rolling(50).mean()
        rsi = indicators.rsi(close)
        atr = indicators.atr(group["high"].astype(float), group["low"].astype(float), close)
        median20 = group["value_idr"].astype(float).rolling(20, min_periods=1).median()
        rrg = conn.execute(RRG_LATEST_SQL, ("stock", ticker, timeframe, get_settings().universe["weighting"])).fetchone()
        rows.append(
            (
                ticker,
                date,
                timeframe,
                float(close.iloc[pos]),
                ret_1d,
                ret["1w"],
                ret["1m"],
                ret["3m"],
                None if pd.isna(sma20.iloc[pos]) else float(sma20.iloc[pos]),
                None if pd.isna(sma50.iloc[pos]) else float(sma50.iloc[pos]),
                None if pd.isna(rsi.iloc[pos]) else float(rsi.iloc[pos]),
                None if pd.isna(atr.iloc[pos]) else float(atr.iloc[pos]),
                int(median20.iloc[pos]) if pd.notna(median20.iloc[pos]) else None,
                None if rrg is None else rrg["rs_ratio"],
                None if rrg is None else rrg["rs_momentum"],
                None,  # quadrant: ditulis di B6 (sekarang dibaca dari rrg_daily)
                None,  # stock_score (B6)
            )
        )
    return rows


def upsert_sector(conn, rows: list[tuple], computed_at: str) -> int:
    conn.executemany(
        """
        INSERT INTO sector_metrics (sector_id, as_of_date, timeframe, weighting, ret_1w, ret_1m, ret_3m, ret_6m,
                                    ret_ytd, ret_intraday, median_turnover_20d_idr, turnover_growth, rrg_rs_ratio,
                                    rrg_rs_momentum, score, rank_score, intraday_move, projected_quadrant,
                                    data_status, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sector_id, as_of_date, timeframe, weighting) DO UPDATE SET
          ret_1w = excluded.ret_1w, ret_1m = excluded.ret_1m, ret_3m = excluded.ret_3m, ret_6m = excluded.ret_6m,
          ret_ytd = excluded.ret_ytd, ret_intraday = excluded.ret_intraday,
          median_turnover_20d_idr = excluded.median_turnover_20d_idr, turnover_growth = excluded.turnover_growth,
          rrg_rs_ratio = excluded.rrg_rs_ratio, rrg_rs_momentum = excluded.rrg_rs_momentum,
          score = excluded.score, rank_score = excluded.rank_score, intraday_move = excluded.intraday_move,
          projected_quadrant = excluded.projected_quadrant, data_status = excluded.data_status,
          computed_at = excluded.computed_at
        """,
        [(*row, computed_at) for row in rows],
    )
    return len(rows)


def upsert_stock(conn, rows: list[tuple], computed_at: str) -> int:
    conn.executemany(
        """
        INSERT INTO stock_metrics (ticker, as_of_date, timeframe, close, ret_1d, ret_5d, ret_1m, ret_3m,
                                   sma20, sma50, rsi14, atr14, median_turnover_20d_idr, rs_ratio, rs_momentum,
                                   quadrant, stock_score, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ticker, as_of_date, timeframe) DO UPDATE SET
          close = excluded.close, ret_1d = excluded.ret_1d, ret_5d = excluded.ret_5d, ret_1m = excluded.ret_1m,
          ret_3m = excluded.ret_3m, sma20 = excluded.sma20, sma50 = excluded.sma50, rsi14 = excluded.rsi14,
          atr14 = excluded.atr14, median_turnover_20d_idr = excluded.median_turnover_20d_idr,
          rs_ratio = excluded.rs_ratio, rs_momentum = excluded.rs_momentum, quadrant = excluded.quadrant,
          stock_score = excluded.stock_score, computed_at = excluded.computed_at
        """,
        [(*row, computed_at) for row in rows],
    )
    return len(rows)


def compute_metrics(*, timeframes: list[str] | None = None, weightings: list[str] | None = None, db_path=None, report=None) -> dict:
    cfg = get_settings()
    timeframes = timeframes or ["d1"]
    weightings = weightings or ["equal", "turnover", "captier"]
    conn = connect(db_path)
    try:
        sectors = conn.execute("SELECT id, code FROM sector WHERE is_active = 1 ORDER BY sort_order").fetchall()
        ts = now_iso()
        total_sector = total_stock = 0
        for timeframe in timeframes:
            rows = sector_metrics_rows(conn, sectors, weightings, timeframe)
            total_sector += upsert_sector(conn, rows, ts)
            conn.commit()
            if report:
                report(rows=total_sector, phase="compute_metrics", message=f"sektor {timeframe}")
        stock_rows = stock_metrics_rows(conn, timeframes[0])
        total_stock = upsert_stock(conn, stock_rows, ts)
        conn.commit()
        return {"sector_rows": total_sector, "stock_rows": total_stock, "rows": total_sector + total_stock, "timeframes": timeframes}
    finally:
        conn.close()
