# 07 — Task Backend (agen backend)

Kamu mengerjakan folder `backend/`. Baca dulu: `docs/05-API-CONTRACT.md`, `docs/04-DATABASE-SCHEMA.md`, `docs/03-METHODOLOGY.md`, `docs/02-DATA-SOURCES.md`, `config/default.yaml`.

**Stack wajib:** Python 3.12+, FastAPI, uvicorn, **`sqlite3` stdlib** (tanpa SQLAlchemy), pandas, numpy, yfinance, openpyxl, pydantic-settings, pytest + httpx. **Tidak ada** dependency lain tanpa alasan tertulis di `DECISIONS.md`.

Struktur yang dituju:

```
backend/
├─ pyproject.toml
├─ AGENTS.md
├─ app/
│  ├─ main.py            # FastAPI app + routers
│  ├─ config.py          # baca config/default.yaml (pydantic-settings)
│  ├─ db.py              # koneksi, PRAGMA, helper query, db-init
│  ├─ db/schema.sql      # DDL docs/04
│  ├─ db/migrations/NNN_*.sql
│  ├─ repo/              # query per domain (sector.py, stock.py, rrg.py, signal.py, run.py)
│  ├─ ingest/            # excel.py, prices.py, freshness.py
│  ├─ compute/           # index.py, rrg.py, metrics.py, signals.py, indicators.py
│  ├─ api/               # meta.py, rrg.py, sectors.py, stocks.py, weekly.py, briefing.py, admin.py
│  └─ schemas.py         # model pydantic response (sumber bentuk JSON)
├─ cli.py                # python -m backend.cli <cmd>
└─ tests/
```

Perintah CLI yang wajib ada (dipakai Hermes & user, dokumentasikan di `backend/README.md`):
```
python -m backend.cli db-init
python -m backend.cli import-excel data/idx_sector_master.xlsx
python -m backend.cli ingest-prices --mode daily --from 2024-10-01
python -m backend.cli ingest-prices --mode intraday
python -m backend.cli compute --stage all --timeframe d1
python -m backend.cli compute --stage signals --timeframe w1_fri
python -m backend.cli midday                 # gate + hitung ulang + compute rrg midday
python -m backend.cli serve                  # uvicorn app.main:app --port 8000
```

---

## B0 — Skeleton, config, db-init
**Deliverable:** `pyproject.toml`, `backend/app/main.py` (hanya `/health` + middleware CORS untuk `http://localhost:5173`), `config.py` membaca `config/default.yaml` (path bisa di-override `--config`/env `ROTATION_CONFIG`), `db.py` + `db/schema.sql` dari `docs/04`, `cli.py db-init`.
**AC:** `python -m backend.cli db-init` membuat `data/rotation.db` dengan 14 tabel; `pytest -q` hijau; `GET /health` → `{"status":"ok","db":"ok"}`; menjalankan `db-init` dua kali tidak error.
**Bukti:** tempel output `db-init` (jumlah tabel) di `PROGRESS.md`.

## B1 — Import Excel
**Deliverable:** `ingest/excel.py` + `POST /api/v1/admin/import/excel` + CLI `import-excel`. Aturan parsing = `docs/02 §6` (kolom nyata `Kode/Nama Perusahaan/Tanggal Pencatatan/Saham/Papan Pencatatan`, normalisasi ticker 4 karakter, sheet per sektor, duplicate → error row, idempotent by sha256, `is_active=0` untuk yang hilang, `?force`/`?strict`).
**AC — diuji terhadap `saham_sektoral.xlsx` yang sudah ada di root repo (bukan fixture karangan):**
1. Import file itu → `inserted = 962`, `deactivated = 0`, `errors = 0`.
2. `SELECT COUNT(*) FROM stock WHERE is_active = 1` = 962; sebaran per sektor sama dengan tabel di `docs/02 §6` (IDXCYCLIC 162 … IDXTRANS 40).
3. `SELECT board, COUNT(*) FROM stock GROUP BY board` = Utama 293, Pengembangan 556, Pemantauan Khusus 69, Akselerasi 43, Ekonomi Baru 1.
4. `listing_date` terisi untuk ≥ 95% baris (contoh: `BMHS` → `2021-07-06`), tidak ada yang bikin import gagal.
5. `shares_outstanding` terisi untuk ≥ 95% baris (contoh: `BMHS` → 8603416176).
6. Import ulang file yang sama → `409 already_imported`; dengan `?force=true` → `updated = 962`, tidak ada baris baru.
7. Fixture tambahan (3 sheet kecil: 5 valid, 1 `BCA` invalid, 1 duplikat) → `errors=2` dengan `reason` tepat.
**Bukti:** output JSON import asli + 4 query SQL di atas.

