# 04 — Database Schema (SQLite)

File: `data/rotation.db`. Semua DDL di bawah masuk ke `backend/db/schema.sql` dan dijalankan oleh `python -m backend.cli db-init`.

Aturan umum:
- `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;`
- Semua tanggal disimpan `TEXT` format `YYYY-MM-DD` (tanggal WIB), timestamp `TEXT` ISO-8601 dengan offset (`2026-10-12T16:10:00+07:00`).
- Uang dalam **rupiah penuh** (integer). Tidak ada float untuk uang.
- Persen/rasio disimpan sebagai float apa adanya (0.0123 = 1,23%), kecuali RS-Ratio/RS-Momentum (sudah "×100" di sekitar 100).
- Tidak ada kolom `is_deleted`. Penghapusan data = update `is_active = 0`.
- Setiap tabel hasil perhitungan menyimpan `computed_at` supaya API bisa melaporkan kesegaran.

## 1. Master & universe

```sql
CREATE TABLE sector (
  id           INTEGER PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,        -- IDXENERGY, IDXFINANCE, ...
  name_id      TEXT NOT NULL,               -- "Keuangan"
  name_en      TEXT NOT NULL,               -- "Financials"
  color_hex    TEXT NOT NULL,               -- warna tetap per sektor (docs/06 §3)
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE stock (
  id             INTEGER PRIMARY KEY,
  ticker         TEXT NOT NULL UNIQUE,      -- "BBCA" (4 karakter, tanpa .JK)
  yahoo_symbol   TEXT NOT NULL,             -- "BBCA.JK"
  name           TEXT,                      -- dari Excel ("Nama Perusahaan"), fallback .info
  sector_id      INTEGER NOT NULL REFERENCES sector(id),
  subsector      TEXT,
  board          TEXT,                      -- Utama | Pengembangan | Akselerasi | Ekonomi Baru | Pemantauan Khusus
  listing_date   TEXT,                      -- dari Excel "Tanggal Pencatatan", NULL bila gagal parse
  shares_outstanding INTEGER,               -- dari Excel "Saham" → bobot market cap
  notes          TEXT,
  market_cap_idr INTEGER,                   -- dihitung: shares_outstanding * close (atau dari .info)
  yahoo_sector   TEXT,                      -- cross-check klasifikasi Yahoo
  is_active      INTEGER NOT NULL DEFAULT 1,
  last_bar_date  TEXT,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_stock_sector ON stock(sector_id, is_active);
CREATE INDEX idx_stock_active ON stock(is_active);
-- v2 (jangan dibangun sekarang): stock_sector_history(stock_id, sector_id, from_date, to_date)
```

## 2. Import Excel

```sql
CREATE TABLE excel_import (
  id          INTEGER PRIMARY KEY,
  filename    TEXT NOT NULL,
  sha256      TEXT NOT NULL UNIQUE,
  imported_at TEXT NOT NULL,
  sheet_count INTEGER NOT NULL,
  rows_ok     INTEGER NOT NULL,
  rows_error  INTEGER NOT NULL
);

CREATE TABLE excel_import_error (
  id         INTEGER PRIMARY KEY,
  import_id  INTEGER NOT NULL REFERENCES excel_import(id) ON DELETE CASCADE,
  sheet      TEXT NOT NULL,
  row_no     INTEGER,
  raw_value  TEXT,
  reason     TEXT NOT NULL              -- invalid_ticker | unknown_sheet | duplicate_ticker | empty_row
);
```

## 3. Harga

```sql
CREATE TABLE price_daily (
  ticker     TEXT NOT NULL,             -- ticker saham, atau "IHSG" untuk benchmark
  date       TEXT NOT NULL,             -- YYYY-MM-DD (WIB)
  open       REAL, high REAL, low REAL, close REAL,
  adj_close  REAL,
  volume     INTEGER,
  value_idr  INTEGER,                   -- close * volume, diisi saat ingest
  source     TEXT NOT NULL DEFAULT 'yfinance',
  ingested_at TEXT NOT NULL,
  PRIMARY KEY (ticker, date)
);
CREATE INDEX idx_price_daily_date ON price_daily(date);

CREATE TABLE price_intraday (
  ticker   TEXT NOT NULL,
  ts       TEXT NOT NULL,              -- ISO-8601 +07:00, jam bursa reguler saja
  interval TEXT NOT NULL,              -- "5m" | "60m"
  open REAL, high REAL, low REAL, close REAL, volume INTEGER,
  session  TEXT NOT NULL DEFAULT 'regular',   -- regular | post (16:00-16:15, tidak dipakai hitung)
  ingested_at TEXT NOT NULL,
  PRIMARY KEY (ticker, ts, interval)
);
CREATE INDEX idx_intraday_ticker_ts ON price_intraday(ticker, ts);

CREATE TABLE data_freshness (
  key         TEXT PRIMARY KEY,        -- "midday_gate" | "daily_ingest" | "intraday_ingest"
  as_of_date  TEXT,
  last_bar_at TEXT,
  status      TEXT NOT NULL,           -- ok | stale | partial | failed
  detail      TEXT,                    -- JSON: probe tickers, last bar per probe
  checked_at  TEXT NOT NULL
);
```

