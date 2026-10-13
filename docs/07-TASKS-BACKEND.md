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

## B18 — Trading plan berbasis analisa teknikal di `weekly/picks`

**Kenapa ada:** user meminta trading plan mingguan disusun dari **analisa teknikal** (bukan hanya MA) **beserta alasannya**, dan tidak semua alat bisa dikombinasikan — pilihan alat harus **dinamis** mengikuti rezim pasar. Rumus lengkap: **`docs/03` §6.4** (termasuk §6.4.0 gerbang rezim) — jangan mengarang rumus di kode. DDL: `docs/04` §4 migrasi **005**. Kontrak: `docs/05` §3 (`api_version` **1.2**). Pemilihan alat & aturan konflik: skill `idx-ta-trading-plan`.

**Deliverable:**
1. `backend/app/compute/plan.py` (baru):
   - `detect_regime(conn, ticker, week_end, cfg, metrics, sector_quadrant) -> str` — `tren_naik|range|turun|tipis` sesuai §6.4.0 (urutan cek: tipis > turun > range > tren_naik). Input dari `stock_metrics` d1 (sma20, sma50, rsi14, atr14, median_turnover_20d_idr) + `price_daily` (bar volume-0, close, high, low, adj_close) + `rrg_daily` w1_fri sektor saham itu.
   - `plan_levels(bars: pd.DataFrame, metrics: dict, regime: str, ta_stats: dict, cfg) -> dict` — **fungsi murni tanpa DB** (mudah diuji): pivot S/R + kanal (`plan.pivot_bars`, `plan.channel_tol_pct`), Donchian 20/40, swing low 10, zona entry, stop (`struktur_swing_low|volatilitas_atr|lantai_atr`), TP1/TP2, `rr_tp1`/`rr_tp2` **bersih biaya**, `hit_tp1`/`hit_tp2` dari `ta_stats` (MFE), `invalidation`, `plan_ok`, `notes[]`, dan `reason` per elemen (≤ 140 char, Bahasa Indonesia, tanpa istilah mentah).
   - `build_plans(conn, week_end, picks, cfg) -> dict[ticker, dict]` — orkestrasi + bila perlu fallback: kalau `atr14` null → seluruh plan `null` (jangan mengarang level).
2. `compute/ta.py` diperluas: isi `mfe_pct`/`mae_pct` per event (docs/03 §10.9) supaya `hit_tp1`/`hit_tp2` bisa dihitung tanpa menghitung ulang semua event.
3. Migrasi `backend/app/db/migrations/005_ta_plan.sql` (kolom di `docs/04` §4; `ADD COLUMN` dibungkus cek `PRAGMA table_info` supaya idempotent-safe) + `python -m backend.cli db-init`.
4. `compute/signals.py`: panggil `build_plans` per pick saham; isi semua kolom baru; `target = tp2` (kompatibilitas); `entry_ref` tetap = close Jumat; assert **maksimum satu** `confirm_tool` (rancangan dengan dua konfirmasi ditolak).
5. `app/api/` + `app/api/schemas.py`: `/weekly/picks` mengirim objek `plan` persis bentuk `docs/05` §3, `api_version` naik ke **1.2**; `PlanResponse` pydantic (bukan `-> dict`) supaya kunci terkunci.

**AC:**
1. Semua test `docs/03` §6.4.8 no. 1–9 **dan** §6.4.8 no. 10–14 (rezim: gate range menolak breakout; tipis menang & tanpa konfirmasi volume; turun → `no_trade`; konfirmasi maks satu; konflik seri → `no_trade`) + §10.9 `test_mfe_mae_dari_seri_naik_turun`.
2. `atr14` null → plan `null` tanpa exception (`test_atr_null_plan_null`).
3. Setiap `reason` ≤ 140 char dan tidak memuat istilah mentah (`SMA20`, `ATR`, `R:R`, `RSI`, `breakout`, `Donchian`) — assert lewat helper pemotong yang sudah ada.
4. `rr_tp1`/`rr_tp2` **bersih biaya**: menaikkan `fee_buy_bps`/`fee_sell_bps` menurunkan `rr_*` (test), dan bisa membuat `plan_ok=false` dengan `notes` yang menyebut angkanya.
5. `hit_tp1`/`hit_tp2` = `share(mfe_pct ≥ pct target)`; `n_events < plan.min_events_hold` → `null` (bukan 0).
6. Recompute idempoten: `stage=signals` 2× → nilai kolom plan sama (kecuali `computed_at`).
7. HTTP: `GET /api/v1/weekly/picks` → `api_version` `1.2`, tiap pick saham punya `plan` dengan kunci lengkap; pick lama (baris `signal_weekly` sebelum migrasi) → `plan: null` dan endpoint tetap 200.
8. `week_end` minggu berjalan → `409 gate_weekly_not_final` tidak berubah.

