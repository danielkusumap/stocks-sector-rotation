-- 009: kolom `last_bar_date` di `stock_plan` — tanggal bar terakhir emiten pada cutoff itu (docs/07 B20e).
-- `as_of_date` = cutoff yang diminta run; `last_bar_date` = bar terakhir yang benar-benar dipakai emiten itu.
-- Idempotent-safe: db baru sudah memuat kolom ini dari schema.sql; runner migrasi melewati `duplicate column name`.

ALTER TABLE stock_plan ADD COLUMN last_bar_date TEXT;
