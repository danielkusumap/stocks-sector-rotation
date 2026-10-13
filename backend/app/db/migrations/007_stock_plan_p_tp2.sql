-- 007: kolom `p_tp2_first` di `stock_plan` — ada di kontrak (docs/03 §6.5.2 & docs/05 §2) tapi terlewat di DDL migrasi 006.
-- Idempotent-safe: runner migrasi melewati `duplicate column name`.

ALTER TABLE stock_plan ADD COLUMN p_tp2_first REAL;