## B2 — Ingest harga harian
**Deliverable:** `ingest/prices.py` (batch `yf.download` 50 ticker, sleep, retry 3× backoff, upsert `price_daily`, `value_idr = close×volume`, ticker `IHSG` dari `^JKSE`, kolom `adj_close`), CLI + endpoint admin. `market_cap_idr` dihitung sendiri (`shares_outstanding × close`, tanpa `.info`); `.info` **hanya** untuk mengisi `yahoo_sector` sebagai cross-check, maks sekali/7 hari per emiten (`config.ingest.refresh_market_cap_days`).
**AC:** menjalankan untuk seluruh universe mengisi ≥ 400 baris/emiten tanpa error; menjalankan ulang hari yang sama tidak menggandakan baris (hitung `COUNT(*)` sebelum & sesudah); emiten tanpa data tidak menyebabkan kegagalan keseluruhan dan tercatat di `failed_tickers`.
**Bukti:** `COUNT(*) FROM price_daily`, daftar `failed_tickers`.

## B3 — Ingest intraday + gate kesegaran
**Deliverable:** `ingest/freshness.py` (probe watchlist config, `last_bar_at`, status `ok|stale`), `POST /api/v1/admin/midday`, `GET /api/v1/freshness`, ingest bar 5m/60m jam bursa reguler saja (`session='post'` untuk 16:00–16:15).
**AC:** dengan data uji yang bar terakhirnya 11:05 → `gate="stale"`, tidak ada baris `midday` baru tertulis; setelah data 11:35 → `gate="ok"` dan `compute` jalan. Bar `16:05` **tidak** masuk agregasi (uji eksplisit).
**Bukti:** output dua skenario gate.

## B4 — Indeks sektor
**Deliverable:** `compute/index.py` — `sector_index_daily` untuk `weighting=equal` **dan** `turnover` **dan** `captier` (cap pakai `shares_outstanding` dari Excel, bukan `.info`), semua kolom DDL terisi (return, turnover, advancers/decliners/unchanged, constituents_count, partial).
**AC:** test `test_index_equal_weight` (`docs/03 §9`) lulus; untuk sektor berisi 1 saham (uji fixture) indeks bergerak sesuai return harian saham itu; `partial=1` muncul bila < 3 konstituen bertransaksi; saham tanpa `shares_outstanding` dikecualikan dari `captier` (jangan dianggap bobot 0 pasif — hitung ulang penyebutnya).
**Bukti:** 3 baris `sector_index_daily` nyata dari data IDX untuk tiap weighting.

## B5 — RRG (sektor & saham)
**Deliverable:** `compute/rrg.py` + `compute/indicators.py` (EMA, SMA, RSI14 Wilder, ATR14 Wilder) → tabel `rrg_daily` + `sector_metrics` + `stock_metrics`; semua rumus dari `docs/03 §2–§4`; `rrg.min_points` dihormati.
**AC:** `test_rrg_quadrant` & `test_rrg_warmup` lulus; hasil 11 sektor untuk `d1` dan `w1` tersimpan; `scope=stock` memakai indeks sektor sebagai benchmark (uji: satu saham yang naik lebih cepat dari sektornya → `rs_ratio > 100`).
**Bukti:** tempel 11 baris `rrg_daily` (as_of terakhir, timeframe w1) di `PROGRESS.md`.

## B6 — Skor & metrik
**Deliverable:** skor sektor & saham, persentil, `rank_score`, `turnover_growth`, `ret_1w/1m/3m/6m/ytd`, `banding margin_to_min_turnover` (kolom di `stock_metrics` lewat response `stocks/{ticker}`).
**AC:** bobot dibaca dari config (uji: ubah bobot di config uji → skor berubah); `rank_score` unik 1..11; skor 0–100.
**Bukti:** tabel 11 skor + rank.

