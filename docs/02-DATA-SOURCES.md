# 02 — Data Sources & Data Contract

Semua yang ada di §1 adalah **hasil uji nyata** (yfinance 1.7.0, dijalankan 2026-10-12 terhadap pasar IDX), bukan asumsi. Kalau kamu mengubah cara ambil data, ulangi uji ini dan catat hasilnya di `docs/DECISIONS.md`.

## 1. Hasil uji yfinance terhadap `.JK` (bukti mentah)

| Yang diuji | Hasil |
|---|---|
| `yf.Ticker("BBCA.JK").history(period="5d", interval="1d")` | ✅ kolom `Open/High/Low/Close/Volume`, indeks `Date` bertz `+07:00`, bar terakhir `2026-10-12 close=5950 vol=97.965.100` |
| `history(period="1d", interval="5m")` | ✅ bar 5 menit hari berjalan sampai **16:10 WIB** (termasuk sesi post-trading 16:00–16:15) |
| `history(period="5d", interval="60m")` | ✅ bar 11:00, 13:00, 14:00, 15:00, 16:00 WIB → **data setelah sesi 1 tersedia** |
| `Ticker.info` | ✅ `sector` = `"Financial Services"`, `industry` = `"Banks - Regional"`, `marketCap` = 730.908.407.627.776, `currency` = `IDR`, `exchange` = `JKT` |
| `yf.Ticker("^JKSE")` (IHSG) | ✅ bar harian lengkap (`2026-10-12 close=5936.146973`) |
| `yf.download(["BBCA.JK","ANTM.JK","TLKM.JK"], ...)` | ✅ batch multi-ticker jalan (1 request untuk banyak emiten) |
| `resample("W-FRI")` dari bar harian | ✅ minggu lengkap benar (label tanggal Jumat) |
| `history(interval="1wk")` | ⚠️ bar minggu berjalan punya `Close = NaN` → **jangan dipakai** |
| `IDXENERGY.JK`, `IDXFINANCE.JK` | ❌ hanya **1 baris** untuk `period="5d"` → riwayat tidak bisa dipakai |
| `^IDXENERGY`, `JKSE.JK` | ❌ 404 / kosong |

**Konsekuensi wajib:**
1. Indeks sektor **dihitung sendiri** dari konstituen (§3), bukan diunduh.
2. Agregasi mingguan pakai `resample("W-FRI")` di atas bar harian.
3. Universe saham berasal dari **Excel user**, bukan dari Yahoo.

## 2. Yang bisa & tidak bisa didapat dari yfinance

| Kebutuhan | Tersedia? | Sumber / cara |
|---|---|---|
| OHLCV harian per saham | ✅ | `.history(interval="1d")`, simpan `adj_close` juga (`auto_adjust=False`) |
| OHLCV intraday 1m/5m/15m/60m | ✅ | `.history(interval=...)`; Yahoo membatasi riwayat intraday (≈60 hari untuk 5m) → simpan ke SQLite tiap hari, jangan andalkan refetch lama |
| Harga & volume IHSG | ✅ | `^JKSE` |
| Nama emiten, market cap, sektor (klasifikasi Yahoo) | ✅ | `.info` (1 request per emiten, lambat → cache di tabel `stock`) |
| Klasifikasi sektor IDX-IC resmi (11 sektor) | ❌ | pakai Excel user → tabel `sector` |
| Peta saham → sektor | ❌ (Yahoo pakai GICS-mirip, beda dari IDX-IC) | Excel user |
| Turnover (nilai transaksi Rp) | ⚙️ turunan | `close × volume` |
| Papan pencatatan (Utama/Pengembangan/Ekonomi Baru), papan pemantauan khusus | ❌ | kolom opsional dari Excel user |
| Foreign flow, broker summary, bid/offer depth, short interest | ❌ | tidak ada gratis (di luar v1) |
| Data fundamental (PER/PBV/EPS/DER) | ❌ (tidak handal untuk `.JK`) | di luar v1 |
| Aksi korporasi (dividen/split) | ⚙️ sebagian | penyesuaian dari Yahoo (`Adj Close`, `auto_adjust=True`); detail resmi dari IDX, di luar v1 |
| Kalender hari libur bursa | ⚙️ turunan | hari tanpa bar = hari libur (dipakai untuk kalender minggu) |

## 3. Indeks sektor (dihitung sendiri)

Untuk setiap sektor, dari konstituen aktif di sektor itu:

**a. Equal-weight (default, `weighting: equal`)**

```
r_i,t   = adj_close_i,t / adj_close_i,t-1 - 1        (hanya saham yang punya kedua bar)
r_sec,t = mean(r_i,t)                                 (rata-rata tertimbang sama)
IDX_sec,t = IDX_sec,t-1 × (1 + r_sec,t)               (base 100 di tanggal awal seri)
turnover_sec,t = Σ (close_i,t × volume_i,t)
advancers/decliners/unchanged = hitung dari r_i,t
constituents_count = jumlah saham yang masuk perhitungan hari itu
```