**Bukti:** `pytest -q backend` hijau + run nyata `stage=signals` dengan config salinan (`ROTATION_CONFIG` ke DB di luar repo, 10–20 emiten — **jangan** backfill penuh) + dump JSON satu pick per rezim (tren_naik & range minimal, kalau tidak ada → buat fixture sintetis dan sebut itu) ke `docs/evidence/b18/` + agregat SQL `hit_tp1`/`hit_tp2` nyata + potongan respons `weekly/picks`.
Catatan: blok `weekly.plan` baru di config → salinan config uji lama harus digenerate ulang. Commit: `B18: trading plan TA (rezim dinamis, stop struktur, RR bersih biaya)`.

## B19 — `GET /api/v1/series/stock/{ticker}`: bahan grafik candle + overlay TA

**Kenapa ada:** user ingin melihat **candlestick beserta TA** di halaman detail saham, dengan overlay yang **sesuai aturan & rezim** kita (docs/03 §6.4.0, §6.4.9) — bukan indikator sembarangan. Data sudah ada (`price_daily` 2 tahun OHLC penyesuaian + `ta_breakout`), yang kurang hanya endpoint yang menyajikannya. Kontrak: `docs/05` §2. Tampilan: `docs/06` §6.5.

**Deliverable:**
1. `app/api/series.py` (atau modul yang sudah memuat `/series/sector`): tambah `GET /api/v1/series/stock/{ticker}` persis bentuk `docs/05` §2 — `candles`, `overlays.ma`/`donchian`/`channels`/`volume_ma`, `levels`, `events`, `regime`, `active_tools`, `regime_reason`, `volume_confirm_mult`, `data_status`; `response_model` pydantic di `schemas.py`.
2. Pakai ulang mesin yang sudah ada, **jangan menyalin**: `compute/plan.py` untuk `detect_regime`, pivot/kanal (§6.4.9) dan level plan terakhir; `compute/ta.py` untuk statistik event; `repo/read.py` untuk `data_status`/window.
3. `candles` memakai harga penyesuaian (ADR-040): `open/high/low` diskalakan `adj_close/close` per bar; `bars` maks 400 (400 → `422`).
4. Ticker tidak ada di `stock` → `404 not_found`; ticker ada tapi belum punya bar → `200` dengan `candles: []`.
5. Tidak menambah kolom/tabel baru (semua dihitung saat request) dan **tidak** mengirim VWAP/SMC/Elliott.

**AC:**
1. `GET /series/stock/BBRI` → `api_version` `1.0`, `price_basis: "adj_close"`, `candles` urut lama→baru dan jumlahnya = `min(bars, bar tersedia dalam window)`.
2. `overlays.ma["20"]` tidak memuat `null` (warmup dibuang) dan nilainya sama dengan `stock_metrics.sma20` untuk tanggal yang sama (uji silang 3 tanggal, tempel angkanya).
3. `overlays.donchian.fast.high` untuk bar terakhir = `max(high)` 20 bar terakhir — diverifikasi ulang dengan SQL manual (tempel query + hasilnya).
4. `channels` hanya memuat kanal `strength ≥ chart.channel_min_strength`; `test_pivot_butuh_bar_kiri_kanan` & `test_kanal_kelompokkan_pivot_berdekatan` lulus.
5. `levels` = plan pick terakhir ticker itu (`week_end`, zona, stop, tp1, tp2, `rr_tp2`, `plan_ok`); `null` bila belum ada pick — endpoint tetap 200.
6. `events` = baris `ta_breakout` MA20 (trend_filter sesuai config) + `mfe_pct`/`mae_pct`; jumlah ≤ `events`.
7. `regime`/`active_tools`/`regime_reason` konsisten dengan `plan` di `/weekly/picks` untuk ticker & pekan yang sama (uji silang, bukan dua mesin berbeda).
8. `bars=500` → `422`; `BBRI` tanpa bar di DB uji → `200` + `candles: []`; ticker `ZZZZ` → `404`.
9. `pytest -q backend` hijau + tidak ada regresi pada `/series/sector/{code}`.

