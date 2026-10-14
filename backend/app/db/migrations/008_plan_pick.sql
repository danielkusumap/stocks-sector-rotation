-- 008: tabel `plan_pick` — hasil saring picks per tanggal (docs/04 §4, docs/07 B20d).
-- Idempotent-safe: db baru sudah memuat tabel ini dari schema.sql.

CREATE TABLE IF NOT EXISTS plan_pick (
  as_of_date    TEXT NOT NULL,
  ticker        TEXT NOT NULL,
  rank          INTEGER NOT NULL,
  score         REAL,
  zone_status   TEXT,
  zone_gap_atr  REAL,
  entry         REAL,
  stop          REAL,
  tp1           REAL,
  tp2           REAL,
  rr_tp2        REAL,
  sector_code   TEXT,
  quadrant      TEXT,
  rules_version TEXT,
  payload_json  TEXT NOT NULL,
  computed_at   TEXT NOT NULL,
  PRIMARY KEY (as_of_date, ticker)
);
CREATE INDEX IF NOT EXISTS idx_plan_pick_date ON plan_pick(as_of_date, rank);
