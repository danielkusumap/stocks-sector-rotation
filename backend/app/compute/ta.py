"""Analisa teknikal & backtest MA (docs/03 §10) — SMA, breakout, hasil ±target, dua varian filter.

Harga selalu `adj_close` (saham) / `index_close` (sektor). Statistik TIDAK dihitung di sini:
yang disimpan hanya baris `ta_breakout`; win rate & median diagregasi saat endpoint dipanggil
(docs/04 §4 catatan). Semua angka ambang dari `config ta.*` — tidak ada angka di kode.
"""

from __future__ import annotations

from ..config import get_settings
from ..db import connect, now_iso

STOCK_BARS_SQL = """
    SELECT date, adj_close AS price, open * adj_close / NULLIF(close, 0) AS entry_open
    FROM price_daily WHERE ticker = ? AND adj_close IS NOT NULL AND close IS NOT NULL
    ORDER BY date
"""
SECTOR_BARS_SQL = """
    SELECT i.date, i.index_close
    FROM sector_index_daily i JOIN sector s ON s.id = i.sector_id
    WHERE s.code = ? AND i.weighting = ? ORDER BY i.date
"""
EVENT_UPSERT_SQL = """
    INSERT INTO ta_breakout (scope, ref_id, weighting, ma_period, trend_filter, signal_date, entry_date,
                             entry_price, entry_basis, result, exit_date, exit_price, periods, mfe_pct, mae_pct, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, ref_id, ma_period, trend_filter, signal_date) DO UPDATE SET
      entry_date = excluded.entry_date, entry_price = excluded.entry_price, entry_basis = excluded.entry_basis,
      result = excluded.result, exit_date = excluded.exit_date, exit_price = excluded.exit_price,
      periods = excluded.periods, mfe_pct = excluded.mfe_pct, mae_pct = excluded.mae_pct,
      computed_at = excluded.computed_at
"""


def sma(values: list[float], period: int) -> list[float | None]:
    """`ma_p(t)` = rata-rata `p` bar terakhir; `None` sebelum bar ke-`p` (docs/03 §10.1)."""
    out: list[float | None] = [None] * len(values)
    window = 0.0
    for i, value in enumerate(values):
        window += value
        if i >= period:
            window -= values[i - period]
        if i >= period - 1:
            out[i] = window / period
    return out


def breakout_indices(close: list[float], ma: list[float | None], *, above_trend: list[bool] | None = None) -> list[int]:
    """Indeks bar D saat breakout = **transisi** `close(D) > ma(D)` dari `close(D−1) <= ma(D−1)` (docs/03 §10.2)."""
    out: list[int] = []
    for t in range(1, len(close)):
        if ma[t] is None or ma[t - 1] is None:
            continue
        if close[t] > ma[t] and close[t - 1] <= ma[t - 1] and (above_trend is None or above_trend[t]):
            out.append(t)
    return out


def simulate_result(close: list[float], entry_index: int, entry_price: float, *, target_pct: float, timeout_periods: int):
    """Telusuri maju dari bar entry (docs/03 §10.3) → `(result, exit_index, periods, exit_price)`.

    Bar entry ikut dievaluasi (`periods` = 0 sah, DDL `docs/04` §4) — entry di harga `open`, jadi
    close hari yang sama sudah bisa kena target. `−target` dicek lebih dulu: bar yang menyentuh
    `+target` **dan** `−target` dihitung `loss` (pesimis).
    Data habis sebelum horizon selesai → `open` dengan `periods` `None`.
    """
    for period in range(0, timeout_periods + 1):
        index = entry_index + period
        if index >= len(close):
            return "open", None, None, None
        change = close[index] / entry_price - 1
        if change <= -target_pct:
            return "loss", index, period, close[index]
        if change >= target_pct:
            return "win", index, period, close[index]
    index = entry_index + timeout_periods  # horizon habis → keluar di harga bar terakhir horizon
    return "expired", index, timeout_periods, close[index]