## 4. Hasil perhitungan

```sql
CREATE TABLE sector_index_daily (
  sector_id        INTEGER NOT NULL REFERENCES sector(id),
  date             TEXT NOT NULL,
  weighting        TEXT NOT NULL,      -- equal | turnover
  index_close      REAL NOT NULL,      -- base 100 di t0
  ret_1d           REAL,
  turnover_idr     INTEGER,
  constituents_count INTEGER NOT NULL,
  advancers        INTEGER NOT NULL DEFAULT 0,
  decliners        INTEGER NOT NULL DEFAULT 0,
  unchanged        INTEGER NOT NULL DEFAULT 0,
  partial          INTEGER NOT NULL DEFAULT 0,   -- 1 = < 3 konstituen bertransaksi
  computed_at      TEXT NOT NULL,
  PRIMARY KEY (sector_id, date, weighting)
);

CREATE TABLE rrg_daily (
  as_of_date       TEXT NOT NULL,
  scope            TEXT NOT NULL,      -- sector | stock
  ref_id           TEXT NOT NULL,      -- kode sektor, atau ticker
  timeframe        TEXT NOT NULL,      -- d1 | w1 | w1_fri | midday
  weighting        TEXT NOT NULL,      -- equal | turnover
  rs                REAL,              -- RS mentah (level)
  rs_ratio          REAL NOT NULL,
  rs_momentum       REAL NOT NULL,
  quadrant          TEXT NOT NULL,     -- leading | weakening | lagging | improving
  quadrant_prev     TEXT,
  transition        TEXT,              -- "improving→leading"
  quadrant_age_periods INTEGER NOT NULL DEFAULT 1,
  rs_ratio_change_1p   REAL,
  rs_momentum_change_1p REAL,
  score             REAL,              -- hanya scope=sector, lihat docs/03 §5
  bench_ref         TEXT NOT NULL,     -- "IHSG" untuk sektor; kode sektor untuk scope=stock
  computed_at       TEXT NOT NULL,
  PRIMARY KEY (as_of_date, scope, ref_id, timeframe, weighting)
);
CREATE INDEX idx_rrg_lookup ON rrg_daily(timeframe, scope, as_of_date DESC);

CREATE TABLE sector_metrics (
  sector_id    INTEGER NOT NULL REFERENCES sector(id),
  as_of_date   TEXT NOT NULL,
  timeframe    TEXT NOT NULL,
  weighting    TEXT NOT NULL,
  ret_1w REAL, ret_1m REAL, ret_3m REAL, ret_6m REAL, ret_ytd REAL,
  ret_intraday REAL,                       -- terisi pada timeframe=midday
  median_turnover_20d_idr INTEGER,
  turnover_growth   REAL,                  -- median20d / median60d - 1
  rrg_rs_ratio      REAL,
  rrg_rs_momentum   REAL,
  score             REAL,
  rank_score        INTEGER,               -- 1..11
  intraday_move     TEXT,                  -- naik | turun | datar
  projected_quadrant TEXT,
  data_status       TEXT NOT NULL DEFAULT 'ok',  -- ok | stale | partial
  computed_at       TEXT NOT NULL,
  PRIMARY KEY (sector_id, as_of_date, timeframe, weighting)
);

CREATE TABLE stock_metrics (
  ticker      TEXT NOT NULL,
  as_of_date  TEXT NOT NULL,
  timeframe   TEXT NOT NULL,
  close       REAL, ret_1d REAL, ret_5d REAL, ret_1m REAL, ret_3m REAL,
  sma20 REAL, sma50 REAL, rsi14 REAL, atr14 REAL,
  median_turnover_20d_idr INTEGER,
  rs_ratio REAL, rs_momentum REAL, quadrant TEXT,   -- vs indeks sektornya
  stock_score REAL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (ticker, as_of_date, timeframe)
);

CREATE TABLE signal_weekly (
  week_end    TEXT NOT NULL,               -- selalu tanggal Jumat
  scope       TEXT NOT NULL,               -- sector | stock
  ref_id      TEXT NOT NULL,
  sector_id   INTEGER REFERENCES sector(id),
  timeframe   TEXT NOT NULL DEFAULT 'w1_fri',
  rank        INTEGER NOT NULL,
  score       REAL NOT NULL,
  streak_weeks INTEGER NOT NULL DEFAULT 1,
  rule_hits   TEXT NOT NULL,               -- JSON: {rule: true/false/nilai}
  entry_ref   REAL,                        -- hanya scope=stock
  stop        REAL,
  target      REAL,
  atr14       REAL,
  lots_hint   INTEGER,
  rationale   TEXT NOT NULL,               -- kalimat siap tampil, Bahasa Indonesia
  computed_at TEXT NOT NULL,
  PRIMARY KEY (week_end, scope, ref_id)
);
CREATE INDEX idx_signal_week ON signal_weekly(week_end DESC, scope);

CREATE TABLE ingest_run (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,               -- excel | prices_daily | prices_intraday | compute_index | compute_rrg | compute_signals | midday
  status      TEXT NOT NULL,               -- queued | running | ok | partial | failed | skipped
  phase       TEXT,                        -- tahap yang sedang jalan (mis. "ingest", "compute_rrg")
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  rows        INTEGER NOT NULL DEFAULT 0,
  rows_total  INTEGER,                     -- perkiraan total baris/emiten untuk progress bar UI
  percent     REAL,                        -- 0-100, NULL kalau rows_total belum diketahui
  message     TEXT,                        -- teks progres terakhir yang bisa ditampilkan UI
  params_json TEXT,                        -- query/body asli (mode, stage, timeframe, from, to)
  result_json TEXT,                        -- ringkasan hasil (inserted/updated/errors/failed_tickers)
  triggered_by TEXT NOT NULL DEFAULT 'cli' -- cli | api | ui | cron
);
CREATE INDEX idx_ingest_run_started ON ingest_run(started_at DESC);
```

