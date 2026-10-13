-- 005: analisa teknikal → trading plan (docs/03 §10.9 & §6.4, DDL di docs/04 §4).
-- Idempotent-safe: setiap statement dijalankan sendiri oleh runner (`app/db.py`), dan
-- `ADD COLUMN` untuk kolom yang sudah ada (db baru: schema.sql sudah memuatnya) diabaikan.

-- 1) MFE/MAE per event: menjawab "berapa sering target +3%/+8% tersentuh" tanpa hitung ulang (docs/03 §10.9)
ALTER TABLE ta_breakout ADD COLUMN mfe_pct REAL;
ALTER TABLE ta_breakout ADD COLUMN mae_pct REAL;

-- 2) Plan berbasis analisa teknikal per pick saham (docs/03 §6.4)
ALTER TABLE signal_weekly ADD COLUMN regime          TEXT;
ALTER TABLE signal_weekly ADD COLUMN entry_tool      TEXT;
ALTER TABLE signal_weekly ADD COLUMN confirm_tool    TEXT;
ALTER TABLE signal_weekly ADD COLUMN entry_mode      TEXT;
ALTER TABLE signal_weekly ADD COLUMN entry_zone_low  REAL;
ALTER TABLE signal_weekly ADD COLUMN entry_zone_high REAL;
ALTER TABLE signal_weekly ADD COLUMN stop_pct        REAL;
ALTER TABLE signal_weekly ADD COLUMN stop_basis      TEXT;
ALTER TABLE signal_weekly ADD COLUMN tp1             REAL;
ALTER TABLE signal_weekly ADD COLUMN tp2             REAL;
ALTER TABLE signal_weekly ADD COLUMN rr_tp1          REAL;
ALTER TABLE signal_weekly ADD COLUMN rr_tp2          REAL;
ALTER TABLE signal_weekly ADD COLUMN volume_ratio    REAL;
ALTER TABLE signal_weekly ADD COLUMN hold_median_periods INTEGER;
ALTER TABLE signal_weekly ADD COLUMN hit_tp1         REAL;
ALTER TABLE signal_weekly ADD COLUMN hit_tp2         REAL;
ALTER TABLE signal_weekly ADD COLUMN invalidation    TEXT;
ALTER TABLE signal_weekly ADD COLUMN plan_ok         INTEGER;
ALTER TABLE signal_weekly ADD COLUMN plan_json       TEXT;
