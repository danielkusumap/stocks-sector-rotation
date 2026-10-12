"""Indeks sektor (docs/02 §3, docs/04 `sector_index_daily`) — equal / turnover / captier.

Seri dimulai base 100 di tanggal pertama sektor itu punya data. Aturan kebersihan seri
(docs/02 §3): saham tanpa bar hari itu tidak masuk; saham yang 2 hari berturut tanpa transaksi
dianggap suspend dan dikeluarkan sampai transaksi berikutnya (hari masuk kembali juga belum dipakai).
"""

from __future__ import annotations

import pandas as pd

from ..config import get_settings
from ..db import now_iso, connect


def load_sector(conn, code: str) -> pd.DataFrame:
    """Bar harian konstituen aktif satu sektor (kolom: date, ticker, close, adj_close, volume, value_idr)."""
    return pd.read_sql(
        """
        SELECT p.date, st.ticker, p.close, p.adj_close, p.volume, p.value_idr, st.shares_outstanding
        FROM price_daily p
        JOIN stock st ON st.ticker = p.ticker
        JOIN sector sec ON sec.id = st.sector_id
        WHERE sec.code = ? AND st.is_active = 1
        ORDER BY p.date
        """,
        conn,
        params=(code,),
    )


def _weights(stock_close: pd.DataFrame, shares: pd.Series, turnover_median: pd.DataFrame, weighting: str) -> pd.DataFrame:
    """Bobot baris t memakai data t−1 (docs/02 §3): equal · turnover (median 20 hari) · captier."""
    if weighting == "equal":
        return stock_close.notna().astype(float)  # seragam; baris tanpa data = 0
    if weighting == "captier":
        cap = stock_close.mul(shares, axis=1)
        return cap.shift(1).where(stock_close.shift(1).notna())
    return turnover_median.shift(1).where(stock_close.shift(1).notna())


def excluded_days(volume: pd.DataFrame) -> pd.DataFrame:
    """Saham keluar dari perhitungan selama suspend (2 hari tanpa transaksi berturut-turut, docs/02 §3).

    Hari transaksi pertama setelah suspend juga belum dipakai: return-nya lompat dari harga basi.
    """
    out = pd.DataFrame(False, index=volume.index, columns=volume.columns)
    zero_volume = (volume == 0).any(axis=0)
    for ticker in volume.columns[zero_volume]:  # saham tanpa bar volume 0 tidak perlu diperiksa
        zero_run = 0
        suspended = False
        for date, vol in volume[ticker].items():
            if pd.isna(vol):
                continue  # tidak ada bar hari itu → sudah tersaring lewat `ret.notna()`
            if vol > 0:
                if suspended:
                    out.at[date, ticker] = True  # hari masuk kembali
                    suspended = False
                zero_run = 0
            else:
                zero_run += 1
                if zero_run >= 2:
                    suspended = True
                    out.at[date, ticker] = True
    return out


def compute_series(df: pd.DataFrame, weighting: str, *, min_constituents: int, turnover_window: int) -> list[tuple]:
    """Baris `sector_index_daily` (tanpa sector_id) untuk satu sektor & satu bobot."""
    if df.empty:
        return []
    adj = df.pivot(index="date", columns="ticker", values="adj_close").sort_index()
    close = df.pivot(index="date", columns="ticker", values="close").sort_index()
    volume = df.pivot(index="date", columns="ticker", values="volume").sort_index()
    value = df.pivot(index="date", columns="ticker", values="value_idr").sort_index()
    shares = df.groupby("ticker")["shares_outstanding"].first()

    ret = adj.pct_change()  # hanya saham yang punya bar hari itu DAN hari sebelumnya
    usable = ret.where(ret.notna() & ~excluded_days(volume))

    w = _weights(close, shares, value.rolling(turnover_window, min_periods=1).median(), weighting)
    w = w.where(usable.notna())
    total = w.sum(axis=1)
    w = w.div(total.where(total != 0), axis=0)  # equal → 1/n; total 0 → semua bobot 0 (return sektor = 0)
    ret_sec = (usable * w).sum(axis=1).where(usable.notna().any(axis=1))

    counts = usable.notna().sum(axis=1)
    index_close = 100 * (1 + ret_sec.fillna(0)).cumprod()  # base 100 di baris pertama (tanpa return)
    turnover = value.sum(axis=1, skipna=True)
    advancers, decliners, unchanged = (usable > 0).sum(axis=1), (usable < 0).sum(axis=1), (usable == 0).sum(axis=1)

    return [
        (
            str(date),
            weighting,
            float(idx),
            None if pd.isna(r) else float(r),
            int(t),
            int(c),
            int(a),
            int(d),
            int(u),
            1 if c < min_constituents else 0,
        )
        for date, idx, r, t, c, a, d, u in zip(index_close.index, index_close, ret_sec, turnover, counts, advancers, decliners, unchanged)
    ]


def _upsert(conn, sector_id: int, rows: list[tuple], computed_at: str) -> int:
    conn.executemany(
        """
        INSERT INTO sector_index_daily (sector_id, date, weighting, index_close, ret_1d, turnover_idr,
                                        constituents_count, advancers, decliners, unchanged, partial, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sector_id, date, weighting) DO UPDATE SET
          index_close = excluded.index_close, ret_1d = excluded.ret_1d, turnover_idr = excluded.turnover_idr,
          constituents_count = excluded.constituents_count, advancers = excluded.advancers,
          decliners = excluded.decliners, unchanged = excluded.unchanged, partial = excluded.partial,
          computed_at = excluded.computed_at
        """,
        [(sector_id, *row, computed_at) for row in rows],
    )
    return len(rows)


def compute_index(*, db_path=None, report=None, weightings: list[str] | None = None) -> dict:
    cfg = get_settings()
    weightings = weightings or ["equal", "turnover", "captier"]
    conn = connect(db_path)
    try:
        sectors = conn.execute("SELECT id, code FROM sector WHERE is_active = 1 ORDER BY sort_order").fetchall()
        total = 0
        empty: list[str] = []
        for i, sector in enumerate(sectors, start=1):
            df = load_sector(conn, sector["code"])
            for weighting in weightings:
                rows = compute_series(
                    df,
                    weighting,
                    min_constituents=cfg.universe["min_constituents"],
                    turnover_window=cfg.scoring["turnover_short_days"],
                )
                total += _upsert(conn, sector["id"], rows, now_iso())
                if not rows:
                    empty.append(sector["code"])
            conn.commit()
            if report:
                report(rows=total, phase="compute_index", message=f"sektor {sector['code']} ({i}/{len(sectors)})")
        return {"rows": total, "sectors": len(sectors), "weightings": weightings, "sectors_without_data": sorted(set(empty))}
    finally:
        conn.close()
