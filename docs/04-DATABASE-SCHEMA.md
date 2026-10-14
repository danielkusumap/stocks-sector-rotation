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
  kind        TEXT NOT NULL,               -- import_excel | prices_daily | prices_intraday | compute_all | compute_signals | compute_ta | midday
                                           -- (tujuh nilai ini saja; compute_index/compute_rrg bukan kind terpisah — lihat docs/05 §4.6)
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

### Analisa teknikal & backtest MA (docs/03 §10)

Satu tabel saja. Deret MA **tidak** disimpan: MA dihitung ulang saat endpoint dipanggil (murah, ~500 bar per entitas) — yang mahal adalah penelusuran maju per event, dan itulah yang disimpan.

```sql
CREATE TABLE ta_breakout (
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
CREATE INDEX idx_ta_breakout_ref ON ta_breakout(scope, ref_id, ma_period, trend_filter, signal_date DESC);
```

**Migrasi 005** (analisa teknikal → trading plan, `docs/03` §10.9 & §6.4):

```sql
-- 1) MFE/MAE per event: dipakai untuk "peluang historis target ini kena" (docs/03 §10.9)
ALTER TABLE ta_breakout ADD COLUMN mfe_pct REAL;
ALTER TABLE ta_breakout ADD COLUMN mae_pct REAL;

-- 2) Plan berbasis analisa teknikal per pick saham (docs/03 §6.4)
ALTER TABLE signal_weekly ADD COLUMN regime          TEXT;     -- tren_naik | range | turun | tipis (docs/03 §6.4.0)
ALTER TABLE signal_weekly ADD COLUMN entry_tool      TEXT;     -- pullback_ma20 | breakout_donchian | sr_channel | pivot_level | none
ALTER TABLE signal_weekly ADD COLUMN confirm_tool    TEXT;     -- volume | rsi_tepi_range | none  (maks satu)
ALTER TABLE signal_weekly ADD COLUMN entry_mode      TEXT;     -- pullback | breakout | wait_pullback | no_trade
ALTER TABLE signal_weekly ADD COLUMN entry_zone_low  REAL;
ALTER TABLE signal_weekly ADD COLUMN entry_zone_high REAL;
ALTER TABLE signal_weekly ADD COLUMN stop_pct        REAL;     -- negatif, mis. -0.0612
ALTER TABLE signal_weekly ADD COLUMN stop_basis      TEXT;     -- struktur_swing_low | volatilitas_atr | lantai_atr
ALTER TABLE signal_weekly ADD COLUMN tp1             REAL;
ALTER TABLE signal_weekly ADD COLUMN tp2             REAL;     -- sama dengan `target` (kompatibel)
ALTER TABLE signal_weekly ADD COLUMN rr_tp1          REAL;     -- sudah bersih biaya
ALTER TABLE signal_weekly ADD COLUMN rr_tp2          REAL;     -- sudah bersih biaya
ALTER TABLE signal_weekly ADD COLUMN volume_ratio    REAL;
ALTER TABLE signal_weekly ADD COLUMN hold_median_periods INTEGER;
ALTER TABLE signal_weekly ADD COLUMN hit_tp1         REAL;     -- 0..1, dari mfe_pct; NULL kalau event < min_events_hold
ALTER TABLE signal_weekly ADD COLUMN hit_tp2         REAL;
ALTER TABLE signal_weekly ADD COLUMN invalidation    TEXT;
ALTER TABLE signal_weekly ADD COLUMN plan_ok         INTEGER;  -- 0|1; 0 = tetap tampil + catatan alasannya
ALTER TABLE signal_weekly ADD COLUMN plan_json       TEXT;     -- alasan per elemen + angka dasar + catatan
```

**Migrasi 006** membuat tabel `stock_plan` (di atas) — dipakai halaman detail saham untuk **semua emiten** (`docs/03` §6.5).

`target` (kolom lama) tetap diisi = `tp2` supaya klien lama tidak pecah; `entry_ref` tetap = close Jumat (acuan),
sedangkan `entry_zone_low/high` = zona entry aktual. Semua migrasi idempotent-safe (`ADD COLUMN` boleh gagal bila sudah ada →
bungkus dengan pengecekan `PRAGMA table_info`).

