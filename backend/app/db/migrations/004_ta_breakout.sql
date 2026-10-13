-- 004: tabel hasil backtest MA (docs/04 §4, docs/03 §10). Statistik TIDAK disimpan.
-- Idempotent-safe: db baru sudah memuat tabel ini dari schema.sql.

CREATE TABLE IF NOT EXISTS ta_breakout (
  id           INTEGER PRIMARY KEY,
  scope        TEXT NOT NULL,             -- stock | sector
  ref_id       TEXT NOT NULL,             -- ticker | kode sektor
  weighting    TEXT,                      -- untuk scope=sector (equal|turnover|captier); NULL untuk saham
  ma_period    INTEGER NOT NULL,          -- 10 | 20 | 50 (config ta.ma_periods)
  trend_filter INTEGER NOT NULL,          -- 0 | 1 — varian yang dihitung (config ta.trend_filter)
  signal_date  TEXT NOT NULL,             -- D: adj_close(D) > MA(D) DAN adj_close(D−1) <= MA(D−1)
  entry_date   TEXT NOT NULL,             -- D+1 (hari bursa, bukan hari kalender)
  entry_price  REAL NOT NULL,             -- adj_close/open D+1 (lihat entry_basis)
  entry_basis  TEXT NOT NULL,             -- open | adj_close | index
  result       TEXT,                      -- win | loss | expired | open (open = horizon belum selesai)
  exit_date    TEXT,
  exit_price   REAL,
  periods      INTEGER,                   -- periode bursa dari entry_date (0 = bar entry); NULL saat open
  computed_at  TEXT NOT NULL,
  UNIQUE (scope, ref_id, ma_period, trend_filter, signal_date)
);
CREATE INDEX IF NOT EXISTS idx_ta_breakout_ref ON ta_breakout(scope, ref_id, ma_period, trend_filter, signal_date DESC);