def reference_rows(
    bars: list[tuple[str, float, float | None]],
    *,
    scope: str,
    ma_period: int,
    use_open: bool,
    target_pct: float,
    timeout_periods: int,
    trend_filter_period: int,
    variants: list[int],
    trend_filter_on: bool,
) -> list[tuple]:
    """Baris `ta_breakout` (tanpa `id`) satu entitas × satu MA × semua varian filter tren.

    `bars` = `(date, harga penyesuaian, harga eksekusi D+1)`; slot ketiga `None` untuk indeks sektor
    (tidak punya `open`, docs/03 §10.7) → entry = nilai indeks D+1, `entry_basis = "index"`.
    `use_open` = `config ta.entry_basis == "next_open"`.
    """
    close = [b[1] for b in bars]
    ma = sma(close, ma_period)
    trend = sma(close, trend_filter_period) if trend_filter_on else [None] * len(close)
    above_trend = [trend[i] is not None and close[i] > trend[i] for i in range(len(close))]

    rows: list[tuple] = []
    for variant in variants:
        for signal in breakout_indices(close, ma, above_trend=above_trend if variant else None):
            entry = signal + 1
            if entry >= len(bars):  # breakout di bar terakhir: eksekusi D+1 belum ada
                continue
            entry_price, basis = close[entry], "index" if scope == "sector" else "adj_close"
            if scope == "stock" and use_open and bars[entry][2] is not None:
                entry_price, basis = bars[entry][2], "open"
            result, exit_index, periods, exit_price = simulate_result(
                close, entry, entry_price, target_pct=target_pct, timeout_periods=timeout_periods
            )
            span = close[entry : (exit_index if exit_index is not None else len(close) - 1) + 1]
            rows.append(
                (
                    ma_period,
                    variant,
                    bars[signal][0],
                    bars[entry][0],
                    entry_price,
                    basis,
                    result,
                    bars[exit_index][0] if exit_index is not None else None,
                    exit_price,
                    periods,
                    max(span) / entry_price - 1,  # mfe_pct (docs/03 §10.9)
                    min(span) / entry_price - 1,  # mae_pct
                )
            )
    return rows


def load_bars(conn, scope: str, ref_id: str, weighting: str) -> list[tuple[str, float, float | None]]:
    """Bar `(date, harga penyesuaian, harga eksekusi D+1)`.

    `price_daily.open` mentah (ingest memakai `auto_adjust=False`, docs/02 §1), sedangkan docs/03 §10
    mewajibkan semua harga di bagian ini `adj_close`. Karena itu `open` diskalakan ke kerangka
    penyesuaian bar yang sama (`open × adj_close / close`) — tanpa ini entry `open` mentah dibagi
    `adj_close` yang sudah disesuaikan dan muncul rugi palsu −5% di hari entry (ADR-039).
    """
    if scope == "sector":
        return [(r["date"], r["index_close"], None) for r in conn.execute(SECTOR_BARS_SQL, (ref_id, weighting))]
    return [(r["date"], r["price"], r["entry_open"]) for r in conn.execute(STOCK_BARS_SQL, (ref_id,))]


def compute_ta(*, db_path=None, report=None) -> dict:
    """Hitung & simpan semua event `ta_breakout` (docs/07 B17 #1). Idempotent (upsert per event)."""
    cfg = get_settings()
    ta = cfg.ta
    if ta["entry_basis"] not in ("next_open", "next_index_close"):
        raise ValueError(f"config ta.entry_basis tidak dikenal: {ta['entry_basis']!r}")
    weighting = cfg.universe["weighting"]
    variants = [0, 1] if ta["report_filter_variants"] else [1 if ta["trend_filter"] else 0]
    computed_at = now_iso()

    conn = connect(db_path)
    try:
        refs = [("stock", r["ticker"]) for r in conn.execute("SELECT ticker FROM stock WHERE is_active = 1 ORDER BY ticker")]
        refs += [("sector", r["code"]) for r in conn.execute("SELECT code FROM sector WHERE is_active = 1 ORDER BY sort_order")]
        batch = int(cfg.ingest["batch_size"])
        events = skipped = wins = losses = 0
        for i, (scope, ref_id) in enumerate(refs, start=1):
            bars = load_bars(conn, scope, ref_id, weighting)
            if len(bars) >= ta["min_history"]:
                event_rows: list[tuple] = []
                for ma_period in ta["ma_periods"]:
                    event_rows += reference_rows(
                        bars,
                        scope=scope,
                        ma_period=ma_period,
                        use_open=ta["entry_basis"] == "next_open",
                        target_pct=ta["target_pct"],
                        timeout_periods=ta["timeout_periods"],
                        trend_filter_period=ta["trend_filter_period"],
                        variants=variants,
                        trend_filter_on=bool(ta["trend_filter"]),
                    )
                conn.executemany(
                    EVENT_UPSERT_SQL,
                    [(scope, ref_id, weighting if scope == "sector" else None, *row, computed_at) for row in event_rows],
                )
                events += len(event_rows)
                wins += sum(1 for row in event_rows if row[6] == "win")
                losses += sum(1 for row in event_rows if row[6] == "loss")
            else:
                skipped += 1
            if i % batch == 0 or i == len(refs):
                conn.commit()
                if report:
                    report(rows=events, phase="compute_ta", message=f"{i}/{len(refs)} entitas · {events} event")
        return {
            "rows": events,
            "events": events,
            "refs": len(refs) - skipped,
            "refs_skipped_short_history": skipped,
            "ma_periods": list(ta["ma_periods"]),
            "variants": [f"filter_{'on' if v else 'off'}" for v in variants],
            "win_rate": round(wins / (wins + losses), 4) if (wins + losses) else None,
        }
    finally:
        conn.close()