**b. Turnover-weight (`weighting: turnover`)**

```
w_i,t-1 = turnover_i,t-1 / Σ turnover_j,t-1    (median 20 hari untuk meredam spike; 0 bila total = 0)
r_sec,t = Σ w_i,t-1 × r_i,t
```

**c. Cap-weight (`weighting: captier`)**

```
w_i,t-1 = (shares_outstanding_i × close_i,t-1) / Σ (shares_outstanding_j × close_j,t-1)
r_sec,t = Σ w_i,t-1 × r_i,t
```
`shares_outstanding` datang dari kolom **"Saham"** di `saham_sektoral.xlsx` → **tidak perlu** panggilan `.info` per emiten. Kalkulasi ini murah dan bisa diimplementasi bersama equal/turnover di B4. Pakai untuk cross-check: bila arah cap-weight berbeda jauh dari equal-weight, artinya rotasi didorong segelintir saham besar (catat di `rationale` bila relevan).

**Aturan kebersihan seri:**
- Base index = 100 pada hari pertama seri (bukan pada hari listing semua saham) → RRG tidak terpengaruh level absolut.
- Saham dengan `volume = 0` **dua hari berturut-turut** dianggap suspend → dikeluarkan dari perhitungan sampai ada transaksi (jangan dianggap harga 0).
- Saham baru masuk sektor → ikut mulai hari pertama ada bar (index tetap kontinu karena berbasis return rata-rata).
- `data quality`: bila < 3 konstituen bertransaksi di suatu hari, tandai baris itu `constituents_count` apa adanya dan **jangan** tampilkan sebagai sinyal valid (flag di API: `partial = true`).

## 4. Timeframe & kalender

| Kode | Arti | Aturan |
|---|---|---|
| `d1` | Harian | Bar harian sesi penuh (09:00–15:50 WIB + closing auction). |
| `w1` | Mingguan berjalan | `resample("W-FRI")` dari harian, **minggu berjalan ikut tampil tapi ditandai `in_progress = true`**. |
| `w1_fri` | Mingguan Senin–Jumat (final) | Hanya minggu yang **sudah ditutup Jumat** (bar minggu berjalan dibuang). Baru terisi setelah penutupan Jumat. Ini yang dipakai untuk rencana minggu depan. |
| `midday` | Tengah hari | Perhitungan ulang intraday setelah sesi 1 (§5). |

Jendela (window) untuk panjang ekor RRG & tabel: `1w, 1m, 3m, 6m, 1y, ytd` — **default `3m`**. Jendela hanya memengaruhi **panjang ekor & kolom return**; parameter RRG (`ema_span`, `roc_lag`) dibaca dari config dan **tidak** ikut berubah saat window berganti (kalau ikut berubah, kuadran akan bergeser tanpa alasan yang terlihat user).

## 5. Gate kesegaran data (fitur "setelah sesi 1")

Masalah: yfinance delay. Jangan pernah menghitung `midday` dari data basi.

Aturan wajib sebelum menjalankan perhitungan `midday`:

```
1. Ambil bar 5m untuk watchlist likuid: config.freshness_probe_tickers
   (default: BBCA.JK, BBRI.JK, BMRI.JK, TLKM.JK, ASII.JK)
2. last_bar = timestamp bar terakhir yang punya volume > 0 pada hari ini
3. GATE lolos bila last_bar >= config.midday_gate_min_bar_time (default 11:30 WIB)
   dan last_bar berasal dari tanggal WIB hari ini
4. Lolos  → jalankan ingest penuh + hitung ulang |simpan ke data_freshness(status="ok")
   Gagal  → JANGAN hitung ulang; simpan status="stale" + last_bar + tunda (job diulang tiap 10 menit
            sampai config.midday_gate_deadline (default 13:00 WIB), lalu dibatalkan & dicatat di ingest_run)
```

Endpoint tetap melayani hasil terakhir yang ada dan **wajib** menyertakan `data_status` (`ok` | `stale` | `partial`) + `last_data_at`. UI menampilkan pill merah "data stale" kalau begitu. Angka delay Yahoo yang sebenarnya **belum terukur** (di luar jam bursa) → tugas pertama saat implementasi: ukur selisih `last_bar` vs jam berjalan selama 3 hari bursa, catat di `DECISIONS.md`, lalu setel `midday_gate_min_bar_time`.

