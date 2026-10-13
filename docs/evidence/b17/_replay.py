"""Replay manual satu event `ta_breakout` dengan SQL mentah (docs/07 B17 bukti wajib).

Event: scope=stock, ref_id=BBRI, ma_period=20, trend_filter=0, signal_date=2025-09-03.
Dijalankan pada DB uji `E:/rotation-b17-test/rotation.db` (config salinan, 15 emiten aktif).
"""

from __future__ import annotations

import sqlite3

DB = r"E:/rotation-b17-test/rotation.db"
SIGNAL, PERIOD, VARIANT, TICKER = "2025-09-03", 20, 0, "BBRI"
TARGET, TIMEOUT = 0.05, 60

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
out: list[str] = []


def show(title: str, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    rows = conn.execute(sql, params).fetchall()
    out.append(f"\n--- {title} ---")
    for row in rows:
        out.append(" · ".join(f"{k}={v}" for k, v in dict(row).items()))
    return rows


# 1. Transisi: close > MA20 dan close(D−1) <= MA20(D−1)
show(
    "1. MA20 di sekitar sinyal (adj_close, jendela penuh; docs/03 §10.1–§10.2)",
    """
    SELECT date, adj_close AS close,
           (SELECT ROUND(AVG(a.adj_close), 4) FROM (SELECT adj_close FROM price_daily
             WHERE ticker = ? AND date <= d.date ORDER BY date DESC LIMIT ?) a) AS ma20,
           (SELECT COUNT(*) FROM price_daily WHERE ticker = ? AND date <= d.date) AS bar_ke
    FROM price_daily d WHERE ticker = ? AND date BETWEEN '2025-09-01' AND '2025-09-04' ORDER BY date
    """,
    (TICKER, PERIOD, TICKER, TICKER),
)

# 2. Entry D+1: open mentah diskalakan ke kerangka adj_close (ADR-039)
show(
    "2. Entry D+1 = open × adj_close / close (docs/03 §10.3)",
    "SELECT date, open AS open_mentah, close, adj_close, ROUND(open * adj_close / close, 4) AS entry_price, 'open' AS entry_basis"
    " FROM price_daily WHERE ticker = ? AND date > ? ORDER BY date LIMIT 1",
    (TICKER, SIGNAL),
)

# 3. Hasil: bar pertama yang menyentuh +5% / −5% (timeout 60 periode)
show(
    "3. Telusuri maju sampai ±5% (periode = bar ke-n setelah entry)",
    """
    WITH entry AS (
      SELECT date AS entry_date, open * adj_close / close AS entry_price
      FROM price_daily WHERE ticker = ? AND date > ? ORDER BY date LIMIT 1
    )
    SELECT p.date, p.adj_close AS close,
           ROUND(CAST(julianday(p.date) - julianday(e.entry_date) AS INT), 0) AS hari_kalender,
           ROUND((SELECT COUNT(*) FROM price_daily x WHERE x.ticker = p.ticker AND x.date > e.entry_date AND x.date <= p.date), 0) AS periods,
           ROUND(p.adj_close / e.entry_price - 1, 4) AS ret
    FROM price_daily p, entry e
    WHERE p.ticker = ? AND p.date > e.entry_date ORDER BY p.date LIMIT 8
    """,
    (TICKER, SIGNAL, TICKER),
)

# 4. Baris tersimpan
show(
    "4. Baris `ta_breakout` yang tersimpan (harus sama dengan hitungan di atas)",
    "SELECT scope, ref_id, ma_period, trend_filter, signal_date, entry_date, ROUND(entry_price, 4) AS entry_price,"
    " entry_basis, result, exit_date, ROUND(exit_price, 4) AS exit_price, periods"
    " FROM ta_breakout WHERE scope='stock' AND ref_id=? AND ma_period=? AND trend_filter=? AND signal_date=?",
    (TICKER, PERIOD, VARIANT, SIGNAL),
)

# 5. Baris tepat di exit: berapa return-nya
show(
    "5. Return di bar exit (target 5%)",
    """
    WITH entry AS (SELECT open * adj_close / close AS entry_price FROM price_daily
                   WHERE ticker = ? AND date > ? ORDER BY date LIMIT 1)
    SELECT p.date, p.adj_close AS close, ROUND(p.adj_close / e.entry_price - 1, 4) AS ret
    FROM price_daily p, entry e
    WHERE p.ticker = ? AND p.date = (SELECT exit_date FROM ta_breakout WHERE scope='stock' AND ref_id=?
                                     AND ma_period=? AND trend_filter=? AND signal_date=?)
    """,
    (TICKER, SIGNAL, TICKER, TICKER, PERIOD, VARIANT, SIGNAL),
)

# 6. Statistik entitas (dihitung saat endpoint dipanggil, tidak disimpan)
show(
    "6. Statistik BBRI ma_period=20 trend_filter=0 & 1 (median, bukan mean)",
    """
    SELECT trend_filter, COUNT(*) AS n_events,
           SUM(result='win') AS win, SUM(result='loss') AS loss, SUM(result='expired') AS expired, SUM(result='open') AS open_flag,
           ROUND(1.0 * SUM(result='win') / NULLIF(SUM(result IN ('win','loss')), 0), 4) AS win_rate
    FROM ta_breakout WHERE scope='stock' AND ref_id=? AND ma_period=? GROUP BY trend_filter
    """,
    (TICKER, PERIOD),
)

text = "\n".join(out)
print(text)
with open(r"E:/stocks-sector-rotation/docs/evidence/b17/REPLAY.txt", "w", encoding="utf-8") as handle:
    handle.write(f"Replay manual event {TICKER} {SIGNAL} (ma_period={PERIOD}, trend_filter={VARIANT})\n" + text + "\n")
conn.close()
