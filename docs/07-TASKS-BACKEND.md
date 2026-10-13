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

## B12 — Pipeline API: async, progres, prasyarat (dibutuhkan F12)

**Kenapa ada:** user menjalankan seluruh pipeline dari UI (halaman Data, `docs/08` F12), bukan dari CLI. CLI tetap ada untuk Hermes/otomasi, tapi keduanya wajib memakai **fungsi Python yang sama** (`ingest/prices.py`, `compute/*.py`) — API bukan pembungkus CLI via subprocess.

**Deliverable:**
1. Semua endpoint tulis `docs/05 §4.1` menerima `?async=true` → `202 {run_id, status:"queued"}`, dan tanpa flag → sinkron (dipakai CLI/curl).
2. Tabel `ingest_run` dengan kolom progres (`phase`, `rows`, `rows_total`, `percent`, `message`, `params_json`, `result_json`, `triggered_by`) — DDL di `docs/04 §4`.
3. `GET /api/v1/admin/runs/{run_id}` dan `GET /api/v1/admin/runs?limit=20` sesuai `docs/05 §4.3`.
4. Prasyarat ditegakkan **di backend** dengan `409` + `error.code` dari `docs/05 §4.1` (`prereq_no_universe`, `prereq_no_prices`, `gate_weekly_not_final`, `gate_midday_stale`).
5. Selama run panjang, tulis progres tiap batch (bukan tiap baris) — 1 UPDATE per batch sudah cukup, jangan bikin SQLite sibuk.

**AC:**
1. `curl -X POST '.../admin/ingest/prices?async=true' -d '{"mode":"daily","tickers":["BBCA","BBRI"]}'` → `202` + `run_id`; `GET /admin/runs/{id}` menunjukkan `status` berubah `queued → running → ok` dan `rows` bertambah. Bukti: 3 respons poling berturut-turut.
2. Menjalankan `compute` untuk `w1_fri` di hari non-Jumat → `409 gate_weekly_not_final` (bukan 200 dengan data kosong).
3. `POST /admin/compute?async=true` saat `price_daily` kosong → `409 prereq_no_prices`.
4. Tanpa `?async=true`, endpoint yang sama mengembalikan hasil sinkron dengan bentuk respons yang sama seperti CLI (bukti: bandingkan output `python -m backend.cli compute --stage rrg` dengan respons HTTP — angka identik).
5. Tidak ada endpoint yang menggantung setelah selesai: `SELECT COUNT(*) FROM ingest_run WHERE status='running'` = 0 setelah semua run selesai.

**Bukti:** tempel 3 respons poling + 2 respons `409` di `PROGRESS.md`.

## B16 — `as_of` benar-benar dipakai: `/stocks` + cache `/rrg` & `/sectors/summary`

**Kenapa ada:** chip filter kuadran di drawer sektor (`docs/08` F14) mengirim `quadrant[]` ke `/stocks` **dan** membaca `quadrants` dari `/rrg`. Kalau `as_of` dari `AsOfPicker` diabaikan, dua panel itu bercerita tentang tanggal berbeda dan filternya bohong. Ditemukan saat menyiapkan F14 — **bukan** dari pembacaan kode saja.

Bukti awal (13 Okt 2026, server dev :8000):
```
GET /stocks?timeframe=d1&sector=IDXFINANCE&limit=2              → POLA close 90 rs_ratio 115,65 score 89,1 · data_status.as_of 2026-10-13
GET /stocks?...&as_of=2026-09-01                                → POLA close 90 rs_ratio 115,65 score 89,1 · data_status.as_of 2026-09-01   ← baris identik, label tanggal beda
GET /rrg?scope=sector&timeframe=d1                              → as_of 2026-10-13
GET /rrg?scope=sector&timeframe=d1&as_of=2026-09-01             → as_of 2026-10-13 (badan respons identik)                                  ← cache
GET /sectors/summary?timeframe=d1&sector=IDXFINANCE&as_of=2026-09-01 → rs_ratio 101,37 score 46,1 (identik dengan tanpa as_of)              ← cache
```
`LIST_SQL` (`app/api/stocks.py`) memakai `sm.as_of_date = (SELECT MAX(as_of_date) …)` hardcoded, sedangkan `sectors/summary` & `/rrg` memakai `as_of` yang diminta. Cache key `/rrg` dan `/sectors/summary` juga tidak memuat `as_of`, jadi permintaan tanggal lain dilayani badan respons permintaan pertama selama TTL.