**Bukti:** dump JSON endpoint untuk 2 ticker (1 rezim `tren_naik`, 1 rezim `range` bila ada; kalau tidak ada, sebut dan tunjukkan `regime` yang benar-benar keluar) ke `docs/evidence/b19/` + uji silang MA20/Donchian vs SQL manual + respons `404` & `422` + `pytest -q`.
Commit: `B19: endpoint series/stock (candle + overlay TA sesuai rezim)`.

## B20 — Analisa teknikal untuk **semua emiten** (`stock_plan`) + `GET /plan/stock/{ticker}`

**Kenapa ada:** user ingin membuka **detail saham apa pun** dan langsung melihat semua yang sudah terbaca: rezim, plan (zona/batas rugi/target/R:R), **skenario peluang historis**, ringkasan, dan alasan. `§6.4` (B18) hanya menghitung plan untuk pick mingguan; sekarang mesin yang sama dijalankan untuk **semua emiten aktif** dan disimpan di `stock_plan`. Rumus: `docs/03` **§6.5** (+§6.4, §10.9). DDL: `docs/04` §4 (migrasi **006**). Kontrak: `docs/05` §2 `/plan/stock/{ticker}`.

**Deliverable:**
1. `compute/plan.py` diperluas (jangan bikin modul kedua):
   - `first_touch(bars, entry_date, up_pct, down_pct, horizon)` → `up|down|timeout|open` + jumlah bar (docs/03 §10.9);
   - `scenario(events, bars, levels, cfg)` → `p_tp1_first`, `p_sl_first`, `p_timeout`, `p_tp2_first`, `median_periods_tp1`, `median_periods_sl`, `n_events`, `n_open_dikeluarkan` (docs/03 §6.5.2); `n_events < weekly.plan.min_events_scenario` → seluruhnya `None`;
   - `summary_lines(...)` → 1–3 kalimat (docs/03 §6.5.1), tiap kalimat ≤ 140 char, tanpa istilah mentah;
   - `plan_for_all(conn, cfg, report=None)` → loop **semua** `stock.is_active = 1`, pakai `detect_regime` + `plan_levels` yang sudah ada, `upsert` ke `stock_plan` per `as_of_date`, progres tiap 50 emiten (`report(rows=…, rows_total=jumlah_emiten, message="emiten 250/962")`).
2. Migrasi `006_stock_plan.sql` (DDL `docs/04`) + retensi `retention.plan_days` di housekeeping (pola sama seperti `midday_rrg_days`).
3. `jobs.py`: `stage=ta` menjalankan (a) statistik MA/breakout `ta_breakout`, lalu (b) `plan_for_all` — satu tombol, `kind` tetap `compute_ta`; `stage=all` ikut. `result_json` tambah `plan_rows`, `plan_refs`, `plan_skipped_short_history`, `scenario_null_refs`.
4. `app/api/plan.py` + `schemas.py`: `GET /api/v1/plan/stock/{ticker}` persis `docs/05` §2 (`regime`, `summary_lines`, `plan`, `scenario`, `levels_table`, `coverage`, `data_status`), `response_model` pydantic. `/series/stock/{ticker}` (B19) **membaca baris `stock_plan` yang sama** — jangan menghitung ulang rezim/level di dua tempat.
5. `compute/signals.py`: tetap memakai `plan.py` untuk pick mingguan; tambahkan assert bahwa untuk ticker+pekan yang sama, level & rezim `signal_weekly` = `stock_plan` pada `as_of_date` yang sama (test no. 6 di docs/03 §6.5.4).