## 5. View untuk API

```sql
CREATE VIEW v_sector_latest AS
SELECT s.code, s.name_id, s.color_hex,
       m.*
FROM sector_metrics m
JOIN sector s ON s.id = m.sector_id
WHERE m.as_of_date = (SELECT MAX(as_of_date) FROM sector_metrics WHERE timeframe = m.timeframe)
  AND m.timeframe  = 'd1';   -- view dasar; API menyaring timeframe-nya sendiri

CREATE VIEW v_stock_latest AS
SELECT st.ticker, st.name, sec.code AS sector_code, sm.*
FROM stock_metrics sm
JOIN stock st  ON st.ticker = sm.ticker
JOIN sector sec ON sec.id = st.sector_id;
```

**Catatan implementasi view:** SQLite tidak punya parameter, jadi view `v_sector_latest` hanya contoh bentuk; query API sebaiknya menulis JOIN langsung dengan `WHERE timeframe = :tf AND as_of_date = :as_of`. Jangan memaksa view kalau malah bikin lambat — ukur dulu.

## 6. Retention & housekeeping

- `price_intraday`: simpan **30 hari** terakhir (5m) — cukup untuk audit gate; hapus sisanya saat job harian (config `retention.intraday_days: 30`).
- `price_daily`: tanpa batas (2 tahun diisi saat backfill).
- `rrg_daily` / `sector_metrics` / `stock_metrics`: simpan 2 tahun untuk timeframe `d1`/`w1`; `midday` hanya 60 hari.
- Sebelum menghapus apa pun: `VACUUM` hanya dijalankan di job mingguan kalau file > 200 MB.

## 7. Migrasi

Tidak pakai framework migrasi. `backend/db/migrations/NNN_description.sql` dijalankan berurutan, versi terakhir dicatat di `PRAGMA user_version`. Setiap migrasi wajib idempotent-safe (pakai `IF NOT EXISTS`) dan **ditulis juga di `docs/DECISIONS.md`** kalau mengubah tabel yang sudah dipakai API.