**Deliverable:**
1. `/stocks` memakai `as_of` yang diminta (bukan `MAX(as_of_date)`), sehingga `items`, `total`, dan filter `sector`/`quadrant`/`min_turnover_idr` dihitung dari snapshot tanggal itu — konsisten dengan `data_status.as_of` yang sudah dilaporkan.
2. Cache key `/rrg` dan `/sectors/summary` memuat `as_of`.
3. Tanpa `as_of`, perilaku tetap: snapshot terakhir (jangan mengubah default).

**AC:**
1. `/stocks?…&as_of=<tanggal lama yang punya baris>` → `rs_ratio`/`close` berbeda dari permintaan tanpa `as_of`, dan `data_status.as_of` = tanggal itu.
2. `/rrg?…&as_of=<tanggal lama>` → `as_of` di respons = tanggal itu walaupun permintaan tanpa `as_of` dipanggil lebih dulu; sama untuk `sectors/summary` (`rs_ratio`/`score` berubah). Uji lewat HTTP nyata, bukan hanya unit test (bug ini hanya muncul lintas-permintaan).
3. Test regresi: dua panggilan berurutan dengan `as_of` berbeda mengembalikan `as_of` masing-masing.
4. Tidak ada perubahan bentuk respons → `api_version` tetap; kalau ternyata perlu field baru, naikkan versi + ADR + update `docs/05`.
5. `pytest -q` hijau.

**Bukti:** potongan curl before/after untuk 3 endpoint + output pytest.
Catatan: pilih tanggal uji dari `SELECT DISTINCT as_of_date FROM rrg_daily ORDER BY as_of_date DESC LIMIT 5` di DB dev — jangan menandai "terbukti" dari permintaan yang mengembalikan kosong.

## B17 — Analisa teknikal & backtest MA (satu task: hitung, simpan, sajikan)

**Kenapa ada:** fitur baru `docs/01` §3 butir 14 — analisa teknikal sektor & saham berbasis MA + backtest "breakout → berapa periode ke +5%/−5%". Rumus lengkap: **`docs/03` §10** (jangan mengarang rumus di kode). DDL: `docs/04` §4 (tabel `ta_breakout`). Kontrak: **`docs/05` §2 + §4.1/§4.6**. Semua angka ambang hanya dari `config ta.*`. Harga selalu **`adj_close`**.

**Deliverable (satu task, mencakup hitung → simpan → sajikan → tombol):**
1. `backend/app/compute/ta.py`:
   - SMA untuk `config ta.ma_periods` (10/20/50) dari `adj_close`; `NULL` sebelum periode penuh (jangan 0, jangan jendela parsial);
   - deteksi **breakout sebagai transisi** (`docs/03` §10.2) — satu event per transisi;
   - entry D+1 hari bursa: saham `open` (`entry_basis='open'`, fallback `adj_close`), sektor = **nilai indeks D+1** (`entry_basis='index'`; indeks tidak punya `open` — `docs/03` §10.7);
   - hasil: telusuri maju sampai `+target_pct` / `−target_pct` / `timeout_periods` / data habis → `win | loss | expired | open` dengan aturan tepi `docs/03` §10.3 (bar yang menyentuh +5% **dan** −5% → `loss`);
   - dua varian filter tren (`trend_filter` 0/1) sebagai baris terpisah.
2. Migrasi `backend/app/db/migrations/004_ta_breakout.sql` (`IF NOT EXISTS`, idempotent-safe) + `python -m backend.cli db-init`.
3. Simpan hanya `ta_breakout`; **statistik tidak disimpan** — agregasi SQL saat endpoint dipanggil (`docs/04` catatan). Yang dibutuhkan: `n_events, win, loss, expired, open, win_rate, median_periods_win, median_periods_loss, latest, coverage`.
4. `app/api/ta.py` + `response_model` pydantic di `app/api/schemas.py`: `GET /api/v1/ta/summary` dan `GET /api/v1/ta/{scope}/{ref_id}` **persis** bentuk `docs/05` §2 (kunci `items`/`coverage`/`stats.filter_on`/`stats.filter_off`/`latest`/`events`, `price_basis: "adj_close"`).
5. `app/jobs.py`: `stage: "ta"` jalan; `stage=all` **menyertakan** TA; `kind` baru `compute_ta` di `ingest_run` (progres per grup emiten, 1 UPDATE per batch — pola sama seperti ingest); `/api/v1/meta/config` mengekspos blok `ta` (frontend tidak boleh menghardcode MA default/target/timeout).
6. Update komentar `ingest_run.kind` di `docs/04` (daftar 7 nilai).