**AC:**
1. Semua test `docs/03` §6.5.4 (6 test) + `test_first_touch_urutan` (§10.9) lulus.
2. `stage=ta` pada fixture 5 emiten → 5 baris `stock_plan` untuk `as_of_date` terakhir; emiten riwayat pendek → `regime = tidak_cukup_data`, level `null`.
3. Skenario memakai **first touch**, bukan MFE: seri yang menyentuh +TP1 di bar 3 lalu −stop di bar 5 → `p_tp1_first = 1.0` (test khusus, karena MFE akan menyesatkan).
4. `n_events < min_events_scenario` → `scenario` `null` dan `summary_lines` memuat "belum cukup riwayat".
5. Idempoten: `stage=ta` 2× → jumlah baris `stock_plan` untuk `as_of_date` sama (upsert).
6. Konsistensi satu mesin: untuk 3 ticker yang juga pick mingguan, `stock_plan.stop/tp1/tp2/regime` = nilai di `signal_weekly` (uji silang, tempel angkanya).
7. HTTP: `GET /plan/stock/BBRI` → kunci lengkap sesuai `docs/05` §2; `summary_lines` 1–3 kalimat; `levels_table` berurutan tetap.
8. `GET /plan/stock/ZZZZ` → `404`; ticker dengan < `ta.min_history` bar → **200** + `regime.code = tidak_cukup_data` + `plan: null`.
9. `GET /series/stock/BBRI` (B19) memuat `regime`/`levels` yang **identik** dengan `/plan/stock/BBRI` (satu sumber).
10. Retensi: baris `stock_plan` lebih tua dari `retention.plan_days` terhapus saat housekeeping (uji dengan data sintetis).
11. Perf dicatat apa adanya: durasi `plan_for_all` untuk jumlah emiten yang diuji, dan ekstrapolasi kasar untuk 962 (jangan diklaim, ukur lalu tulis).

**Bukti:** `pytest -q backend` hijau + run `stage=ta` nyata dengan config salinan (10–20 emiten) + dump JSON `/plan/stock/{ticker}` untuk **3 rezim berbeda** (`tren_naik`, `range`, `tidak_cukup_data`) ke `docs/evidence/b20/` + uji silang `stock_plan` vs `signal_weekly` + angka `scenario` yang direplay manual (1 ticker: hitung first touch dengan SQL/Python dan tunjukkan hasilnya sama) + durasi run.
Commit: `B20: stock_plan untuk semua emiten + endpoint plan/stock`.

## B21 — Lapisan `indicators` di `series/stock`: Ultimate RSI + VWAP/σ + POC

**Kenapa ada:** user meminta indikator tambahan yang sudah dipelajari (Ultimate RSI, VWAP deviation, volume profile/POC) tampil di grafik detail saham. Semuanya **bisa** dihitung dari data yang ada; batasnya jujur: POC dari bar harian hanya **perkiraan** (volume intra-bar tidak diketahui) dan presisi butuh bar 5m (retensi 30 hari; DB dev baru 2 hari). Rumus: **`docs/03` §11.1–§11.3 + §11.6**. Kontrak: `docs/05` §2 (`layers`, `indicators`). Tampilan: `docs/06` §6.6.

**Deliverable:**
1. `compute/indicators.py` (baru, **fungsi murni** + satu orkestrator):
   - `ursi(bars, len, method, signal_len)` — rumus `docs/03` §11.1; `method ∈ rma|ema|sma|tma`; **wajib** komentar di kode: `method=rma` ≡ RSI klasik (Wilder) — "penekanan tren" berasal dari smoothing, bukan rumus berbeda.
   - `vwap(bars, len, band, anchor)` — `rolling|pivot_low|quarter`; volume 0 dilewati dari penyebut; mengembalikan `points` + `anchor_date`.
   - `volume_profile(bars, bins, bars_window, value_area, basis)` — POC + value area; `basis: "daily"` (default) atau `"intraday"` (baca `price_intraday` 5m; kalau bar intraday tidak ada → fallback `daily` **dan** laporkan `basis` yang benar-benar dipakai).
