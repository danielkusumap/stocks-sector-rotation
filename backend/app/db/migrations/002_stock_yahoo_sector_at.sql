-- 002: penanda kapan `yahoo_sector` (cross-check `.info`) terakhir diambil, dipakai
-- untuk aturan "maks sekali per config.ingest.refresh_market_cap_days".
-- Db baru sudah memuat kolom ini dari schema.sql (runner migrasi mengabaikan error duplikat).
ALTER TABLE stock ADD COLUMN yahoo_sector_at TEXT;
