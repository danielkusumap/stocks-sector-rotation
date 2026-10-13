-- 006: tabel `stock_plan` — analisa teknikal untuk SEMUA emiten (docs/04 §4, docs/03 §6.5).
-- Idempotent-safe: db baru sudah memuat tabel ini dari schema.sql.

CREATE TABLE IF NOT EXISTS stock_plan (
  as_of_date    TEXT NOT NULL,
  ticker        TEXT NOT NULL,
  regime        TEXT NOT NULL,
  entry_tool    TEXT,
  confirm_tool  TEXT,
  entry_mode    TEXT,
  entry_zone_low  REAL,
  entry_zone_high REAL,
  stop          REAL,
  stop_pct      REAL,
  stop_basis    TEXT,
  tp1           REAL,
  tp2           REAL,
  rr_tp1        REAL,
  rr_tp2        REAL,
  volume_ratio  REAL,
  hold_median_periods INTEGER,
  hit_tp1       REAL,
  hit_tp2       REAL,
  p_tp1_first   REAL,
  p_sl_first    REAL,
  p_timeout     REAL,
  median_periods_tp1 INTEGER,
  median_periods_sl  INTEGER,
  n_events      INTEGER,
  invalidation  TEXT,
  summary_lines TEXT,
  plan_ok       INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,
  plan_json     TEXT,
  computed_at   TEXT NOT NULL,
  PRIMARY KEY (as_of_date, ticker)
);
CREATE INDEX IF NOT EXISTS idx_stock_plan_ticker ON stock_plan(ticker, as_of_date DESC);