2. `app/api/series.py`: `GET /series/stock/{ticker}` menerima `layers` (default `indicators`) dan mengirim blok `indicators` persis `docs/05` §2; tanpa `indicators` → kunci itu tidak dikirim (`None`, bukan objek kosong).
3. Semua nilai dari harga penyesuaian; `points` kosong → array kosong (bukan `null` per titik).
4. **Tidak** menyentuh `plan.py`/`stock_plan`: lapisan tidak boleh mengubah level/rezim (test no. 9 `docs/03` §11.6).

**AC:**
1. `test_ursi_rma_sama_dengan_rsi14`: `ursi(method="rma")` = `stock_metrics.rsi14` pada 3 tanggal (toleransi 1e-6) — membuktikan rumus benar, bukan tafsiran.
2. `test_ursi_metode_sma_lebih_halus`: stdev selisih antar-bar `sma` < `rma`.
3. `test_vwap_volume_nol_dilewati` + `test_vwap_anchor_pivot_low` (anchor = tanggal pivot low terakhir, `anchor_date` ikut).
4. `test_poc_dari_bar_harian_dilabeli_perkiraan`: `basis="daily"`, `bars_used` = jumlah bar yang benar-benar dipakai, POC = bucket dengan Σvolume terbesar (diverifikasi manual dengan pandas, tempel angkanya).
5. `layers` tidak dikenal → `400 invalid_layer`; `layers=` (kosong) → blok `indicators` tidak dikirim.
6. `test_lapisan_tidak_mengubah_plan`: `stock_plan`/`signal_weekly` identik dengan/tanpa lapisan.
7. Perf: satu ticker 400 bar → endpoint < 200 ms di mesin dev (ukur dan tempel angkanya).

**Bukti:** dump JSON `series/stock/BBRI?layers=indicators` (dan satu ticker `range`) ke `docs/evidence/b21/` + perhitungan manual POC/VWAP (tempel) + `pytest -q backend` + angka durasi.
Commit: `B21: lapisan indicators di series/stock (Ultimate RSI, VWAP, POC)`.

## B22 — Lapisan konteks `smc` & `elliott` di `series/stock`

**Kenapa ada:** user ingin melihat struktur SMC (BOS/CHoCH, order block, FVG, equal high/low, premium/discount) dan kandidat Elliott di grafik. Keduanya bisa dihitung dari OHLC + pivot — **tanpa data baru** — tapi keduanya **lapisan konteks**: tidak boleh dipakai entry/stop/target (`docs/03` §11.4–§11.5, skill `idx-ta-trading-plan`: maksimum satu alat utama + satu konfirmasi). Default **mati**; hanya dikirim bila diminta (`layers=…,smc,elliott`). Tampilan: `docs/06` §6.7.

**Deliverable:**
1. `compute/structure.py` (baru, fungsi murni):
   - pivot swing (pakai `plan.pivot_bars`, level penyesuaian — **pakai ulang** helper pivot di `compute/plan.py`, jangan tulis kedua),
   - `smc_layers(bars, cfg)` → `bos`, `choch`, `order_blocks`, `fvg`, `equal_levels`, `range` (premium/discount) sesuai definisi `docs/03` §11.4 — **BOS/CHoCH butuh `close` menembus level**, bukan hanya `high` (test khusus),
   - `elliott_layers(bars, cfg)` → `zigzag`, `waves` (aturan: wave2 tidak melewati awal wave1, wave4 tidak tumpang tindih wave1, wave3 bukan terpendek), `fib_zones`, `status`, `invalidated`, `note` ("kandidat, bisa berubah").
2. `app/api/series.py`: kirim `smc`/`elliott` hanya bila diminta; `elliott.status` ∈ `candidate|invalidated`; pola batal tetap dikirim dengan `invalidated=true`.
3. Tidak menambah tabel/kolom; semua dihitung saat request (ticker tunggal, ≤ 400 bar).