Catatan: statistik (win rate, median periode) **tidak** disimpan di tabel — diagregasi SQL saat endpoint dipanggil supaya tidak ada angka basi. `ingest_run.kind` bertambah satu nilai (`compute_ta`, `docs/05` §4.6).

### `plan_pick` — hasil saring picks per tanggal (docs/07 B20d)

```sql
CREATE TABLE plan_pick (
  as_of_date    TEXT NOT NULL,            -- tanggal pick (bar terakhir yang dipakai)
  ticker        TEXT NOT NULL,
  rank          INTEGER NOT NULL,         -- urutan skor saat disimpan (1 = terbaik)
  score         REAL,
  zone_status   TEXT,                     -- di_zona | mendekati (saat disaring)
  zone_gap_atr  REAL,                     -- jarak harga ke batas atas zona, satuan ATR
  entry         REAL,
  stop          REAL,
  tp1           REAL,
  tp2           REAL,
  rr_tp2        REAL,
  sector_code   TEXT,
  quadrant      TEXT,                     -- kuadran sektor (bobot default) saat itu
  rules_version TEXT,                     -- versi aturan saring (`weekly.plan.picks_rules_version`)
  payload_json  TEXT NOT NULL,            -- kartu siap-tampil: plan, rules, validity, skor_rincian
  computed_at   TEXT NOT NULL,
  PRIMARY KEY (as_of_date, ticker)
);
CREATE INDEX idx_plan_pick_date ON plan_pick(as_of_date, rank);
```

Retensi: ikut `retention.plan_days` (dihapus bersamaan dengan `stock_plan` di housekeeping).
Isi ditulis **saat compute** (`stage=ta`/`all`, param `plan_days` untuk backfill N hari bursa) —
endpoint `/plan/picks` hanya membaca, karena versi hitung-langsung memakan 20,0 s per panggilan.

### `stock_plan` — analisa teknikal untuk **semua emiten** (docs/03 §6.5)

```sql
CREATE TABLE stock_plan (
  as_of_date    TEXT NOT NULL,            -- bar harian terakhir yang dipakai
  ticker        TEXT NOT NULL,
  regime        TEXT NOT NULL,            -- tren_naik | range | turun | tipis | tidak_cukup_data
  entry_tool    TEXT,                     -- pullback_ma20 | breakout_donchian | sr_channel | pivot_level | none
  confirm_tool  TEXT,                     -- volume | rsi_tepi_range | none  (maks satu)
  entry_mode    TEXT,                     -- pullback | breakout | wait_pullback | no_trade
  entry_zone_low  REAL,
  entry_zone_high REAL,
  stop          REAL,
  stop_pct      REAL,
  stop_basis    TEXT,
  tp1           REAL,
  tp2           REAL,
  rr_tp1        REAL,                     -- bersih biaya
  rr_tp2        REAL,
  volume_ratio  REAL,
  hold_median_periods INTEGER,
  hit_tp1       REAL,                     -- first touch vs −stop (docs/03 §6.4.5)
  hit_tp2       REAL,
  p_tp1_first   REAL,                     -- skenario (docs/03 §6.5.2)
  p_sl_first    REAL,
  p_timeout     REAL,
  p_tp2_first   REAL,                     -- migrasi 007: terlewat di DDL awal, ada di kontrak docs/03 §6.5.2
  median_periods_tp1 INTEGER,
  median_periods_sl  INTEGER,
  n_events      INTEGER,
  invalidation  TEXT,
  summary_lines TEXT,                     -- JSON array 1–3 kalimat (Bahasa Indonesia)
  plan_ok       INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,                     -- JSON array
  plan_json     TEXT,                     -- alasan per elemen (sama seperti signal_weekly)
  computed_at   TEXT NOT NULL,
  PRIMARY KEY (as_of_date, ticker)
);
CREATE INDEX idx_stock_plan_ticker ON stock_plan(ticker, as_of_date DESC);
```

Retensi: `retention.plan_days` (default 60 hari) — housekeeping di job harian, sama pola dengan `midday_rrg_days`.

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