**AC (satu task, semua harus terbukti):**
1. `test_ma_warmup`: `p=20` pada 25 bar → 19 bar NULL, mulai bar ke-20 terisi.
2. `test_breakout_sekali_per_transisi`: seri di atas MA terus → **1** event.
3. `test_entry_pakai_bar_d_plus_1`: ubah harga D+1 → `entry_price` ikut berubah.
4. `test_win_loss_same_bar` → `loss`; `test_expired_timeout` → `periods` = 60; `test_open_horizon_belum_selesai` → `open` + `periods` NULL.
5. `test_median_bukan_mean`: satu trade 60 periode tidak menggeser median seperti mean.
6. `test_trend_filter_mengurangi_event`: varian `on` ≤ `off`, kedua statistik bisa dibaca berdampingan.
7. Idempotensi: `stage=ta` 2× → jumlah baris `ta_breakout` sama.
8. `POST /admin/compute?async=true {"stage":"ta"}` → `202` + run `kind=compute_ta`; poling `GET /admin/runs/{id}` → `phase`/`rows` naik sampai `ok`; `result_json` sesuai `docs/05` §4.6.
9. `{"stage":"all"}` menghasilkan baris `ta_breakout` (uji lewat HTTP, bukan unit test).
10. `GET /ta/summary?scope=stock&ma_period=20&trend_filter=false` → `items` tidak kosong + `coverage` terisi; `GET /ta/stock/BBRI` memuat `stats.filter_on` & `filter_off`.
11. `ma_period` di luar `ta.ma_periods` → `400`; `price_daily` kosong → `409 prereq_no_prices`; entitas tanpa event → `200` dengan `latest: null`, `events: []`.
12. Entitas dengan riwayat < `ta.min_history` tidak diuji dan dihitung di `coverage.refs_skipped_short_history`.

**Bukti:** `pytest -q` hijau + run nyata dengan config salinan (`ROTATION_CONFIG` ke DB di luar repo, 10–20 emiten — **jangan** backfill penuh) + dump JSON 3 endpoint (1 sektor + 1 saham) ke `docs/evidence/b17/` + 1 respons `400` + 1 respons `409` + potongan `ingest_run` setelah `stage=all` + 1 event yang direplay manual (tempel perhitungannya).
Catatan: blok `ta` baru ditambahkan ke `config/default.yaml` → salinan config uji lama harus digenerate ulang dari config asli, kalau tidak `Settings()` gagal "Field required".
Commit (satu task satu commit): `B17: analisa teknikal & backtest MA (SMA, breakout, /ta/*, stage ta)`.

---

## Aturan tambahan untuk agen backend

1. **Jangan** pernah menulis angka threshold di kode. Semua dari `config/default.yaml`.
2. Semua query SQL pakai parameter binding (`?`). Tidak ada f-string SQL.
3. Waktu: simpan apa adanya dari yfinance (sudah `+07:00`), konversi tanggal bisnis dengan `.tz_convert("Asia/Jakarta")` sebelum `.date()`.
4. Kalau Yahoo gagal: **jangan** hapus/timpa data lama; catat `ingest_run` dan lanjut.
5. Kalau rumus di `docs/03` terasa salah saat implementasi, **jangan** diam-diam mengubahnya: implementasi sesuai dokumen, tulis temuan + usul di `DECISIONS.md`, dan sebutkan di laporan.
6. **Jangan menjalankan backfill skala penuh saat development.** Uji dengan subset kecil (`--tickers BBCA,BBRI,ANTM` atau 10–20 emiten). Backfill 962 emiten (±1,5 menit, ratusan request ke Yahoo) adalah wewenang **user**, dijalankan dari halaman Data saat semuanya sudah jadi. Rankaian uji kecil tetap wajib membuktikan idempotensi (ingest 2× → jumlah baris tidak berubah).
7. **Semua kemampuan pipeline harus bisa dipicu lewat HTTP** (bukan hanya CLI) — itu syarat agar user bisa menjalankannya end-to-end dari UI. Kalau kamu menambah langkah baru (mis. refresh market cap), tambahkan endpoint-nya juga, jangan cuma perintah CLI.
8. Setelah setiap task: update `PROGRESS.md` (status + bukti). Task tanpa bukti = belum selesai.