**AC:**
1. `test_smc_fvg_bullish` & `test_smc_fvg_bearish`: fixture 3 bar → satu FVG dengan level = batas celah.
2. `test_smc_bos_butuh_close`: `high` menembus swing high tetapi `close` tidak → **bukan** BOS.
3. `test_smc_order_block_candle_terakhir_sebelum_impuls`: OB bullish = candle turun terakhir sebelum impuls yang memecah struktur; `mitigated` benar setelah harga kembali menyentuhnya.
4. `test_smc_equal_levels_toleransi`: dua pivot dalam `chart.smc.eq_tol_pct` → satu baris `equal_levels` dengan `count: 2`.
5. `test_elliott_invalidated_ditandai`: pola yang dilanggar bar baru → `invalidated=true` **tetap dikirim** + `note` memuat "kandidat".
6. `test_elliott_min_move`: pivot dengan jarak < `chart.elliott.min_move` tidak membentuk ZigZag baru.
7. `test_lapisan_tidak_mengubah_plan` (sama seperti B21 no. 6) + `layers` tanpa `smc`/`elliott` → kunci tidak dikirim.
8. Perf: ticker 400 bar, semua lapisan aktif → endpoint < 300 ms (ukur, tempel).

**Bukti:** dump JSON 2 ticker (1 `range`, 1 `tren_naik`) dengan semua lapisan ke `docs/evidence/b22/` + verifikasi manual satu FVG & satu BOS (tempel bar-nya) + `pytest -q backend`.
Commit: `B22: lapisan konteks smc & elliott di series/stock`.

## B23 — Backend test lebih cepat: marker `slow` + template DB sesi — **SELESAI (dikerjakan Hermes, 13 Okt 2026)**

> **Jangan dikerjakan ulang.** Angka nyata: `pytest -q backend` **82,8 s → 77,5 s** serial, dan **32,9 s** dengan
> `-n auto` (8 core, `pytest-xdist`, ADR-046); jalur cepat `-m 'not slow' backend -n auto` **28,2 s**
> (193 passed, 3 deselected). Yang berubah: fixture `template_db` sesi + `tmp_config` menyalin DB (bukan
> `init_db` per test), marker `slow` di 3 test terberat, `pytest-xdist` masuk dev extra.
> Temuan jujur: sisa biaya bukan setup DB tapi **komputasi per test** — karena itu jalur tercepat tetap
> "satu berkas uji", bukan suite penuh.

**Kenapa ada:** `pytest -q backend` ±70 s karena tiap berkas uji membangun DB sendiri (init + import fixture) dan modul berat (pandas/yfinance) diimpor ulang per berkas. Datanya kecil — yang mahal setup berulang.

**Deliverable:**
1. Marker pytest: `slow` untuk uji yang menjalankan pipeline penuh (`stage=all`, ingest multi-batch, run nyata kecil) dan `integration` bila perlu; didaftarkan di `pyproject.toml`/`pytest.ini` (`markers = [...]`) supaya tidak ada warning.
2. Fixture **session-scoped** `template_db` (di `backend/tests/conftest.py`): bangun sekali DB berisi skema + fixture universe, lalu tiap test menyalinnya (`shutil.copy` / `VACUUM INTO`) alih-alih `init_db` + `import_excel` ulang.
3. `pytest -q -m "not slow"` = jalur cepat untuk loop per task; `pytest -q` tetap menjalankan semuanya (gerbang penutup).
4. `docs/07` "Aturan tambahan": tulis urutan verifikasi baru (loop: `pytest backend/tests/<file> -q`; penutup: `pytest -q backend`).

**AC:**
1. Ukur dan tempel **sebelum/sesudah**: `python -m pytest -q backend` dan `python -m pytest -q -m "not slow" backend` (angka nyata) — target: jalur cepat ≤ 50% dari durasi sekarang.
2. Jumlah test di `pytest -q` **tidak berkurang** (tempel ringkasan `N passed`); `-m "not slow"` hanya mengecualikan yang ditandai.
3. Tidak ada test yang dilonggarkan asersinya atau dihapus; test yang tadinya hijau tetap hijau.
4. Fixture `template_db` dipakai ≥ 80% berkas uji (grep `tmp_db` yang tersisa + sebutkan alasannya kalau ada yang belum).
5. `pytest -q backend` 2× berturut-turut hijau (tidak ada ketergantungan urutan/cache).

**Bukti:** 4 angka durasi + ringkasan `N passed` sebelum/sesudah + daftar test ber-marker `slow`.
Commit: `B23: test backend lebih cepat (marker slow + template DB sesi)`.

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