Filter bar intraday (jangan pakai semua bar mentah):
- Simpan & pakai hanya bar dalam **jam bursa reguler**: `09:00 ≤ t < 12:00` atau `13:30 ≤ t < 16:00` WIB.
- Bar `16:00–16:15` (post-trading) **dibuang** dari perhitungan (terbukti ada di feed: bar 16:05 & 16:10 pada BBCA). Kalau tetap disimpan untuk audit, tandai `session = "post"` dan kecualikan dari agregasi.

## 6. Excel input dari user — `saham_sektoral.xlsx` (SUDAH ADA, sudah diperiksa)

Lokasi: **root repo** (`E:\stocks-sector-rotation\saham_sektoral.xlsx`). Satu sheet per sektor, nama sheet = kode sektor IDX-IC. Baris pertama = header.

**Isi nyata (diperiksa 2026-10-12):** 11 sheet, **962 emiten unik**, 0 kode tidak valid (semua cocok `[A-Z0-9]{4}`), 0 duplikat lintas sheet.

| Sheet | Jumlah saham | | Sheet | Jumlah saham |
|---|---|---|---|---|
| IDXCYCLIC | 162 | | IDXENERGY | 90 |
| IDXNONCYC | 133 | | IDXINFRA | 70 |
| IDXBASIC | 114 | | IDXINDUST | 66 |
| IDXFINANCE | 106 | | IDXTECHNO | 47 |
| IDXPROPERT | 93 | | IDXHEALTH | 41 |
| | | | IDXTRANS | 40 |

Kolom nyata dan pemetaannya ke tabel `stock` (dibaca per posisi **dan** dicocokkan nama header, case-insensitive):

| Kolom Excel | Wajib | Contoh | Kolom DB | Catatan |
|---|---|---|---|---|
| `No` | ➖ | `1` | — | diabaikan |
| `Kode` | ✅ | `BBCA` | `ticker` | uppercase, harus `[A-Z0-9]{4}` |
| `Nama Perusahaan` | ➖ | `Bank Central Asia Tbk.` | `name` | fallback ke `.info` bila kosong |
| `Tanggal Pencatatan` | ➖ | `06 Jul 2021` | `listing_date` | format `DD Mmm YYYY`, bulan **Indonesia** |
| `Saham` | ➖ | `8603416176` | `shares_outstanding` | jumlah lembar → dipakai untuk bobot market cap |
| `Papan Pencatatan` | ➖ | `Utama` | `board` | lihat di bawah |

