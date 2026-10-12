-- 001: kolom progres & audit untuk `ingest_run` (docs/04 §4, docs/05 §4.3).
-- Menambah kolom pada db yang sudah ada; db baru sudah memuat kolom ini dari schema.sql
-- (runner migrasi mengabaikan error "duplicate column name" pada kasus itu).
ALTER TABLE ingest_run ADD COLUMN phase TEXT;
ALTER TABLE ingest_run ADD COLUMN rows_total INTEGER;
ALTER TABLE ingest_run ADD COLUMN percent REAL;
ALTER TABLE ingest_run ADD COLUMN params_json TEXT;
ALTER TABLE ingest_run ADD COLUMN result_json TEXT;
ALTER TABLE ingest_run ADD COLUMN triggered_by TEXT NOT NULL DEFAULT 'cli';
CREATE INDEX IF NOT EXISTS idx_ingest_run_started ON ingest_run(started_at DESC);