## B7 — Sinyal mingguan + streak
**Deliverable:** `compute/signals.py` → `signal_weekly` sesuai `docs/03 §6` (rule_hits JSON, entry/stop/target/lots, `rationale` Bahasa Indonesia, `streak_weeks` dihitung ulang untuk seluruh minggu historis).
**AC:** `test_weekly_rules` & `test_streak` lulus; `week_end` selalu hari Jumat; hanya minggu final dipakai (`timeframe=w1_fri`); `w1_fri` untuk minggu berjalan **tidak** menghasilkan baris.
**Bukti:** output `GET /api/v1/weekly/picks` nyata.

## B8 — Endpoint read (meta, rrg, sectors, stocks, series)
**Deliverable:** semua endpoint §1–§2 `docs/05` + `schemas.py` pydantic + cache in-process 60 detik untuk endpoint berat (`rrg`, `sectors/summary`) keyed by (endpoint, params, as_of).
**AC:** setiap contoh JSON di `docs/05` bisa dihasilkan persis (nama field & tipe); `docs/05` §2 tabel sektor mendukung **semua** filter di §7 dokumen 06 dengan `total/limit/offset` benar; parameter tidak dikenal diabaikan.
**Bukti:** `curl` tiap endpoint → simpan output ke `docs/evidence/` (atau tempel di PROGRESS.md).

## B9 — Briefing & weekly endpoint
**Deliverable:** `GET /api/v1/briefing/morning` + `GET /api/v1/weekly/picks` + `GET /api/v1/rotation/matrix` + `GET /api/v1/heatmap`, termasuk `regime` (`risk_off` bila `sectors_down ≥ 7`, `risk_on` bila `sectors_up ≥ 7`, sisanya `mixed`), `breadth`, `watch[]`.
**AC:** briefing mengembalikan 200 walau `data_status=stale`; `watch[]` berisi pesan saat gate midday gagal; `regime` benar untuk 3 skenario uji (2/9, 7/4, 5/6 sektor).
**Bukti:** JSON briefing nyata + 3 uji regime.

## B10 — Admin runs, backup, retention
**Deliverable:** `GET /api/v1/admin/runs`, `GET /api/v1/admin/export/backup` (streaming), job retention (`intraday_days`), pencatatan setiap job ke `ingest_run` (status `running` → `ok|partial|failed|skipped` + pesan).
**AC:** setiap CLI job meninggalkan satu baris `ingest_run` yang selesai (tidak ada `running` menggantung); backup terunduh dan bisa dibuka (`sqlite3 backup.db "PRAGMA integrity_check"` → `ok`).
**Bukti:** isi tabel `ingest_run` + hasil integrity_check.

## B11 — Test, dokumentasi, kebersihan
**Deliverable:** seluruh test `docs/03 §9` ada dan lulus (`pytest -q`), `backend/README.md` berisi cara install/run/CLI + contoh curl, `docs/DECISIONS.md` & `docs/PROGRESS.md` terupdate.
**AC:** `pytest -q` hijau dari checkout bersih; README cukup untuk menjalankan seluruh alur (import → ingest → compute → serve) tanpa bertanya.
**Bukti:** output pytest.

---

## Aturan tambahan untuk agen backend

1. **Jangan** pernah menulis angka threshold di kode. Semua dari `config/default.yaml`.
2. Semua query SQL pakai parameter binding (`?`). Tidak ada f-string SQL.
3. Waktu: simpan apa adanya dari yfinance (sudah `+07:00`), konversi tanggal bisnis dengan `.tz_convert("Asia/Jakarta")` sebelum `.date()`.
4. Kalau Yahoo gagal: **jangan** hapus/timpa data lama; catat `ingest_run` dan lanjut.
5. Kalau rumus di `docs/03` terasa salah saat implementasi, **jangan** diam-diam mengubahnya: implementasi sesuai dokumen, tulis temuan + usul di `DECISIONS.md`, dan sebutkan di laporan.
6. Setelah setiap task: update `PROGRESS.md` (status + bukti). Task tanpa bukti = belum selesai.