Bulan Indonesia yang harus dikenali: `Jan, Feb, Mar, Apr, Mei, Jun, Jul, Agt, Sep, Okt, Nov, Des` (perhatikan **Agt** = Agustus, **Okt**/**Des**). Kalau parse gagal → `listing_date = NULL`, **bukan** baris error.

Nilai `Papan Pencatatan` yang ada di file (dipakai sebagai filter & jawaban atas tweet soal risiko):

| Papan | Jumlah | Arti untuk aplikasi |
|---|---|---|
| `Utama` | 293 | paling likuid |
| `Pengembangan` | 556 | mayoritas universe |
| `Pemantauan Khusus` | 69 | **berisiko**: tandai di UI (badge "PK"), default filter mematikan bila `universe.exclude_pemantauan_khusus: true` |
| `Akselerasi` | 43 | campuran |
| `Ekonomi Baru` | 1 | — |

Aturan parsing (implementasi `POST /api/v1/admin/import/excel`):
- Ticker dinormalisasi: uppercase, buang spasi/titik, buang suffix `.JK` bila ada, **hanya `[A-Z0-9]{4}`**. Wajib 4 karakter → kalau tidak, baris masuk `excel_import_error` (`invalid_ticker`), jangan diam-diam dilewatkan.
- Sheet dengan nama di luar 11 kode di atas → dicatat di error report (`unknown_sheet`), tidak menggagalkan seluruh import (`?strict=true` untuk membuatnya gagal).
- Dua sheet berisi ticker yang sama → baris kedua masuk error report (`duplicate_ticker`), yang pertama menang. (Di file saat ini tidak ada duplikat, tapi aturan tetap ada.)
- Import **idempotent**: file sama (sha256 sama) → ditolak `409 already_imported` kecuali `?force=true`.
- Response: `inserted`, `updated`, `deactivated`, `errors[]` per sheet. Saham yang hilang dari Excel versi baru → `is_active = 0` (**jangan dihapus**; riwayat harga harus tetap ada).
- `shares_outstanding` ikut di-`UPDATE` setiap import (jumlah saham bisa berubah karena aksi korporasi) — dipakai untuk bobot market cap, jadi jangan di-skip.

Daftar 11 sektor IDX-IC (kode indeks, dipakai sebagai kode sektor):

| Kode | Nama Indonesia | Nama Inggris |
|---|---|---|
| `IDXENERGY` | Energi | Energy |
| `IDXBASIC` | Barang Baku | Basic Materials |
| `IDXINDUST` | Perindustrian | Industrials |
| `IDXNONCYC` | Barang Konsumen Primer | Consumer Non-Cyclicals |
| `IDXCYCLIC` | Barang Konsumen Non-Primer | Consumer Cyclicals |
| `IDXHEALTH` | Kesehatan | Healthcare |
| `IDXFINANCE` | Keuangan | Financials |
| `IDXPROPERT` | Properti & Real Estat | Properties & Real Estate |
| `IDXTECHNO` | Teknologi | Technology |
| `IDXINFRA` | Infrastruktur | Infrastructures |
| `IDXTRANS` | Transportasi & Logistik | Transportation & Logistic |

Aturan parsing (implementasi `POST /api/v1/admin/import/excel`):
- Ticker dinormalisasi: uppercase, buang spasi/titik, buang suffix `.JK` bila ada, **hanya `[A-Z0-9]{4}`** (format kode IDX). Wajib 4 karakter → kalau tidak, baris masuk `excel_import_error` (jangan diam-diam dilewatkan).
- Sheet dengan nama di luar 11 kode di atas → dicatat di error report, tidak fail seluruh import (`?strict=true` untuk membuatnya fail).
- Dua sheet berisi ticker yang sama → baris kedua masuk error report (`duplicate ticker`), yang pertama menang.
- Import bersifat **idempotent**: file sama (sha256 sama) → ditolak dengan pesan "already imported" kecuali `?force=true`.
- Endpoint mengembalikan ringkasan: `inserted`, `updated`, `deactivated`, `errors[]` per sheet. Saham yang hilang dari Excel versi baru → `is_active = 0` (**jangan dihapus**; riwayat harga harus tetap ada).

## 7. Batasan teknis ingest (angka **terukur**, 2026-10-12)

Diukur langsung dengan yfinance 1.7.0: **50 ticker nyata IDX, `period="2y"` → 3,8 detik, 473 bar/ticker, 0 baris hilang** (kecuali 1 ticker yang memang sudah tidak ada: `MAP.JK` → `404 Quote not found`).

| Ukuran | Nilai terukur | Untuk 962 ticker (20 batch + 1 s jeda) |
|---|---|---|
| Waktu backfill harian 2 tahun | 3,8 s / 50 ticker | **≈ 95 detik** |
| Baris per ticker | 473 | ≈ **455.000 baris** |
| Ukuran `price_daily` | — | ≈ **48 MB** |

Artinya backfill penuh itu murah (hitungan **detik–menit**, bukan jam). Estimasi lama "15–40 menit" **salah** — sudah dikoreksi di sini.

⚠️ **Jebakan `period` yang sudah diuji:** `period="730d"` **bukan** 2 tahun — yfinance mengembalikan **730 bar** (≈ 3,07 tahun, `2023-09-15` → `2026-10-12`). Untuk 2 tahun pakai **`period="2y"`** (473 bar, `2024-10-14` → `2026-10-12`) atau, lebih eksplisit, `start`/`end` bertanggal. Implementasi `ingest-prices` harus memakai `start`/`end` tanggal (bukan `period="730d"`), supaya jumlah bar tidak berubah diam-diam antar versi yfinance.

Catatan lain:
- Ticker yang tidak ada di Yahoo (contoh nyata: `MAP.JK`) → masuk `failed_tickers`, **bukan** error fatal. Dari 50 ticker uji, 1 gagal → perkiraan ~2–5% universe bisa gagal (delisting/rename).
- Rate limit: pakai `yf.download()` batch (maks. 50 ticker per panggilan), jeda `config.ingest.sleep_seconds` (default 1.0) antar batch, retry 3× dengan backoff. Kalau Yahoo menolak (429/empty), catat di `ingest_run` dan **jangan** hapus data lama.
- Riwayat harian: `config.ingest.daily_lookback_days: 730` (2 tahun) — **kenapa 2 tahun, bukan lebih pendek:** jendela terpanjang yang ditawarkan UI (`1y`/`ytd`) butuh ≈ 250 bar + warmup; untuk **mingguan**, warmup 30 minggu + jendela `1y` (52 minggu) = ≈ 82 minggu ≈ 1,6 tahun, ditambah margin hari libur & titik awal → 2 tahun. Kurang dari itu, `w1_fri` dengan `window=1y` tidak bisa menampilkan ekor penuh.
- Simpan `adj_close` **dan** `close`. Perhitungan return pakai `adj_close` (tahan split/dividen), tampilan harga pakai `close` (harga nyata IDX).
- Ingest harian bersifat **upsert** (`INSERT ... ON CONFLICT DO UPDATE`) → aman dijalankan ulang; bar hari berjalan boleh berubah (harga bergerak) dan akan ditimpa.
- Kalau sebuah emiten tidak punya bar (suspend / delisted), itu **bukan** error: cukup tidak ada baris baru.
