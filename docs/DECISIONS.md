# DECISIONS — catatan keputusan (ADR ringan)

Aturan: setiap keputusan yang **menyimpang dari dokumen planning**, atau memilih di antara dua opsi yang sama-sama masuk akal, ditulis di sini **sebelum atau saat** dikerjakan. Satu keputusan = satu entri. Jangan hapus entri lama; kalau berubah, tambah entri baru di bawahnya dengan status `supersedes: ADR-00X`.

Format:

```md
## ADR-00X — <judul singkat>
- tanggal: YYYY-MM-DD
- status: usul | diterima | ditolak | digantikan
- konteks: <kenapa keputusan ini perlu>
- keputusan: <apa yang dipilih>
- alternatif: <yang tidak dipilih + alasan singkat>
- dampak: <efeknya ke kode/UI/data, termasuk yang harus diubah nanti>
```

---

## ADR-001 — Indeks sektor dihitung sendiri, bukan dari Yahoo
- tanggal: 2026-10-12
- status: diterima
- konteks: butuh indeks 11 sektor IDX-IC untuk RRG.
- keputusan: hitung sendiri dari konstituen (`weighting: equal` default, `turnover` tersedia).
- alternatif: `IDXENERGY.JK` / `IDXFINANCE.JK` dari Yahoo — **diuji hanya 1 baris** untuk `period=5d`, riwayat tidak bisa dipakai.
- dampak: definisi indeks menjadi milik kita (harus konsisten & didokumentasikan); tiga varian bobot tersedia (`equal`, `turnover`, `captier`) — cap-weight murah karena `shares_outstanding` sudah ada di Excel, jadi `.info` per emiten tidak diperlukan untuk perhitungan ini.

## ADR-004 — Universe & bobot diambil dari `saham_sektoral.xlsx`
- tanggal: 2026-10-12
- status: diterima
- konteks: user sudah menyiapkan file sektor→saham sebelum kode dibuat; isi diverifikasi (11 sheet, 962 emiten, 0 kode invalid, 0 duplikat).
- keputusan: file itu menjadi **sumber universe** (ticker, nama, papan, tanggal pencatatan, jumlah lembar) dan tidak digandakan di kode. Path-nya `config.universe.excel_path`.
- alternatif: menarik daftar emiten dari sumber lain (IDX/Yahoo) — ditolak: tidak gratis-stabil, dan klasifikasi sektor resmi IDX-IC tidak tersedia di Yahoo.
- dampak: import Excel adalah langkah **pertama** di alur data (B1); kalau file berubah (emiten baru/delisting), cukup jalankan ulang import — tidak ada perubahan kode. Dua hal yang sebelumnya direncanakan lewat `.info` (market cap, papan) jadi gratis; `.info` tinggal dipakai untuk cross-check klasifikasi superfisial saja.

## ADR-002 — Agregasi mingguan pakai `resample("W-FRI")`, bukan `interval="1wk"`
- tanggal: 2026-10-12
- status: diterima
- konteks: butuh bar minggu Senin–Jumat.
- keputusan: resample dari bar harian; hanya minggu lengkap untuk `w1_fri`.
- alternatif: `interval="1wk"` — diuji, bar minggu berjalan mengembalikan `Close = NaN`.
- dampak: ingest harian wajib lengkap sebelum `compute --timeframe w1_fri`.

## ADR-006 — Skema: 13 tabel (bukan 14), semua objek `IF NOT EXISTS`
- tanggal: 2026-10-13
- status: diterima
- konteks: AC task B0 (`docs/07`) menyebut `db-init` "membuat `data/rotation.db` dengan 14 tabel"; contoh `GET /health` di `docs/05` §1 juga menampilkan `"tables": 14`. DDL di `docs/04` §1–§4 mendefinisikan **13** `CREATE TABLE` + 2 `CREATE VIEW`.
- keputusan: `backend/app/db/schema.sql` mengikuti DDL `docs/04` **persis** (13 tabel + 2 view). Field `tables` di `/health` dihitung live dari `sqlite_master` (`COUNT(*) WHERE type='table'`), jadi angkanya tidak bisa berbohong/drift; sekarang keluar `13`. Tidak ada tabel tambahan yang diciptakan hanya untuk mencapai angka 14.
- alternatif: (a) menambah tabel dummy/`schema_migration` → ditolak: `docs/04` §7 sudah memakai `PRAGMA user_version`, tabel itu tidak dibutuhkan kode mana pun; (b) mengubah DDL untuk menambah tabel nyata → ditolak: mengubah skema di luar dokumen tanpa kebutuhan.
- dampak: angka 14 di `docs/07` B0 & contoh `docs/05` tetap tidak akurat sampai user memutuskan (13 = benar, atau ada 1 tabel yang memang lupa ditulis di `docs/04`). Frontend yang menampilkan "tables" cukup memakai nilai dari API. Semua objek dibuat dengan `IF NOT EXISTS` supaya `db-init` idempoten (AC "dua kali jalan tidak error"); ini selaras dengan aturan migrasi `docs/04` §7, hanya saja diterapkan lebih awal di `schema.sql`.

## ADR-007 — `pip install -e backend` sebagai satu langkah setup
- tanggal: 2026-10-13
- status: diterima
- konteks: `backend/pyproject.toml` (diminta `docs/07` B0) mendeklarasikan dependency, tapi paket Python-nya (`backend.*`) hidup di **root repo** karena CLI dijalankan `python -m backend.cli` dari root — bukan dari folder `backend/`.
- keputusan: `pyproject.toml` memakai setuptools dengan `package-dir = {"backend": "."}` + daftar `packages`, sehingga `pip install -e backend` memasang dependency **dan** membuat `import backend.app.main` jalan dari cwd mana pun. Terverifikasi (import dari `C:\`).
- alternatif: `pip install -r requirements.txt` (duplikat daftar dependency di dua tempat) atau menaruh `pyproject.toml` di root repo (menyimpang dari struktur `docs/07`).
- dampak: perintah setup yang didokumentasikan nanti di `backend/README.md` = `python -m venv .venv && .venv/Scripts/pip install -e backend`. Setiap kali ada modul baru di `backend/app/` (`repo/`, `ingest/`, `compute/`, `api/` dari struktur `docs/07`), namanya **wajib** ditambahkan ke `packages` di `pyproject.toml` supaya ikut terpasang.

## ADR-011 — Master 11 sektor di-seed saat `db-init`
- tanggal: 2026-10-13
- status: diterima
- konteks: tabel `sector` (docs/04 §1) harus terisi sebelum import Excel, karena `stock.sector_id` adalah FK ke sana. Dokumen tidak menyebut dari mana 11 baris `sector` berasal; `docs/02` §6 punya kode & nama sektor, `docs/06` §3 punya warna tetap dan urutan tampil.
- keputusan: master sektor disimpan sebagai data (`backend/app/db/seed_sectors.sql`, `INSERT OR IGNORE`) dan dijalankan oleh `init_db` setelah `schema.sql`. Isinya: `code` + `name_id` + `name_en` dari `docs/02` §6, `color_hex` (hex tema terang) dari `docs/06` §3, `sort_order` = urutan tabel `docs/06` §3 (1–11, IDXFINANCE = 7 sesuai contoh `docs/05` §1).
- alternatif: (a) seed dari kode Python (dict) → ditolak: isi jadi ikut berubah lewat deploy kode, sedangkan ini data referensi; (b) hanya mengisi `sector` saat import Excel → ditolak: `GET /api/v1/meta/sectors` harus bekerja walau import belum pernah dijalankan.
- dampak: `db-init` sekarang juga mengisi 11 baris `sector`; jumlah tabel tetap 13 (+2 view). Kalau nama/warna sektor berubah, ubah `seed_sectors.sql` (`INSERT OR IGNORE` **tidak** menimpa baris yang sudah ada — perlu `DELETE`/`UPDATE` manual atau migrasi).

## ADR-012 — Guard import Excel: file tanpa baris valid ditolak
- tanggal: 2026-10-13
- status: diterima
- konteks: import menandai `is_active = 0` untuk saham yang hilang dari file. File yang salah (mis. sheet salah nama, kolom tergeser) akan menghasilkan 0 baris valid → seluruh universe nonaktif hanya karena salah file. Aturan `docs/02` §6 tidak menyebut kasus ini.
- keputusan: `import_excel` menolak (`NoValidRows`, HTTP 400 `no_valid_rows`) bila hasil parsing 0 baris valid. Baris kosong **di ekor** sheet diabaikan (artefak Excel); baris berisi data tapi tanpa nilai `Kode` dicatat `empty_row`; baris dengan `Kode` yang gagal normalisasi `[A-Z0-9]{4}` → `invalid_ticker` (dengan `raw_value`). CLI `import-excel` mencetak error JSON + exit 1 (bukan traceback) untuk `already_imported` / `unknown_sheet` / `no_valid_rows`.
- alternatif: menulis `deactivated` apa adanya → ditolak: satu salah unggah mematikan 962 emiten sekaligus.
- dampak: import file kosong/salah tidak mengubah tabel `stock` sama sekali (tidak ada baris `excel_import` yang tercatat juga). Error import yang tidak fatal tetap tersimpan di `excel_import_error` dan dikembalikan di field `errors`.

## ADR-016 — Job pipeline: satu jalur untuk CLI & API, migrasi kolom progres `ingest_run`
- tanggal: 2026-10-13
- status: diterima
- konteks: revisi `docs/05` §4 + `docs/04` §4 (kolom progres `ingest_run`) + `docs/07` B12 mewajibkan API dan CLI memakai fungsi Python yang sama, pola `?async=true` → `202 {run_id, status:"queued"}`, dan `GET /admin/runs/{run_id}`. Tabel `ingest_run` sudah terlanjur dibuat di `data/rotation.db` oleh B0 dengan DDL lama.
- keputusan: (a) `schema.sql` memuat DDL baru (baseline db baru) **dan** `db/migrations/001_ingest_run_progress.sql` menambahkan kolomnya ke db lama; runner migrasi mengabaikan error `duplicate column name` sehingga db baru melewati migrasi 001 tanpa error (SQLite tidak punya `ADD COLUMN IF NOT EXISTS`). (b) Semua job lewat `app/jobs.execute(kind, params, fn, async_=…, triggered_by=…)` — `fn(params, report)` menerima callback `report(rows=…, rows_total=…, message=…, phase=…)` untuk menulis progres per batch; sinkron mengembalikan hasil job, async menjalankan di thread dan mengembalikan `run_id`. (c) Setiap job mengisi `rows` di hasilnya (dipakai kolom `ingest_run.rows`, jadi `rows` juga muncul di respons import). (d) Respons `GET /admin/runs/{run_id}` memuat `params_json`, `result_json`, dan `failed_tickers` (dibutuhkan panel riwayat F12); `GET /admin/runs` berbentuk `{api_version, total, items[]}` seperti daftar lain di `docs/05` §2. (e) Error 500 juga memakai envelope `{api_version, error:{code,message,detail}}` tanpa stack trace.
- alternatif: (a) API memanggil CLI via subprocess → dilarang `docs/07` B12; (b) `BackgroundTasks` FastAPI → tidak bisa dipakai dari CLI, dan statusnya hilang setelah respons; (c) menyimpan progres per baris → dilarang `docs/07` B12 #5 (SQLite jadi sibuk); (d) membuang db lama lalu `db-init` ulang → ditolak: user akan punya data harga saat B2/B3 jalan, tidak boleh hilang.
- dampak: job baru (`prices`, `compute`, `midday`) wajib lewat `jobs.execute` dan mengisi `rows`; kalau perlu progres di UI, panggil `report(...)` tiap batch. Migrasi berikutnya ditulis dengan pola yang sama (ALTER yang tahan db baru + catat di DECISIONS). Satu risiko yang diketahui: kalau proses mati saat job async jalan, baris `ingest_run` tetap `running` (belum ada pembersih otomatis) — terlihat di panel riwayat sebagai run menggantung.

## ADR-017 — `yahoo_sector` opt-in, dan bar harian hari berjalan belum punya `Close`
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/07` B2 minta `.info` dipakai **hanya** untuk `yahoo_sector` sebagai cross-check, maks sekali per 7 hari per emiten — tetapi skema `stock` tidak punya penanda kapan `.info` diambil, dan 962 `.info` di dalam satu klik UI berarti beberapa menit ekstra plus risiko 429 di tengah ingest harga. Temuan nyata saat uji (2026-10-13): bar harian hari berjalan (`2026-10-12` BBCA) datang dengan `Open/High/Low/Volume` terisi tetapi **`Close = NaN`**.
- keputusan: (a) kolom `stock.yahoo_sector_at` lewat migrasi `002` sebagai penanda; refresh `.info` **opt-in** (`?refresh_info=true` pada endpoint, `--refresh-info` di CLI), tetap dibatasi `config.ingest.refresh_market_cap_days`. (b) Bar tanpa `Close` dilewati (bukan error, bukan harga 0) — bar yang sama akan masuk sendiri setelah harinya final, karena upsert. (c) `market_cap_idr`/`last_bar_date` diperbarui **per batch**, bukan hanya di akhir run, supaya run yang mati di tengah tetap meninggalkan data turunan yang konsisten.
- alternatif: `.info` otomatis setiap ingest (ditolak: klik pertama user jadi ~5–10 menit dan bisa gagal 429 di tengah ingest harga); menyimpan penanda waktu di `stock.notes` (ditolak: menyalahgunakan kolom teks); memakai bar `Close = NaN` sebagai harga terakhir (ditolak: menulis harga kosong ke `market_cap_idr`).
- dampak: `yahoo_sector` tetap `NULL` sampai user memilih refresh — kolom ini murni cross-check, tidak dipakai perhitungan apa pun. Untuk B3 perlu diperhatikan: **bar harian hari berjalan tidak bisa dipakai** untuk gate/perhitungan tengah hari; jalur intraday (`price_intraday`) yang harus dipakai, dan `price_daily` hari berjalan baru terisi setelah sesi tutup.

## ADR-018 — Job `midday` berhenti di gate sampai compute RRG ada (B5)
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/07` B3 minta `midday` = gate + hitung ulang + compute RRG `midday`, tetapi RRG (`docs/07` B5) belum ada. Gate sendiri sudah bisa diuji dan bermanfaat (menentukan boleh-tidaknya hitung, dan mengisi `data_freshness`).
- keputusan: job `midday` dijalankan penuh sebagai langkah pipeline (`POST /admin/midday`, CLI `midday`, tercatat di `ingest_run`): probe gate → kalau `stale` berhenti dengan `{"gate":"stale","computed":false}` (HTTP 200, bukan error) → kalau `ok`, ingest intraday dijalankan lalu berhenti dengan `computed:false` + `message` yang menyebut compute menyusul. Bar `session='post'` (16:00–16:15) ikut disimpan untuk audit tetapi hanya bar `regular` yang dihitung gate. Status `daily_ingest` di `GET /freshness` dihitung langsung dari `price_daily` (bukan tabel bantu), dan hanya melewati Sabtu/Minggu — hari libur bursa tidak diketahui.
- alternatif: (a) menunda seluruh B3 sampai B5 jadi → ditolak: gate + intraday tidak bergantung RRG, dan F12 butuh tombol 6 ada; (b) mengembalikan `computed:true` padahal belum menghitung → ditolak: melaporkan sukses palsu (dilarang juga oleh `docs/05` §5.1 "jangan biarkan tombol tampak selesai padahal run-nya gagal"); (c) menambah endpoint khusus gate → ditolak: kontrak `docs/05` §4 sudah menetapkan `POST /admin/midday`.
- dampak: tombol 6 di halaman Data (F12) sekarang = gate + ingest intraday; setelah B5, `computed` berubah jadi `true` dan RRG `midday` ikut ditulis tanpa mengubah bentuk respons. Kalau `daily_ingest` perlu akurat pada hari libur bursa, perlu kalender hari bursa (belum ada di v1).

## ADR-019 — Detail indeks sektor & ambang prasyarat harga
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/02` §3 menetapkan rumus indeks dan aturan kebersihan seri, tetapi beberapa detail tidak ditentukan: isi baris pertama seri, perlakuan hari "masuk kembali" setelah suspend, dan arti angka "sebagian besar emiten" pada prasyarat `prereq_no_prices` (`docs/05` §4.1) — sedangkan `AGENTS.md` rule 4 melarang angka ambang ada di kode.
- keputusan: (a) baris pertama seri = base 100 dengan `ret_1d = NULL`, `constituents_count = 0`, `partial = 1` (belum ada return yang bisa dihitung); (b) saham dianggap suspend setelah **2 hari berturut-turut** tanpa transaksi, dikeluarkan dari perhitungan, dan hari transaksi pertama setelah suspend **juga** belum dipakai (return-nya lompat dari harga basi) — mulai hari berikutnya ikut lagi; (c) prasyarat `prereq_no_prices` memakai ambang baru di config, `universe.min_prices_coverage: 0.5` (tebakan awal, bisa dinaikkan/diturunkan user, dan bisa dibaca frontend lewat `/meta/config` di B8); (d) semua bobot (termasuk `equal`) dinormalisasi per hari → `equal` = rata-rata, bukan jumlah return; (e) `sector_index_daily` diisi untuk ketiga bobot (`equal`, `turnover`, `captier`) dalam satu kali jalan.
- alternatif: (a) baris pertama dilewati → ditolak: RS/RRG (B5) butuh titik `t0` yang sama untuk semua seri (`docs/03` §1); (b) hari masuk kembali langsung dipakai → ditolak: satu saham suspend lama bisa menggeser indeks belasan persen dalam sehari; (c) prasyarat "ada baris di `price_daily`" → ditolak: tombol Hitung bisa jalan dengan 1 emiten; (d) ambang hardcode di kode → dilarang `AGENTS.md` rule 4.
- dampak: `compute --stage index` untuk universe parsial (185 emiten) selesai ~3,8 s setelah bagian per-tanggal divektorkan (sebelumnya 21 s); perkiraan untuk 962 emiten ~15–20 s, masih di dalam estimasi UI. Kalau `equal` dan `captier` bergerak berlawanan jauh, itu sinyal rotasi didorong saham besar (catat di `rationale` saat B7). Frontend perlu tahu: baris `partial=1` (1.446 baris saat ini) muncul untuk sektor tipis dan untuk baris base tiap seri.

## ADR-020 — Detail RRG & cakupan penyimpanan metrik
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/03` §2–§4 menetapkan rumus RRG, tetapi beberapa hal tidak ditentukan: isi kolom `transition` saat kuadran tidak berubah, potongan baris warmup, satuan jendela return untuk timeframe mingguan, bobot mana yang dihitung, dan berapa banyak baris metrik yang disimpan.
- keputusan: (a) `transition` hanya diisi bila kuadran **berubah** (`improving→leading`), kalau tidak `NULL` — `quadrant_prev` tetap menyimpan kuadran sebelumnya; (b) baris pertama yang disimpan = bar ke-`rrg.min_points[timeframe]` (sebelum itu tidak ada baris sama sekali, bukan diisi 100); (c) `rrg_daily` dihitung untuk 11 sektor × 3 bobot (`equal`/`turnover`/`captier`) dan untuk saham dengan bobot default config; benchmark saham = indeks sektornya; (d) `sector_metrics` menyimpan seluruh seri sedangkan `stock_metrics` hanya snapshot `as_of` terakhir per saham per timeframe (satu baris per emiten — ekor RRG saham sudah ada di `rrg_daily`); (e) metrik **saham** selalu satuan harian (SMA20/SMA50/RSI14/ATR14 harian, sesuai `docs/03` §6.2), metrik **sektor** mengikuti satuan timeframe: untuk `w1` seri indeks & turnover di-resample ke bar Jumat dulu, dan jendela return memakai satuan minggu (`1w`=1, `1m`=4, `3m`=13, `6m`=26).
- alternatif: (a) `transition` diisi apa adanya (`leading→leading`) → ditolak: filter UI (`transition=improving→leading` di `docs/05` §2) jadi bising; (b) menyimpan seluruh seri `stock_metrics` → ditolak: 455k baris tanpa pemakai; (c) memakai jendela return harian untuk timeframe mingguan → ditolak: `ret_1w` mingguan jadi sama dengan `ret_1d` harian, menyesatkan.
- dampak: kolom `score` (rrg_daily, sector_metrics), `rank_score`, `stock_score`, dan `quadrant` di `stock_metrics` masih `NULL` sampai B6; B7 akan memakai `rrg_daily` timeframe `w1_fri` + `signal_weekly`. **Utang performa:** `compute --stage rrg` butuh 47 s (d1) / 61 s (w1) untuk 185 emiten berharga karena satu query per emiten; untuk 962 emiten perkiraan ~4–5 menit — di atas estimasi tombol 4 di `docs/05` §4.1 (30–60 s), perlu dioptimalkan (batch query per sektor) sebelum user menjalankan penuh.

## ADR-021 — Skor: snapshot terakhir, persentil rank, dan di mana disimpan
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/03` §5 menetapkan rumus skor sektor & §6.2 rumus `stock_score`, tetapi tidak menentukan: skor dihitung untuk tanggal mana (seluruh seri atau terakhir), metode persentil, penanganan nilai kosong, tie-break, dan di mana hasilnya disimpan. Deliverable B6 juga menyebut `margin_to_min_turnover` sebagai "kolom di `stock_metrics` lewat response".
- keputusan: (a) skor dihitung untuk `as_of` **terakhir** per (timeframe, weighting) — angka yang dipakai tabel UI & ranking mingguan, bukan seluruh seri; (b) persentil = `rank(pct=True) × 100` (nilai tertinggi = 100), nilai komponen kosong dianggap 0 (tanpa kredit); (c) skor di-clamp 0–100 dan dibulatkan 1 desimal (`docs/03` §5 "angka bulat 1 desimal"); (d) `rank_score` = urutan skor menurun dengan tie-break "first" (stabil menurut `sort_order` sektor) sehingga **selalu unik** 1..N; (e) skor sektor disimpan di `sector_metrics.score`/`rank_score` **dan** `rrg_daily.score` (scope=sector, sesuai komentar `docs/04` §4), `stock_score` disimpan di `stock_metrics`, `quadrant` di `stock_metrics` disalin dari `rrg_daily`; (f) `margin_to_min_turnover` = `median_turnover_20d_idr / universe.min_turnover_idr` dihitung di respons `GET /stocks/{ticker}` (B8), **bukan** kolom DB (tidak ada di DDL `docs/04`).
- alternatif: (a) menghitung skor untuk seluruh seri historis → ditolak: biaya 3× tanpa pemakai (histori kuadran sudah ada di `rrg_daily`; chart skor belum ada di `docs/01` §3); (b) persentil min–max → ditolak: `docs/03` §5 minta persentil, dan min–max meledak pada sektor tipis; (c) menambah kolom `margin_to_min_turnover` ke `stock_metrics` → ditolak: menyimpang dari DDL `docs/04` untuk satu angka turunan yang murah dihitung saat query.
- dampak: skor tersedia untuk 2 timeframe (d1, w1) × 3 bobot; `w1_fri` ikut terisi begitu B7 menghitungnya. B7 memakai `score` ini untuk ranking kandidat sektor/saham. Kalau nanti perlu skor historis (mis. grafik perjalanan skor), jalankan `metrics.compute_scores` per tanggal — fungsi sudah menerima `timeframes`/`weightings`.

## ADR-022 — Sinyal mingguan: semua aturan wajib, RS saham harian, gate penutupan Jumat
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/03` §6 menetapkan aturan kandidat sektor (§6.1) & saham (§6.2) dan streak (§6.3), tetapi tidak menentukan: dari mana `return_4w` diambil, timeframe RS-Ratio untuk saham (§6.2 hanya menyebut indikator harian untuk SMA/RSI/ATR), apakah aturan wajib semua, cara peringkat & batas jumlah, dan arti "setelah penutupan Jumat" pada `docs/05` §4.1.
- keputusan: (a) sektor lolos hanya bila **kelima** aturan §6.1 benar; `return_4w` = `sector_metrics.ret_1m` timeframe `w1_fri` (4 bar mingguan, sama dengan `scoring.return_window_weeks`); `constituents_count` diambil dari `sector_index_daily` bar ≤ tanggal minggu. (b) Saham lolos hanya bila **kedelapan** aturan §6.2 benar; indikator harian dari snapshot `stock_metrics` `d1`, `RS_Ratio` dari `rrg_daily` scope `stock` timeframe **`d1`** (tanpa RRG saham mingguan — mahal, ~60 s untuk 185 emiten, ADR-020), papan `Pemantauan Khusus` dikecualikan (`universe.exclude_pemantauan_khusus`). (c) Hanya minggu **final** (`w1_fri`) yang menghasilkan baris; minggu berjalan tidak pernah masuk. (d) Peringkat: sektor urut `score` menurun, saham urut persentil `score` **antar kandidat minggu itu**; hanya `weekly.max_sectors` / `max_stocks_per_sector` yang disimpan. (e) `streak_weeks` = jumlah minggu kalender perdagangan berurutan dari data; dihitung ulang untuk seluruh minggu setiap kali compute (idempoten, jadi run baru memperbaiki streak lama). (f) Gate `gate_weekly_not_final` = hanya Jumat ≥ `weekly.final_after_time` (16:15 WIB) atau Sabtu/Minggu; ambang di `config/default.yaml` (aturan repo 4). (g) Stage `signals` menghitung prasyaratnya sendiri (RRG/metrik/skor sektor `w1_fri`, plus `d1` saham bila belum ada) supaya tombol 5 tidak bergantung urutan tombol lain.
- alternatif: (a) RRG saham mingguan untuk aturan RS → ditolak: biaya ~60 s tanpa bukti lebih baik, dan `docs/03` §6.2 sendiri memakai indikator harian; (b) skor saham dihitung global lintas minggu → ditolak: persentil lintas tahun membuat skor lama tak sebanding dengan skor terbaru; (c) gate "hari Jumat" tanpa jam → ditolak: siang Jumat data belum final, klik akan mengunci minggu yang belum tutup.
- dampak: F9 memakai `GET /api/v1/weekly/picks` (bentuk di `docs/05` §3); briefing (B9) membaca tabel yang sama. Sinyal historis 129 baris untuk 91 minggu (realistis). Kalau nanti butuh RS saham mingguan, `compute_rrg(timeframes=["w1_fri"])` sudah bisa dipanggil tanpa perubahan skema.

## ADR-023 — Endpoint read: `color_token` turunan, versi `/rrg` 1.1, status data dari `data_freshness`
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/05` §1–§2 memuat beberapa hal yang tidak ada di DDL `docs/04` atau tidak dijelaskan: `color_token` di `/meta/sectors`, nilai `api_version` per endpoint (`/rrg` contohnya 1.1, lainnya 1.0), arti `data_status.status`, kolom return untuk `window=1y`, `ret_1w` untuk saham (`stock_metrics` tidak punya `ret_1w`), dan perilaku `ret_positive_only` pada `/stocks` yang tanpa param `window`.
- keputusan: (a) `color_token` **diturunkan** dari kode sektor (`"sector-" + code tanpa "IDX" huruf kecil`), karena `sector` tidak punya kolom itu dan contoh `docs/05` (`IDXFINANCE` → `sector-finance`) cocok dengan pola ini. (b) `/rrg` mengembalikan `api_version "1.1"` sesuai contoh `docs/05` §2 (field aditif Δ1p/streak); endpoint lain tetap `"1.0"`. (c) `data_status.status` = `partial` bila ada sektor dengan `constituents_count < 3` (daftarnya di `partial_sectors`), `stale` bila baris `data_freshness` `daily_ingest` berstatus `stale|partial|failed`, selain itu `ok` — **tidak** memakai perhitungan tanggal sendiri (belum ada ambang baru). (d) `window` hanya memengaruhi panjang ekor & kolom return; untuk `1y` tidak ada kolomnya di DDL → memakai `ret_ytd` (catatan `shortcut` di kode). (e) `ret_1w` saham = `stock_metrics.ret_5d` (5 hari bursa), karena `stock_metrics` tidak punya `ret_1w` dan `docs/05` memakai satu nama field. (f) `/stocks` `ret_positive_only` selalu memakai `ret_1w` (=`ret_5d`) sesuai catatan `docs/05` §2. (g) Filter multi-nilai (`sector`, `quadrant`) menerima `A,B` dan `A` berulang (konvensi `docs/05`); param tak dikenal diabaikan default FastAPI; limit di luar rentang → `422` dengan envelope kontrak (`validation_error`, handler baru di `main.py`). (h) Cache 60 s (`api.cache_ttl_seconds`) hanya untuk `/rrg` dan `/sectors/summary`, kunci = endpoint + seluruh param relevan. (i) `/rrg` menerima `limit` opsional (default: semua) untuk `scope=stock` — frontend membatasi 25 titik (`docs/06` §5), tapi tabel "lihat semua" butuh semua; param aditif, klien lama tidak terpengaruh.
- alternatif: (a) menambah kolom `color_token` ke tabel `sector` → ditolak: mengubah DDL `docs/04` untuk nilai yang bisa diturunkan deterministik; (b) menaikkan `api_version` global ke 1.1 → ditolak: contoh `docs/05` hanya menaikkan `/rrg`, dan menaikkan global berarti mengubah kontrak endpoint lain tanpa sebab; (c) `data_status.status` dihitung dari umur data (mis. `as_of` vs hari ini) → ditolak: itu ambang baru yang tidak ada di config dan duplikasi gate kesegaran `docs/02` §5.
- dampak: F9/F4 dkk memakai bentuk ini apa adanya. **Sisa yang diketahui:** `ret_1y` tidak ada di DDL sehingga `window=1y` memakai `ret_ytd`. (Blok `stale` awalnya membaca baris `data_freshness.daily_ingest` yang belum ditulis ingest; sejak B9 status diambil dari `freshness.read` yang menghitungnya dari `price_daily` — lihat ADR-024.)

## ADR-024 — Briefing pagi: ambang regime di config, breadth dari tabel sektor, watch bukan error
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/05` §3 menetapkan bentuk `briefing/morning` tetapi tidak menjelaskan: di mana ambang regime (dokumen menyebut angka 7), dari data mana `sectors_up/down` dan `breadth` diambil, isi `include_series`, sumber blok `midday`, pilihan level di `watch[]`, dan teks `notes_for_report`.
- keputusan: (a) ambang regime masuk config (`briefing.regime_sector_threshold: 7`, `top_n_default: 3`) karena aturan repo 4 melarang ambang di kode — 7 tetap angkanya sesuai `docs/05`. (b) `sectors_up`/`sectors_down` dihitung dari `sector_index_daily.ret_1d` (bobot default), bukan dari kuadran — contoh `docs/05` (2 naik / 9 turun saat IHSG −2,6%) hanya masuk akal sebagai perubahan harian. (c) `breadth` = jumlah `advancers/decliners/unchanged` seluruh sektor pada tanggal itu (angka yang sama dengan tabel sektor & heatmap, tidak menghitung ulang 962 emiten). (d) IHSG dari `price_daily` (`ingest.benchmark_alias`): `close` terakhir, `ret_1d` vs bar sebelumnya, `ret_1w` vs bar ke-6. (e) blok `midday` dari `sector_metrics` timeframe `midday` (`ret_intraday`, `intraday_move`, `projected_quadrant`) + gate `freshness`; `available=false` bila belum ada baris. (f) `watch[]` selalu **pesan**, bukan error: `warning` untuk gate intraday gagal, `info` untuk status data partial/stale, sinyal mingguan kosong, dan midday belum ada — briefing **selalu 200** sesuai `docs/05` §3. (g) `include_series=true` menambahkan 30 titik `index_close` terakhir per leader/laggard (`series` = `null` bila tidak diminta). (h) cache 60 s hanya untuk permintaan tanpa `include_series` (yang lain jarang dipanggil dan lebih berat).
- alternatif: (a) menulis ambang 7 di kode → ditolak: melanggar aturan repo 4 dan tidak bisa dituning user dari `config/default.yaml`; (b) `sectors_up/down` dari kuadran leading/lagging → ditolak: tidak bisa menghasilkan 2 naik/9 turun dalam sehari; (c) `breadth` dihitung dari `price_daily` semua emiten → ditolak: duplikasi kerja harian dan berisiko berbeda dengan angka sektor yang ditampilkan UI.
- dampak: Hermes/report pagi cukup memanggil satu endpoint; F10 bisa memakai `watch[]` untuk banner. **Sisa:** blok `midday` praktis `available=false` sampai ingest intraday nyata menghasilkan bar (utang `computed:false` dari B3/ADR-018).

## ADR-025 — Tengah hari: satu bar harian dari intraday, hanya sektor, `gate_midday_stale` tidak dipakai
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/03` §4 & `docs/05` §4.1 (tombol 6) meminta "hitung ulang tengah hari" yang mengisi `ret_intraday`, `intraday_move`, `projected_quadrant`, tetapi tidak menjelaskan bagaimana bar intraday disambung ke seri harian, apakah saham ikut dihitung, bagaimana IHSG diperlakukan, dan kapan memakai kode `409 gate_midday_stale`.
- keputusan: (a) `timeframe='midday'` = **seri harian + satu bar "hari ini"** dari bar intraday reguler terakhir (interval 5m) dibanding penutupan harian sebelumnya; bukan bar per menit. (b) Return intraday sektor = rata-rata return konstituen yang punya bar (konsisten dengan bobot `equal` indeks). (c) Hanya **sektor** (11 × bobot `universe.weighting`) yang dihitung; saham tidak, karena tabel & briefing midday hanya menampilkan sektor (`docs/03` §4) dan menghitung 962 emiten di tengah hari tidak ada pemakainya. (d) Baris `sector_metrics` timeframe `midday` diisi: `ret_intraday`, `intraday_move` (ambang `midday.move_flat_pct`), `projected_quadrant` (kuadran RRG midday), `rrg_rs_ratio`, `rrg_rs_momentum`, `median_turnover_20d_idr` dari snapshot terakhir. (e) `as_of` = tanggal WIB hari ini, dan `rrg_daily` ditulis dengan `timeframe='midday'` supaya bisa dipoll/dibaca endpoint read. (f) IHSG tanpa bar intraday → proksi = rata-rata return semua saham (ditandai `shortcut` di kode). (g) `gate_midday_stale` (409) **sengaja tidak dipakai**: `docs/05` §4.1 menyatakan gate gagal = `200 {gate:"stale", computed:false}`, dan UI memperlakukan itu sebagai pesan, bukan error (ADR-018 dipertahankan).
- alternatif: (a) membangun ulang seri portfolio per menit untuk midday → ditolak: kuadran hanya butuh satu titik hari ini, dan resample menit-menit akan menjadikan `min_points` 60 sebagai 60 menit (tidak bermakna untuk rotasi); (b) menghitung RRG saham juga → ditolak: biaya ~60 s tanpa konsumen; (c) memakai `409 gate_midday_stale` supaya daftar kode di `docs/05` lengkap → ditolak: bertentangan dengan aturan eksplisit di dokumen yang sama dan akan memaksa UI menampilkan error merah untuk kondisi normal (bursa belum buka).
- dampak: tombol 6 mengisi blok `midday` briefing dan (bila ada bar hari ini) tabel midday; baris `rrg_daily`/`sector_metrics` midday dipangkas oleh retensi `retention.midday_rrg_days` saat B10 dikerjakan.

## ADR-026 — Kind baku `docs/05` §4.6, backup via API SQLite, retention tanpa baris run
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/07` B10 meminta `runs`, backup streaming, dan job retention; `docs/05` §4.6 mengunci **enam** nilai `ingest_run.kind` (`import_excel | prices_daily | prices_intraday | compute_all | compute_signals | midday`) dan kunci amplop `runs` — sementara kode backend menulis `excel`/`compute_index`/`compute_rrg` dan mengembalikan `items`. Dokumen juga tidak menyebut dari mana retention dipicu, apa yang dipangkas `logging.keep_days`, dan bagaimana berkas backup dihasilkan.
- keputusan: (a) satu pemetaan di `jobs.kind_of()` (nama lama → baku) sehingga CLI dan API otomatis konsisten, plus migrasi `003_kind_baku.sql` membereskan baris `ingest_run` lama. (b) Amplop daftar run = `{"api_version":"1.1","total":n,"runs":[…]}` (kunci `runs`); `GET /runs/{run_id}` tetap `{"run":{…}}`. (c) `result_json` per kind dilengkapi agar sesuai tabel §4.6: `batches` (prices), `sectors`+`tickers` (compute_all), `week_end`+`sectors`+`stocks` (compute_signals). (d) Backup memakai **API backup SQLite** (snapshot konsisten walau WAL aktif) lalu diunduh sebagai attachment; `api.backup_enabled=false` → `403 backup_disabled`; berkas `.db` hasil bukti tidak di-commit (`.gitignore` + `backup-proof.txt` berisi ukuran & sha256). (e) Retention = `maintenance.retention()` yang dipanggil dari CLI (`retention`) **dan** `POST /api/v1/admin/retention`; sengaja **tidak** menulis baris `ingest_run` karena daftar kind terkunci pada enam nilai dan retention bukan langkah pipeline. (f) `logging.keep_days` tidak dipakai: tidak ada tabel log — pesan run hidup di `ingest_run` yang justru ingin disimpan user sebagai riwayat. (g) VACUUM hanya dijalankan bila ukuran berkas ≥ `retention.vacuum_min_file_mb`.
- alternatif: (a) mempertahankan kind lama → ditolak: `docs/05` §4.6 eksplisit "jangan ditawar lagi", dan halaman Data memakai nama itu untuk chip status & prasyarat tombol ("beda satu huruf = tombol selalu belum pernah"); (b) menyalin berkas DB dengan `shutil.copy` → ditolak: berisiko snapshot tidak konsisten saat WAL aktif; (c) mencatat retention sebagai run dengan kind baru → ditolak: menambah nilai ke daftar yang dikunci kontrak.
- dampak: F12 memakai kind baku + kunci `runs`; user dapat mengunduh backup dari UI. Tombol 7-langkah di `docs/05` §4.1 tidak berubah; retention tersedia lewat HTTP/CLI (bukan salah satu tombol).

## ADR-027 — `weekly.final_after_time` (16:15) sebagai batas minggu final
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/05` §4.1 & `docs/07` B12 AC2 meminta `409 gate_weekly_not_final` bila sinyal mingguan dipaksa di luar penutupan Jumat, tetapi tidak menyebut jam penutupannya, dan config belum punya key-nya — nilai 16:15 sempat muncul di kode tanpa catatan.
- keputusan: ambang masuk config (`weekly.final_after_time: "16:15"`) dan dibaca `signals.gate_final_week`. Gate lolos bila: **Sabtu/Minggu** (Jumat sudah tutup), atau **Jumat ≥ 16:15 WIB**, atau setelahnya di hari Jumat itu; selain itu `409 gate_weekly_not_final` (Senin–Kamis, dan Jumat sebelum 16:15). Angka 16:15 diambil dari batas akhir sesi post-trading `docs/02` §5 (16:00–16:15): lewat jam itu bar Jumat tidak bertambah lagi, jadi hasil minggu boleh dianggap final.
- alternatif: (a) gate "hari == Jumat" tanpa jam → ditolak: siang Jumat data belum final, klik akan mengunci minggu yang belum tutup; (b) ambang di kode → ditolak: melanggar aturan repo 4 (semua angka ambang di `config/default.yaml`); (c) memperlakukan Sabtu/Minggu sebagai `not_final` → ditolak: user justru paling sering membuka aplikasi di akhir pekan.
- dampak: tombol 5 (`compute --stage signals --timeframe w1_fri`) hidup Jumat malam & akhir pekan, terkunci Senin–Jumat sebelum 16:15; pesan 409 memuat `weekday` + `checked_at` supaya UI bisa menjelaskan.

## ADR-028 — Return acuan aturan sektor = acuan skor, dibaca dari seri indeks
- tanggal: 2026-10-13
- status: diterima
- konteks: audit menemukan `signals.evaluate_sector` membaca `ret_4w` dari `sector_metrics.ret_1m` (kolom bulanan), sedangkan skor memakai return acuan `scoring.return_window_weeks` (4 bar mingguan) yang dihitung dari seri indeks (`metrics._sector_reference`). Dua sumber berbeda untuk konsep yang sama: `ret_1m` = 21 bar mingguan, bukan 4.
- keputusan: satu sumber angka — `metrics.window_return(series, date, bars)` dengan `bars = scoring.return_window_weeks` dari seri `sector_index_daily` (weekly, `final_only=True`). `metrics._sector_reference` (skor) dan `signals.reference_returns` (aturan §6.1) memanggil helper yang sama, jadi `rule_hits.ret_4w` kini identik dengan komponen `weight_return_window` skor dan otomatis ikut berubah bila user mengubah `scoring.return_window_weeks` (dibuktikan test: ubah ke 2 → angka `ret_4w` berubah).
- alternatif: (a) tetap memakai `ret_1m` sebagai proksi → ditolak: angka yang berbeda dari skor untuk konsep yang sama, dan `docs/03` §5/§6 tidak pernah menyebut dua definisi; (b) menambah kolom `ret_4w` ke `sector_metrics` → ditolak: kolom turunan dari data yang sudah ada, dan DDL `docs/04` tidak boleh diubah untuk satu nilai turunan (ADR-023).
- dampak: `rule_hits.ret_4w` kini konsisten dengan skor; kalau `scoring.return_window_weeks` diubah, kandidat sektor bisa berubah tanpa mengubah kode.

## ADR-029 — `require_sektor_kandidat` dihormati & baris `data_freshness` ingest (B3 selesai)
- tanggal: 2026-10-13
- status: diterima
- konteks: audit menemukan `weekly.require_sektor_kandidat` tidak pernah dibaca kode (config mati), dan B3 tertinggal satu item: baris `data_freshness` untuk ingest (`intraday_ingest`, `daily_ingest`) belum pernah ditulis sehingga tabel itu hanya berisi `midday_gate`.
- keputusan: (a) `signals.week_picks` membaca `weekly.require_sektor_kandidat`: bila `true` (default, sesuai `docs/03` §6.2) saham hanya diambil dari sektor kandidat; bila `false`, seluruh sektor aktif ikut disaring aturan §6.2 — perilaku lama tetap default, dan key-nya tidak lagi mati. (b) `prices.ingest_intraday`/`ingest_daily` menulis baris `data_freshness` (`intraday_ingest`/`daily_ingest`) berisi `last_bar_at`, status `ok|partial|failed`, dan `detail` (rows/batches/failed_tickers). Respons `GET /api/v1/freshness` tetap menurunkan `daily_ingest` dari `price_daily` (`freshness.read`, ADR-024) — baris tabel adalah catatan run terakhir, bukan sumber status respons. (c) Sisa B3 yang lain (`computed:false`) sudah tertutup di B12/ADR-025.
- alternatif: (a) menghapus key `require_sektor_kandidat` dari config → ditolak: user yang ingin melihat pick di luar sektor kandidat kehilangan tombolnya, dan menghapus konfigurasi yang sudah diumumkan lebih mahal dari 3 baris kode; (b) menulis baris `intraday_ingest` lewat SQL mentah di `prices` → ditolak: satu penulis (`freshness.write_freshness`) lebih mudah dijaga.
- dampak: B3 `done`. Baris `intraday_ingest`/`daily_ingest` muncul pada run ingest berikutnya (dev DB sekarang baru berisi `midday_gate` karena ingest terakhir terjadi sebelum perubahan ini) — tidak ada migrasi data yang diperlukan.

## ADR-030 — Tombol 4 (`stage=all`) juga menghitung prasyarat `w1_fri`
- tanggal: 2026-10-13
- status: diterima (temuan gladi bersih)
- konteks: `docs/05` §4.1 bilang `stage=all` menjalankan "indeks → RRG → metrik → sinyal". Kode menjalankan RRG/metrik/skor untuk `d1`+`w1` saja, sedangkan langkah sinyal membaca RRG/metrik **`w1_fri`** (ADR-022). Akibatnya `stage=all` selalu menulis 0 baris `signal_weekly`, `/weekly/picks` & `weekly_focus` briefing kosong, dan `/rrg?timeframe=w1_fri` tidak punya baris (frontend menggambar ekor dari situ → ekor tidak pernah muncul). Gladi bersih menemukannya karena semua tombol ditekan berurutan dari UI.
- keputusan: `stage=all` menambah satu lintasan **sektor saja** untuk `w1_fri` (RRG + metrik + skor) sebelum langkah sinyal. Hasil `timeframes` menjadi `["d1","w1","w1_fri"]`. Saham tidak dihitung untuk `w1_fri` (RRG saham mingguan mahal ±60 s di 962 emiten, dan tidak dipakai UI — ADR-022).
- alternatif: (a) menyuruh user menekan tombol 5 sebelum tombol 4 → ditolak: sinyal mingguan hanya boleh dihitung Jumat/akhir pekan (`gate_final_week`), jadi `stage=all` di hari kerja akan selalu meninggalkan `/weekly/picks` kosong; (b) `stage=all` memanggil `signals.compute_signals` tanpa prasyarat → ditolak: hasilnya diam-diam kosong (bug yang sedang diperbaiki).
- dampak: durasi tombol 4 naik sedikit (gladi 20 emiten: 15,7 s; DB user 962 emiten: perkiraan +3–5 s untuk 11 sektor × 3 bobot). `/weekly/picks` dan ekor `/rrg?w1_fri` terisi dari satu klik. Dijaga test `test_compute_all_menyiapkan_prasyarat_w1_fri`.

## ADR-031 — Larangan transaksi panjang di `compute`, progres best-effort
- tanggal: 2026-10-13
- status: diterima (temuan gladi bersih: job gagal `OperationalError: database is locked`)
- konteks: `signals.week_picks` menulis tabel TEMP (`_candidate_sector`) untuk tiap minggu tanpa `commit`, sehingga koneksi itu hidup dalam satu transaksi panjang; `report()` menulis progres dari koneksi worker di tengah loop → snapshot koneksi signals jadi basi, dan `upsert` di akhir loop gagal `SQLITE_BUSY_SNAPSHOT` yang muncul ke user sebagai "database is locked". Di DB kecil pun ini mematikan job (~110 minggu, laporan tiap 20 minggu) dan pasti terulang di DB 962 emiten karena UI memantau tiap detik.
- keputusan: (a) fungsi `compute` tidak menahan transaksi lintas loop — tabel TEMP di-`commit` sebelum loop membaca baris sektor; (b) `repo.run.report` jadi best-effort: `OperationalError` yang memuat "locked" dilewati (progres kosmetik — job 60 detik tidak boleh mati karena UI memantau), error lain tetap naik. Kunci tulis tetap satu penulis per waktu; `busy_timeout` dari config tidak diubah.
- alternatif: (a) menaikkan `busy_timeout_ms` → ditolak: tidak menolong `SQLITE_BUSY_SNAPSHOT` (tidak menunggu, langsung gagal); (b) satu koneksi untuk seluruh job (worker meminjamkan koneksinya) → ditolak: diff besar dan mengubah tanda tangan semua fungsi compute; (c) membungkam semua error di `report` → ditolak: error skema nyata harus terlihat.
- dampak: `stage=all`/`stage=signals` tahan terhadap pemantauan UI dan job lain yang menulis. Dijaga test `test_week_picks_tidak_menahan_transaksi` + `test_report_best_effort_saat_database_locked`.

## ADR-033 — Kepemilikan param URL dibagi per modul (`week_end`/`scope` di `weeklyPicks.ts`)
- tanggal: 2026-10-13
- status: diterima
- konteks: halaman Weekly butuh param `week_end` (dan `scope`), tapi `FilterState` di `lib/urlFilters.ts` tidak memuatnya dan modul itu dipakai tabel Sektor/Saham. Sesi F9 menyimpannya di `lib/weeklyPicks.ts` dan melaporkannya sebagai penyimpangan yang belum tercatat.
- keputusan: URL tetap **satu-satunya** sumber state filter, tapi kepemilikan param dibagi per modul: `lib/urlFilters.ts` = param tabel (`timeframe, window, sector, quadrant, transition, min_streak, min_turnover_idr, min_price_idr, ret_positive_only, only_partial, sort, dir, q, limit, offset, as_of`); `lib/weeklyPicks.ts` = param halaman Weekly (`week_end`, `scope`). Tidak ada `useState` filter di komponen mana pun. Aturan turunannya: **satu param = tepat satu modul penulis** (satu modul boleh menulis beberapa param, satu param tidak boleh ditulis dua modul).
- alternatif: (a) menambahkan `week_end`/`scope` ke `FilterState` → ditolak: memaksa setiap halaman tabel membawa dua param yang tidak dipakainya, dan `FilterState` jadi tempat sampah param lintas halaman; (b) state lokal di komponen Weekly → ditolak: melanggar invariant "filter hidup di URL" (tidak shareable, hilang saat reload).
- dampak: kalau nanti ada modul ketiga yang butuh param yang sama, **konsolidasikan** (pindahkan ke satu modul) dan ganti ADR ini. `docs/06` §5/§7 tetap berlaku: nilai filter wajib tercermin di URL.

## ADR-032 — `data_status.status = stale` bila belum ada hasil hitung
- tanggal: 2026-10-13
- status: diterima (temuan gladi bersih)
- konteks: `data_status` menurunkan status dari freshness ingest; timeframe yang belum pernah dihitung (mis. `midday` di DB baru) menjawab `status: "ok"` dengan `as_of: null` dan `computed_at: null` — UI akan menampilkan badge "segar" untuk waktu tanpa data.
- keputusan: `as_of is None` → `status: "stale"` sebelum aturan `partial`/freshness lain. Urutan: `stale` (tak ada hasil hitung) → `partial` (ada sektor < 3 konstituen) → freshness ingest → `ok`.
- alternatif: membiarkan `ok` + `as_of: null` → ditolak: kontrak `docs/05` §3 memakai `status` untuk badge; "ok" tanpa data menyesatkan frontend dan user.
- dampak: frontend boleh memakai `status` saja untuk badge. Endpoint dengan `data_status`: `/rrg`, `/sectors/summary`, `/sectors/{code}`, `/stocks`, `/briefing/morning` (sisanya tanpa `data_status` sesuai `docs/05`).

## ADR-033 — Run `already_imported` dicatat `skipped`, bukan `failed`
- tanggal: 2026-10-13
- status: diterima
- konteks: `POST /admin/import/excel` yang ditolak `409 already_imported` mencatat baris `ingest_run` sebagai `failed` karena pekerja job melempar `excel.AlreadyImported` ke penanganan error umum. Halaman Data memakai status run terakhir per `kind` untuk mengunci/membuka tombol pipeline, jadi mengimpor file yang sama membuat tombol 2 terkunci permanen padahal prasyaratnya justru sudah terpenuhi.
- keputusan: `jobs._worker` menangkap `excel.AlreadyImported` **sebelum** penanganan error umum dan menutup run dengan status `skipped` + pesan `file sudah pernah diimport (import_id=N)`. HTTP tidak berubah: API tetap membalas `409` dengan `error.code=already_imported` dan `detail {import_id, sha256}`; CLI tetap menulis error ke stderr dengan exit 1. Kegagalan nyata (file rusak, sheet asing, 0 baris valid) tetap lewat jalur umum → `failed`.
- alternatif: (a) menandai `ok` → ditolak: tidak ada satu baris pun yang diimpor, klaim "berhasil" menyesatkan; (b) menambah kolom/kind baru → ditolak: enam kind baku sudah dibekukan §4.6 dan `skipped` sudah ada di daftar status §4.3; (c) menandai di lapisan API saja → ditolak: jalur CLI mencatat run yang sama dan harus konsisten (`jobs.execute` = jalur tunggal).
- dampak: tombol import tidak lagi terkunci setelah user memilih file yang sama; riwayat run di halaman Data membedakan "tidak perlu diulang" dari "gagal".

## ADR-034 — `data_status.range_from/range_to/range_label` (rentang yang benar-benar dipakai)
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/05` §0 menambah tiga field rentang supaya UI bisa menampilkan "diambil dari periode berapa sampai berapa" tanpa menebak; sebelumnya `data_status` hanya membawa `as_of`, sehingga halaman tidak punya cara membedakan satu hari (`d1`) dari minggu lengkap (`w1_fri`), dan label tanggal finansial akan disusun ulang di frontend (dilarang §5 butir 6).
- keputusan: `read.data_range()` + `read.range_label()` (satu helper, Bahasa Indonesia `d Mmm yyyy`) mengisi ketiganya dari `read.data_status()`, jadi semua endpoint yang sudah memakai `data_status` otomatis ikut. Aturan: `w1_fri` = Senin..Jumat minggu `as_of`; `w1` = Senin..hari bursa terakhir; `midday` = hari ini..hari ini; `d1` = satu hari `as_of`, **kecuali** endpoint memakai `window` untuk kolom return/ekor → `range_from` = bar terjauh yang dipakai kolom itu (`window_start`). `/heatmap` memakai `window="3m"` tetap karena kolomnya `1d,1w,1m,3m`; `/rotation/matrix` memakai `window` miliknya; `/stocks` (tanpa `window` per §2) tetap satu hari. `range_label` = `5–9 Okt 2026` (bulan sama), `15 Jul – 12 Okt 2026` (bulan beda), `30 Des 2025 – 2 Jan 2026` (tahun beda), `12 Okt 2026` (satu hari). Belum ada hasil hitung → ketiganya `null`. `data_status` ditambahkan ke `/heatmap`, `/rotation/matrix`, `/stocks/{ticker}` (tadinya tidak punya) dan `/series/sector/{code}` mendapat `range_from/range_to/range_label` (punya rentang sendiri, labelnya konsisten).
- alternatif: (a) menyusun label di frontend → ditolak: §5 butir 6 melarang frontend memformat ulang angka/tanggal finansial; (b) `w1`/`w1_fri` ikut `window` → ditolak: hasil mingguan hanya berlaku untuk minggunya, label 3 bulan akan menyesatkan (bukti gladi: `w1_fri&window=3m` harus tetap 5–9 Okt); (c) menambah endpoint rentang terpisah → ditolak: satu blok `data_status` sudah diambil semua halaman.
- dampak: frontend bisa menampilkan satu label rentang dari `data_status` untuk semua tabel/diagram. `d1` + `window` kini berbeda dari tabel §0 baris pertama (yang menyebut satu hari) — diselaraskan lewat catatan §0 sendiri ("kalau `window` dipakai untuk kolom return/ekor"), dan diuji `test_range_d1_ikut_window_untuk_kolom_return`.

## ADR-035 — `/weekly/picks` menambah `week_start` + `week_label` (api_version 1.1)
- tanggal: 2026-10-13
- status: diterima
- konteks: board mingguan (F9) hanya menerima `week_end`, sehingga label "5–9 Okt 2026" harus disusun frontend — dilarang §5 butir 6, dan Senin minggu itu tidak pernah terlihat user.
- keputusan: respons menambah `week_start` (Senin minggu `week_end`, `read.monday`) dan `week_label` (`read.range_label(week_start, week_end)`), `api_version` naik `1.0 → 1.1` (§6: penambahan field = minor). Kasus kosong (`week_end` null) mengirim ketiganya `null`.
- alternatif: membiarkan frontend menghitung Senin → ditolak: alasan yang sama dengan ADR-034.
- dampak: aditif, frontend lama tetap jalan. Dijaga `test_weekly_picks_week_start_dan_label` + `test_weekly_picks_kosong_tetap_punya_field_baru`.

## ADR-036 — `GET /meta/market`: kutipan IHSG (DB default, live opsional, cache TTL, fallback DB)
- tanggal: 2026-10-13
- status: diterima
- konteks: halaman Overview butuh kutipan IHSG yang dipoll berulang (interval dari config) tanpa memanggil `/briefing/morning` yang berat. `docs/05` §1 menambah endpoint ini bersama blok `config.market`; feed Yahoo untuk IDX selalu delay, dan tiap tab browser yang poll sendiri-sendiri akan membanjiri Yahoo.
- keputusan: endpoint baru di `api/meta.py` (`MARKET_API_VERSION = "1.1"`), **hanya** benchmark (`^JKSE`, tidak ada jalur kutipan live untuk emiten/sektor). `live=false` (default) membaca bar terakhir `price_daily` ticker `IHSG` (`source: "db"`); `live=true` mengambil bar `^JKSE` dari Yahoo (interval `1d`, ditambah satu panggilan `5m` **hanya** saat `session == "open"`), **tanpa menulis DB**, lalu disimpan di cache `config.market.live_ttl_seconds` → respons berikutnya `cached: true` + `cache_age_s` (helper `cache.put(ttl=...)`/`cache.age()`). `session` dari jam WIB (`open` 09:00–12:00 & 13:30–16:00 · `break` 12:00–13:30 · `closed`); `ret_intraday` = `close/prev_close − 1` hanya saat `open`, selain itu `null`. `delayed` selalu `true`. Fetch live gagal → `200` dengan nilai DB, `source: "db"`, `data_status.status: "stale"` + `detail: "live gagal, memakai data tersimpan"` (field `detail` ditambahkan ke `DataStatus`, default `null`). `config.market` dimuat sebagai model `MarketCfg` dan diekspos utuh di `/meta/config` supaya UI tidak menghardcode interval poll.
- alternatif: (a) menaruh kutipan live di `/briefing/morning` → ditolak: endpoint itu menyusun laporan pagi, bukan untuk poll 60 s; (b) menulis kutipan live ke `price_daily` → ditolak: menyentuh data hasil ingest resmi dari satu request baca, dan akan mengacaukan bar harian; (c) `ret_intraday` dihitung dari bar pembukaan hari itu → ditolak: definisi §1 adalah `close/prev_close − 1` (sama dengan `ret_1d` saat jam bursa) dan `null` di luar jam bursa; (d) `volume` 0 saat NaN → ditolak: konvensi "nilai tak tersedia = `null`".
- dampak: satu endpoint ringan untuk kartu Overview; N tab dalam TTL = 1 request ke Yahoo (dibuktikan `test_market_live_cache` + bukti curl: poll 1 5.543 ms, poll 2 4 ms `cached: true`). `last_bar_at` untuk `source: "db"` memakai penutupan sesi `16:00:00+07:00` hari bar itu karena `price_daily` hanya menyimpan tanggal.

## ADR-037 — `summary_lines` + `watchlist` di briefing: teks ringkas rule-based (tanpa LLM)
- tanggal: 2026-10-13
- status: diterima
- konteks: panel Ringkasan Pasar butuh kalimat siap tampil; menyusunnya di frontend dilarang (docs/05 §5 butir 6: frontend tidak menyusun kalimat finansial) dan memakai LLM tidak diinginkan (mahal, tidak deterministik, angka bisa salah kutip).
- keputusan: `api/briefing.py` menyusun `summary_lines` (3–6 kalimat, tiap kalimat ≤ 140 char, `read`-style template + `labels.format_id_number`/`quadrant_label`) dan `watchlist` (maks 3 kandidat `signal_weekly` terakhir: sektor dulu lalu saham, masing-masing urut skor menurun) **saat endpoint dipanggil** — tidak ada tabel/kolom baru, tidak disimpan. Susunan baku §3 dipenuhi berurutan: kondisi pasar + regime → sektor naik/turun teratas → perubahan kuadran → fokus mingguan + streak → catatan data; bagian tanpa isi dilewati, dan kalimat dipotong ke 140 char sebagai jaring terakhir. Angka jadi: `format_id_number` + tanda `+/−`, sehingga "1,8%" dan "4.250" konsisten dengan sisa API. Tanpa istilah mentah: `quadrant_label()` menerjemahkan `leading/improving/…` → `Memimpin/Membaik/…` dan kata "kekuatan relatif" dipakai sebagai ganti "RS-Ratio". `watchlist.reason` menyebut streak, kuadran, atau level `entry`/`stop`. `move_flat_pct` (config) menentukan kata "datar" vs "naik/turun". Kandidat yang lebih baru dari `as_of` tidak ikut (briefing = "per tanggal itu"), sehingga `?as_of=<sebelum sinyal terakhir>` menghasilkan `watchlist: []`.
- alternatif: (a) menyimpan hasilnya di tabel → ditolak: murni turunan dan murah dihitung ulang (docs/05 §3 melarang tabel baru); (b) memakai LLM untuk kalimatnya → ditolak: tidak deterministik, angka bisa salah, dan endpoint harus tetap jalan offline; (c) memakai `watch[]` mentah sebagai kalimat → ditolak: pesannya berisi penanda markdown dan tidak berurutan sesuai §3.
- dampak: `/briefing/morning` tetap 200 walau stale/partial; belum ada hasil hitung (`as_of` null) → `summary_lines: []` + `watchlist: []`. Bukti nyata ada di `docs/evidence/briefing/DIGEST.md` (4 kalimat, maks 109 char; watchlist 1 sektor; simulasi `as_of=2025-06-30` → watchlist `[]`). Sekalian diperbaiki: pesan `watch` midday tidak lagi menulis "bar terakhir belum ada bar" saat belum ada bar (kini sesuai contoh `docs/05` §3).

## ADR-005 — Git: satu task = satu commit, repo lokal dulu
- tanggal: 2026-10-12
- status: diterima
- konteks: dua agen (backend & frontend) bekerja di repo yang sama dari dua window berbeda; riwayat perlu bisa diaudit per task.
- keputusan: `git init` di root repo, branch `main`. Format pesan `<TASK-ID>: <ringkasan>` (`B0: ...`, `F4: ...`), atau `docs:`/`fix:`/`chore:` untuk non-task. Setiap task di `docs/PROGRESS.md` = tepat satu commit.
- alternatif: commit bebas tanpa kaitan task — ditolak: sulit tahu task mana yang sudah benar-benar selesai dan mana yang belum.
- dampak: `docs/PROGRESS.md` + `docs/DECISIONS.md` ikut dalam commit task (bukan commit terpisah), supaya bukti dan kode selalu sejalan. Tidak ada remote di v1; `git push` hanya kalau user meminta.

## ADR-003 — SQLite via `sqlite3` stdlib, tanpa SQLAlchemy
- tanggal: 2026-10-12
- status: diterima
- konteks: aplikasi single-user lokal, satu file DB.
- keputusan: SQL biasa + helper di `db.py`, migrasi file `.sql` bernomor.
- alternatif: SQLAlchemy + Alembic — dukungan ORM/migrasi tidak sepadan untuk 1 pengguna.
- dampak: disiplin manual pada SQL & parameter binding; tidak ada auto-migrate saat model berubah.

## ADR-008 — Token `--fg-faint` disesuaikan agar lolos AA (light 0,64 → 0,54 · dark 0,56 → 0,62)
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/06` §2 menetapkan `--fg-faint`, §4 mewajibkan nilai `null` ditampilkan `—` dengan warna itu, dan §9 nomor 3 mewajibkan axe 0 violation WCAG2AA di kedua tema. Diukur nyata (canvas → luminansi WCAG): nilai dokumen = **3,37:1** (light, di atas `--surface`) dan **3,68:1** (dark) — di bawah 4,5:1, jadi `—` di tabel akan selalu memicu violation.
- keputusan: nilai token diubah jadi `oklch(0.54 0.008 255)` (light) dan `oklch(0.62 0.01 260)` (dark) → terukur **5,05 / 4,62** (light: surface / bg-subtle) dan **4,68 / 4,92** (dark). Tidak ada perubahan lain pada token.
- alternatif: (a) mengecualikan `--fg-faint` dari teks & mengganti `—` ke `--fg-muted` → ditolak: `docs/06` §4 eksplisit meminta `--fg-faint`, dan tampilan akan kehilangan pembedaan tier; (b) membiarkan & menonaktifkan rule `color-contrast` saat axe → ditolak: itu menghapus alat ukurnya, bukan masalahnya.
- dampak: light `--fg-faint` (0,54) jadi berdekatan dengan `--fg-muted` (0,50) — pembedaan tier tipis tapi tetap ada; kalau nanti terasa kurang jelas, `--fg-muted` boleh dinaikkan (bukan `--fg-faint` diturunkan, itu akan melanggar AA lagi). Dipakai sampai ada tes axe nyata di F11.

## ADR-009 — Rute & menu frontend: 5 halaman, `Sektor` = `/sectors`
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/06` §5 menyebut sidebar 5 menu (Overview, Sektor, Saham, Weekly, Status) dan §10 menyebut 5 nama halaman, tapi tidak ada satu pun daftar path. `docs/08` F7 menaruh detail sektor di **drawer** (`?sector=IDXFINANCE`), F8 menyebut dua path yang eksplisit (`/stocks`, `/stocks/{ticker}`).
- keputusan: `/` Overview · `/sectors` Sektor · `/stocks` Saham · `/weekly` Weekly · `/status` Status; `*` → redirect `/`. Halaman `/stocks/{ticker}` (F8) belum dibuat di F0. Menu aktif memakai pencocokan prefix supaya `Saham` tetap aktif di `/stocks/BBRI`.
- alternatif: (a) tanpa menu Sektor terpisah (semua lewat drawer) → ditolak: `docs/06` §5 meminta 5 menu; (b) `/sector/{code}` sebagai halaman penuh → ditolak dulu: F7 belum menetapkan bentuk halaman penuh, dan drawer sudah mengangkat state ke URL.
- dampak: `/sectors` sekarang masih placeholder; kalau F7 cukup dengan drawer, halaman itu bisa jadi daftar sektor sederhana atau dikosongkan — keputusannya diambil saat F7.

## ADR-010 — Warna sektor: token tema, bukan `color_hex` dari API
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/06` §3 memberi 11 warna sektor dengan hex **berbeda per tema** (light & dark), sementara `docs/05` mengirim `color_hex` di payload (`meta/sectors`, `rrg`, `sectors/summary`) — nilainya contoh dan tidak bisa ikut berubah saat tema berganti.
- keputusan: warna sektor hidup sebagai token `--sector-*` di `src/styles/tokens.css` (dua tema, sudah ditulis di F0); komponen memakai tokennya. `color_hex` dari API hanya dipakai sebagai fallback bila kode sektor tidak dikenal token (belum ada di F0).
- alternatif: pakai `color_hex` mentah dari API di inline style → ditolak: satu tema saja, dan justru bagian dari masalah asli; menambah `color_hex_dark` ke API → ditolak: mengubah kontrak v1 untuk hal yang sudah selesai di CSS.
- dampak: `color_hex` tetap ada di tipe TS (sesuai kontrak, tidak dihapus) tapi bukan sumber warna utama; kalau nanti muncul sektor ke-12 dari backend, ia tampil dengan `color_hex` sampai token ditambahkan.

## ADR-013 — Halaman Status butuh `/admin/*`, padahal `docs/05` §5.1 melarangnya
- tanggal: 2026-10-13
- status: **digantikan** — `docs/05` §4 & §5.1 direvisi (endpoint admin kini resmi dipanggil UI untuk halaman Data/F12), jadi larangan yang jadi dasar ADR ini sudah hilang
- konteks: `docs/08` F10 meminta halaman `/status` menampilkan **daftar `ingest_run`** dan tombol **"Jalankan midday sekarang"** (`POST /api/v1/admin/midday` bila `api_key` kosong). `docs/05` §5.1 menulis tegas: "Frontend hanya memanggil endpoint §1–§3. Tidak ada `/admin/*`", dan §4 hanya menyebut `GET /api/v1/admin/runs` **tanpa bentuk field**-nya. F1 tidak menambah tipe admin sama sekali — menebak bentuk field akan melanggar aturan "jangan mengarang bentuk baru".
- keputusan (historis, F1): lanjut tanpa tipe/hook admin.
- resolusi: revisi dokumen memilih arah (b) — §5.1 sekarang berbunyi "Frontend memanggil §1–§3 untuk **membaca**, dan §4 untuk **memicu pipeline** (halaman Data)", bentuk `ingest_run` ditulis di `docs/05` §4.3 (`run_id, kind, status, phase, rows, rows_total, percent, message, failed_tickers`), plus aturan async `?async=true` → `202 {run_id}` → poll `GET /admin/runs/{run_id}` tiap 1 s, dan `403`/`409` dengan kode prasyarat (`prereq_no_universe`, `prereq_no_prices`, `gate_weekly_not_final`, `gate_midday_stale`).
- dampak: tipe + `startRun` + `useRun` (polling) untuk §4 **belum ada** di F1 — itu masuk task **F12** (`docs/08`), bukan ditambahkan diam-diam ke F1 yang sudah di-commit. Halaman Status (F10) tinggal memakai `GET /admin/runs?limit=20` yang bentuknya kini resmi.

## ADR-014 — `ret_positive_only`: filter ada di `docs/06` §7, param-nya tidak ada di `docs/05`
- tanggal: 2026-10-13
- status: **selesai** — `docs/05` §2 direvisi: `ret_positive_only` (bool, default `false`) kini resmi di `/sectors/summary` dan `/stocks`
- konteks: daftar filter `docs/06` §7 memuat `ret_positive_only` (toggle, default off), tapi tidak satu pun endpoint `docs/05` §2 punya param itu.
- keputusan (saat itu): filter dibaca dari URL (`lib/urlFilters.ts`), dikirim sebagai `ret_positive_only=1`, backend boleh mengabaikannya; kontrol UI-nya belum dibuat.
- resolusi: tipe `SectorSummaryParams`/`StocksParams` dan mock MSW sudah menerimanya. Untuk `/sectors/summary` acuannya = kolom return jendela aktif (`window=1w→ret_1w`, `1m→ret_1m`, `3m→ret_3m`, `6m→ret_6m`, `ytd→ret_ytd`; `1y` tidak punya kolom → filter diabaikan). Diukur di mock: 11 sektor → 8 (window 3m) → 6 (window 1w); 30 saham → 22.
- dampak: kontrol toggle-nya dibuat di F5 (sekarang aman ditampilkan). Sisa ambiguitas untuk `/stocks` (tidak ada param `window`, jadi "jendela aktif" tidak terdefinisi) dicatat sebagai blocker #13.

## ADR-015 — Parameter multi-nilai dikirim koma-separated, bukan diulang
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/05` §5 mencontohkan URL `?timeframe=w1_fri&window=3m&quadrant=leading,improving&min_streak=2&sort=score`, sementara §27 menulis `sector` "boleh diulang" — dua bentuk berbeda untuk hal yang sama.
- keputusan: frontend selalu mengirim satu param koma-separated (`quadrant=leading%2Cimproving`, `sector=IDXFINANCE,IDXENERGY`) lewat satu fungsi `toSearchParams` (`src/lib/api.ts`). URL jadi shareable seperti contoh dokumen dan hanya ada satu bentuk kode di frontend.
- alternatif: mengirim param berulang (`sector=A&sector=B`) — bentuk yang dipakai FastAPI `Query(List[str])` bawaan, tapi tidak cocok dengan contoh URL di `docs/05` §5 dan membuat `lib/urlFilters` harus tahu daftar param yang multi.
- dampak: **backend wajib memecah nilai berdasarkan koma** untuk `sector`, `quadrant` (dan param multi lain) — `Query(List[str])` bawaan FastAPI akan menganggap `"leading,improving"` sebagai satu nilai dan mengembalikan 0 baris. Kalau backend memilih bentuk berulang, yang berubah hanya `toSearchParams` (satu fungsi) + test-nya.
- catatan 2026-10-13: `docs/05` §0 lalu menetapkan **kedua bentuk wajib jalan** — frontend tetap mengirim bentuk koma (tidak berubah), backend menerima dua-duanya.

## ADR-016 — Nama `run.kind` dan amplop `GET /admin/runs` (kontrak belum menetapkannya)
- tanggal: 2026-10-13
- status: usul (backend harus menyesuaikan; UI sudah jalan dengan nilai ini)
- konteks: `docs/05` §4.3 hanya memberi satu contoh: `"kind": "prices_daily"`. Enam tombol `docs/05` §4.1 butuh nama kind yang stabil supaya halaman Data bisa menampilkan chip status ("belum pernah / terakhir ok …") dan menentukan prasyarat; amplop `GET /api/v1/admin/runs` juga tidak ditulis (hanya "daftar `ingest_run`"), sementara konvensi dokumen lain campur (`items` untuk meta/stocks, `sectors`/`stocks` untuk weekly).
- keputusan: `kind` = `import_excel` · `prices_daily` · `prices_intraday` · `compute_all` · `compute_signals` · `midday` (`src/lib/pipeline.ts` → `RUN_KIND`). Amplop daftar = `{ api_version, runs: [...] }` (sejajar dengan `{ api_version, run }` di §4.3), tiap elemen satu objek `IngestRun` dengan kolom §4.3.
- alternatif: mencocokkan kind dengan `startsWith` (mis. `prices*`) supaya tahan perubahan nama — ditolak: chip status jadi tidak bisa membedakan `prices_daily` vs `prices_intraday`, dan menyembunyikan ketidaksepakatan dengan backend; menebak amplop `items` — ditolak karena §4.3 memakai nama domain (`run`), bukan `items`.
- dampak: kalau backend memakai nama/amplop lain, halaman Data **tidak error** tapi chip selalu "belum pernah" dan tabel riwayat kosong — dua gejala itu jadi penanda mismatch (blocker #10 & #11). Perbaikan hanya di dua tempat: `RUN_KIND` dan `useRuns`.

## ADR-017 — Prasyarat tombol disimpulkan dari riwayat run; `Data` jadi menu ke-6
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/05` §4.1 mewajibkan tombol 2–6 terkunci dengan alasan yang bisa dibaca user, tapi kontrak tidak punya endpoint "status prasyarat" (apakah universe ada, apakah `price_daily` terisi). Menaruh tombol Data di sidebar berarti 6 menu, sedangkan `docs/06` §5 menulis 5 menu.
- keputusan: (a) prasyarat dihitung di frontend dari **riwayat run** `GET /admin/runs` — tombol 2/3 aktif setelah ada run `import_excel` berstatus `ok|partial`, tombol 4/5/6 setelah ada `prices_daily` `ok|partial`; backend tetap penjaga terakhir dan membalas `409` kalau UI keliru; (b) menu `Data` (ikon `Database`) ditambahkan sebagai item ke-6 di sidebar dengan route `/data`.
- alternatif: (a) memakai `meta/sectors` (`constituents_active > 0`) sebagai penanda universe — ditolak karena dengan DB kosong mock/fixture tetap melaporkan angka, jadi AC "DB kosong → semua terkunci" tidak bisa diuji; menambah endpoint status prasyarat — ditolak: kontrak baru untuk 3 kondisi; (b) menyembunyikan halaman Data di balik `/status` — ditolak: `AGENTS.md` rule 10 menyebut halaman Data sebagai pintu masuk user, harus terlihat.
- dampak: kalau `ingest_run` pernah dipangkas (retensi) tapi data masih ada, tombol bisa terkunci keliru — backend tetap menolak/menerima dengan benar, jadi hanya UX yang lebih konservatif. `docs/06` §5 perlu diperbarui (5 → 6 menu) saat F11 merapikan dokumen. `src/lib/format.ts` juga sudah dibuat sebagian di F12 (`formatDateTime`, `formatTime`, `formatDuration`) dan F3 tinggal menambahkan `formatRp`/`formatPct`/`formatNum` di file yang sama.

## ADR-019 — Ambang anti-tumpuk label diukur dalam pixel layar, dan yang dibandingkan kotak label
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/06` §6 menulis label tidak boleh bertumpuk dengan ambang "24 px". Chart digambar dengan `viewBox` tetap (780 × 608) lalu diskalakan ke lebar container, jadi 24 px layar ≠ 24 satuan viewBox: pada 640 px satu satuan viewBox hanya ≈ 0,82 px, sehingga label yang "aman" di 1280 px bisa bertumpuk di 640 px. Uji kotak DOM nyata (Playwright, 1280 px) juga menunjukkan ambang berbasis **jarak titik** masih meloloskan tumpang-tindih: label `Kesehatan` dan `Properti & Real Estat` bertumpuk walau titiknya 30 unit terpisah, karena label digambar ke kanan titik dan lebarnya ikut panjang nama.
- keputusan: (a) `labelledRefIds` menerima ambang dalam satuan viewBox hasil konversi `24 / (lebar_render_px / 780)`; chart mengukur lebar container lewat `ResizeObserver` dan menghitung ulang saat berubah (bukan sekali saat mount). (b) Yang diuji-tumpang adalah **kotak label** (`x + 11`, lebar ≈ `panjang teks × 6,4` satuan, tinggi 14 satuan) yang dilebihkan setengah ambang di tiap sisi, bukan jarak antar titik. (c) Perkiraan lebar karakter bukan sumber kebenaran: `e2e/rrg.spec.ts` mengukur `getBoundingClientRect()` semua label pada dua lebar layar dan merah kalau ada yang bertumpuk.
- alternatif: menaikkan ambang titik jadi nilai besar (ditolak: membuang label yang sebenarnya aman, dan tetap tidak menangani nama panjang); mengukur lebar teks nyata per label dengan `getBBox()` (ditolak: butuh render dua tahap + state tambahan — `shortcut: lebar karakter diperkirakan 6,4 satuan, naikkan ke getBBox kalau masih ada label bertumpuk`); menyembunyikan semua label di layar sempit (ditolak: docs/06 §6 meminta label tetap terbaca).
- dampak: `MIN_LABEL_DISTANCE` (satuan viewBox) diganti `MIN_LABEL_DISTANCE_PX` — konstanta lama tidak lagi dipakai; label di layar sempit jadi lebih sedikit (11 → 6 label pada 640 px untuk 11 sektor), dan itu memang perilaku yang diinginkan.

## ADR-020 — Panel riwayat run jadi komponen bersama; `/status` ikut menampilkan `daily_ingest`
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/08` F10 meminta tabel `ingest_run` di `/status` dengan catatan "komponen boleh dipakai ulang dari F12", sementara tabel itu sudah ada di dalam `DataPage.tsx`; dua sesi (backend & frontend) bekerja di repo yang sama, jadi menyalin panel berarti dua tempat yang harus diubah bersamaan. F10 juga tidak menyebut `daily_ingest`, padahal `GET /freshness` mengirimkannya bersama gate.
- keputusan: (a) panel riwayat diekstrak ke `components/domain/RunHistory.tsx` — satu implementasi, dipakai `/data` dan `/status`; teks bakunya (`Belum ada run. Jalankan langkah 1 untuk mulai.`, caption tabel, catatan `20 terakhir`) **tidak diubah** supaya smoke test F12 tetap sah; (b) detail run bisa dibuka lewat klik **baris** (sesuai F10) **dan** lewat tombol `Detail` yang sudah ada — `<tr>` tidak bisa difokuskan keyboard, dan klik tombol menghentikan propagasi supaya tidak dobel; (c) `/status` menampilkan satu baris `daily_ingest` (status + `last_data_at`) di panel gate, karena itu bagian \"kesegaran data\" dan endpoint-nya sudah dipanggil.
- alternatif: menyalin tabel ke `StatusPage` (ditolak: dokumen melarang dua implementasi dan setiap perubahan kolom jadi dua pekerjaan); memberi `tabIndex`/`role` pada `<tr>` supaya baris bisa difokuskan (ditolak: merusak struktur tabel & membingungkan pembaca layar); memakai `Drawer` untuk detail run (ditolak: bukan permintaan, dan F12 sudah punya pola baris melebar).
- dampak: `RunHistory` kini milik bersama — perubahan kolom menyentuh `/data` dan `/status` sekaligus. Kalau `daily_ingest` nanti dihapus dari `GET /freshness`, barisnya hilang tanpa error (jalur `null` sudah diuji di `runStatus.test.ts`).

## ADR-034 — Kontras token tema terang dibetulkan (docs/06 §2 dikoreksi, bukan cuma dilaporkan)
- tanggal: 2026-10-13
- status: diterima
- konteks: axe (WCAG 2 A/AA) di F11 menemukan `color-contrast` di tema terang: `--up` `oklch(0.56 0.14 152)` = **4,36:1** di `--surface` (3,98:1 di `--bg-subtle`, 3,76:1 di `--accent-subtle` untuk baris terpilih) dan `--warn` `oklch(0.68 0.14 75)` = **2,95:1**; teks tabel 12–13 px butuh 4,5:1. Kena ±60 sel di `/sectors`, `/stocks`, `/stocks/{ticker}` dan 5 baris alasan di `/data`. Tema gelap sudah lolos (`--up` 7,33:1, `--warn` 8,40:1).
- keputusan: nilai terang `--up` → `oklch(0.50 0.14 152)` (5,57:1 di `--surface`, terendah 4,80:1 di `--accent-subtle`) dan `--warn` → `oklch(0.52 0.15 75)` (5,62:1, terendah 4,84:1). Hue & chroma tidak diubah supaya artinya tetap (hijau = naik, amber = perhatian); nilai lama dicatat di komentar `tokens.css` dan blok `docs/06` §2.
- alternatif: memakai nilai tema gelap di tema terang (ditolak: bertabrakan dengan latar putih); memberi latar chip di belakang angka (ditolak: mengubah tabel yang sudah disetujui wireframe); mematikan rule `color-contrast` di axe (ditolak: menyembunyikan masalah nyata).
- dampak: sel heatmap (memakai `--up`/`--down` dengan alpha 0,08–0,55) jadi sedikit lebih pekat di tema terang. `--down` (5,30:1), `--info`, dan `--fg-faint` tidak disentuh karena tidak ada temuan. Kalau nanti `--up` dipakai sebagai latar penuh (bukan teks), nilai baru ini lebih gelap dari wireframe.

## ADR-035 — MSW hanya untuk dev; build produksi tidak membawa worker-nya
- tanggal: 2026-10-13
- status: diterima
- konteks: `src/mocks/browser.ts` sudah di-import dinamis dan dijaga `import.meta.env.DEV`, tapi `public/mockServiceWorker.js` tetap disalin Vite ke `dist/` (perilaku `publicDir`), jadi hasil build membawa berkas worker yang tidak pernah didaftarkan.
- keputusan: `build.copyPublicDir: false` di `vite.config.ts` — berkas `public/` hanya untuk dev (dev server tetap menyajikan `/mockServiceWorker.js`). Menjalankan mode nyata = `npm run dev:real` (`vite --mode real`; `.env.real` berisi `VITE_MOCKS=off`) supaya perintahnya sama di PowerShell, cmd, dan bash tanpa dependency `cross-env`.
- alternatif: plugin build yang menghapus berkas itu sesudah build (ditolak: kode tambahan untuk berkas mati 12 kB); menambah `cross-env` (ditolak: `--mode` sudah cukup); membiarkannya di `dist/` (ditolak: mengaburkan janji "produksi tanpa mock").
- dampak: **kalau ada berkas lain ditaruh di `public/`** (favicon, `robots.txt`) berkas itu tidak akan ikut ke `dist/` lagi — harus lewat `import` dari `src/assets/` atau `copyPublicDir` diaktifkan kembali dengan pengecualian manual. Sekarang `public/` hanya berisi worker MSW.

## ADR-036 — Patch filter dibaca dari URL live; nilainya boleh fungsi dari state terbaru
- tanggal: 2026-10-13
- status: diterima
- konteks: dua klik cepat pada header urut yang sama tidak membalik arah. Dibuktikan nyata di F11: `npx playwright test e2e/sector-table.spec.ts --workers=1 --repeat-each=3` gagal 2/3, dan probe cepat (dua klik beruntun) salah **3/3** sedangkan jeda 500 ms selalu benar → bukan flake test. Sebabnya: `setFilters` dan nilai `next` (`nextSort`) dihitung dari `searchParams`/props render terakhir, sementara navigasi react-router berjalan di dalam `startTransition` sehingga URL berubah lebih dulu daripada props baru sampai ke komponen.
- keputusan: `useFilterState.setFilters` membaca state acuan dari `window.location.search` (bukan `searchParams`) dan menerima `Partial<FilterState>` **atau** `(prev) => Partial<FilterState>`; konsumen yang menurunkan nilai dari filter sekarang (arah urut `SectorTable`/`StockTable`, toggle kuadran & sektor `FilterBar`) memakai bentuk fungsi; tabel menyerahkan **kolom** yang diklik (`onSort(column)`) supaya perhitungan terjadi saat klik, bukan saat render.
- alternatif: `retries` di Playwright (ditolak: menyembunyikan bug); menambah jeda di test (ditolak: menyembunyikan bug, user tetap kena kalau klik cepat); state filter di context/zustand (ditolak: melanggar docs/08 aturan 4 — filter harus di URL).
- dampak: penulis berikutnya **wajib** memakai bentuk fungsi untuk patch yang bergantung pada filter sebelumnya; patch mutlak (`{ sector: [code] }`, `preset.patch`, `{ offset }`) tetap bentuk objek. E2e baru: `e2e/keyboard.spec.ts` menguji Enter dua kali beruntun di header.

## ADR-037 — Prasyarat tombol pipeline dibaca dari DATA, bukan dari riwayat run
- tanggal: 2026-10-13
- status: diterima (menggantikan separuh ADR-017)
- konteks: `lockReason` (ADR-017) menyimpulkan prasyarat dari riwayat run (`hasSucceeded`), sehingga satu run `failed`/`skipped` mengunci tombol **padahal datanya sudah ada** — dan sebaliknya, DB yang sudah berisi data tetap terkunci kalau `ingest_run` baru saja dipangkas retensi. Keluhan nyata: mengimpor file yang sama dua kali (409) membuat tombol 2 mati meski universe ada.
- keputusan: (a) prasyarat turun dari **data**: tombol 1 selalu aktif · tombol 2/3 = Σ `constituents_active` dari `GET /meta/sectors` > 0 (`constituents_active` tetap dipakai juga untuk dialog konfirmasi tombol 2, seperti sebelumnya) · tombol 4/5/6 = `last_ingest.prices_daily` dari `GET /meta/config` ≠ `null`; data yang belum terbaca (`null`) = terkunci (konservatif, pesannya sama dengan sebelumnya). (b) Riwayat run **hanya** untuk chip status (`statusChip`). (c) `hasSucceeded` tetap ada dan diperbaiki agar `ok|partial|skipped` dihitung "data sudah masuk" (`partial` disertakan karena barisnya memang masuk; `skipped` = tidak ada lagi yang perlu dikerjakan) — sekarang hanya dipakai test, tidak ada pemanggil di aplikasi. (d) Gate `w1_fri`/`midday` **tidak** diduplikasi di UI: backend tetap penjaga terakhir (`409`/`200 stale`).
- alternatif: (a) memakai endpoint status prasyarat baru → ditolak: menambah kontrak untuk tiga kondisi yang bisa dibaca dari dua respons yang sudah diambil halaman Data; (b) menambah `partial`/`skipped` saja tanpa memindahkan sumber kebenaran → ditolak: tidak menyelesaikan kasus `ingest_run` terpangkas, dan tetap ada dua sumber yang bisa berbeda.
- dampak: `lockReason(step, data)` berubah tanda tangan (`PrereqState`) — pemanggil lama (riwayat run) hilang. Mock MSW dapat knob `?mock=empty` (universe kosong + `last_ingest` null) supaya AC "DB kosong → semua terkunci" tetap bisa diuji, dan `e2e/smoke.spec.ts` diperbarui (sebelumnya mengandalkan `runs: []` = terkunci). Backend/Mock tetap menolak `409 prereq_*` bila UI keliru.

## ADR-038 — Label periode: `window_range_label` masih USUL, dan `/weekly` memakai `week_label`
- tanggal: 2026-10-13
- status: usul (satu field) / diterima (sisanya)
- konteks: `docs/08` F13 C meminta label `Mingguan (Sen–Jum) · 5–9 Okt 2026 · jendela 3 bln (15 Jul – 12 Okt 2026)`. `docs/05` §1 hanya punya **satu** rangkaian `range_from/range_to/range_label` (ADR-034), sedangkan bentuk yang diminta memuat **dua** rentang: periode timeframe (mis. `5–9 Okt 2026`) dan rentang jendela (`15 Jul – 12 Okt 2026`).
- keputusan: (a) `range_label` = rentang periode timeframe (dipakai apa adanya); (b) bagian `jendela … (…)` memakai field **baru** `data_status.window_range_label` yang **belum dikirim backend** — UI menampilkan kurungnya hanya bila field itu ada, jadi hari ini label di backend nyata berbunyi `… · jendela 3 bln` tanpa kurung (tanpa error, tanpa tebakan). Mock MSW sudah mengirimnya (mock berperan backend) supaya bentuk penuh bisa diuji & di-screenshot. (c) `/weekly` memakai `week_label` dari `/weekly/picks` (ADR-035) apa adanya; `week_start`/`week_end` hanya cadangan bila label kosong. (d) `market.poll_seconds` di `/meta/config` sudah ada di backend (ADR-036) walau contoh JSON `docs/05` §1 belum menampilkannya — contohnya perlu ditambahi.
- alternatif: (a) menyusun rentang jendela di frontend dari `range_from`/`range_to` + `window` → ditolak: `docs/05` §5 butir 6 melarang frontend menyusun rentang tanggal finansial; (b) memakai `range_label` untuk jendela dan `as_of` untuk periode → ditolak: kontrak bilang `range_label` = periode yang dipakai hitungan (`w1_fri` = Senin..Jumat), sedangkan jendela hanya panjang ekor/kolom return; (c) menghilangkan bagian jendela sama sekali → ditolak: `docs/08` F13 C memintanya eksplisit.
- dampak: **backend perlu menambah `window_range_label`** (+ contohnya di `docs/05` §1) kalau kurung jendela ingin muncul di aplikasi nyata; sampai itu, UI tetap benar dan tidak error. Di frontend, `lib/period.ts` satu-satunya tempat label dirakit (`periodLabel`, `periodFromStatus`, `weeklyPeriodLabel`, `runPeriodLabel`).
- catatan F13c: kartu IHSG membaca `market.poll_seconds` dari `/meta/config` **apa adanya** (lantai 1 s hanya penjaga salah konfigurasi, bukan kebijakan baru) — mock dev menurunkannya ke 1 s lewat knob `?mock=fast|down` supaya dua poll bisa diamati dalam test; di backend nyata nilainya 60 s. Contoh JSON `docs/05` §1 untuk `/meta/config` belum memuat blok `market` (backend sudah mengirimnya) → contohnya perlu ditambahi.

## ADR-039 — Chip kuadran saham `SectorDrawer` = state lokal, bukan URL
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/06` §6.4 (F14) meminta baris chip kuadran **saham** di dalam `SectorDrawer`, sementara `docs/06` §7 sudah memakai `?quadrant=` untuk filter kuadran **sektor** halaman (`FilterBar` + `useFilterState`). Satu kunci URL dengan dua arti berbeda (sektor vs saham dari satu sektor) membuat URL shareable menyesatkan: membuka `?sector=IDXFINANCE&quadrant=lagging` tidak bisa dibedakan mana yang dimaksud.
- keputusan: chip kuadran saham disimpan sebagai `useState` di `SectorDrawer` (sama seperti `sort`/`dir` yang memang sudah lokal di sana) dan **tidak** ditulis ke URL. Angka tiap chip dibaca dari `rrg.data.quadrants` + `rrg.data.items.length` (respons `/rrg` yang memang sudah diambil drawer, tanpa permintaan baru); penyaringan titik memakai fungsi murni `filterByQuadrant()` di `lib/quadrant.ts` (bukan `lib/rrgChart.ts`, supaya F14 tidak bentrok berkas dengan F15/F16), sedangkan tabel konstituen mengirim `quadrant=` ke `GET /stocks` (bukan menyaring 20 baris yang sudah diunduh). `as_of` dari `AsOfPicker` kini dikirim ke **kedua** query (chart & tabel) supaya tidak ada dua tanggal berbeda di satu layar.
- alternatif: (a) memakai `?quadrant=` dan berbagi dengan `FilterBar` → ditolak: satu param dua arti, dan filter halaman akan ikut berubah saat user mengintip satu kuadran di drawer; (b) kunci baru `?stock_quadrant=` → ditolak: menambah permukaan URL untuk state yang memang sementara/eksploratif (dan `docs/06` §6.4 menyebutnya lokal); (c) menyaring di frontend dari baris yang sudah diunduh → ditolak: `total`/paginasi `/stocks` jadi salah.
- dampak: menutup lalu membuka kembali drawer **mempertahankan** pilihan chip (komponen tidak di-unmount, state ikut hidup) — diuji e2e; state hilang saat halaman di-reload, dan itu disengaja. Kalau nanti filter kuadran saham perlu di-share lewat URL, tambahkan kunci eksplisit + ADR baru, jangan pinjam `quadrant`.

## ADR-041 — Kartu hover RRG: sisi dicari, dan "flip" tidak boleh berakhir di atas ekor
- tanggal: 2026-10-13
- status: diterima (menyimpulkan `docs/06` §6.3)
- konteks: `docs/06` §6.3 meminta kartu `PointCard` (lebar `w-60` = 240 px) tidak menutupi ekor & arah gerak titik, dan menyebut "kalau sisi pilihan tidak cukup ruang → flip ke sisi seberang pada sumbu itu". Versi pertama implementasi itu diterapkan harfiah. Hasil pengukuran DOM: untuk titik yang mentok tepi (mis. IDXENERGY di kiri-bawah dengan ekor dari kanan-atas) sisi "searah gerak" tidak muat di dalam kotak chart, flip mendaratkan kartu **tepat di atas ekornya sendiri** — persis yang dilarang kalimat pertama §6.3.
- keputusan: `cardPlacement()` mengevaluasi **empat** kandidat sisi (urut: searah gerak → tegak lurus → seberang, berbasis dot vektor `tail[-2] → tail[-1]`), menjepit setiap kandidat ke dalam kotak chart (margin 8 px), lalu memilih kandidat yang (a) tidak menutupi titiknya sendiri, (b) paling sedikit menyentuh segmen ekor; kandidat "searah gerak" hanya menang kalau irisan ekornya sama-sama 0. Ukuran kartu & skala chart diukur dari DOM (`useLayoutEffect` + `ResizeObserver`, px → satuan viewBox) supaya keputusannya memakai angka nyata, bukan taksiran.
- alternatif: (a) offset tetap `+12px`/`-50%` seperti sebelumnya → ditolak: itulah bug yang dilaporkan (selalu menutupi ekor di salah satu sisi); (b) flip buta ke sisi seberang → ditolak: terbukti mendarat di atas ekor untuk titik tepi; (c) membiarkan kartu keluar kotak chart agar selalu ada sisi bebas ekor → ditolak: melanggar "jarak tepi minimal 8 px" di §6.3 yang sama, dan kartu akan menutupi panel tetangga.
- dampak (F15b, dikoreksi): definisi "tidak menutupi" dipersempit ke **titik aktif, ekor titik aktif, dan label titik aktif** (docs/06 §6.3 + docs/08 F15 AC3) — irisan dengan ekor titik **lain** boleh karena mode fokus §6.1 sudah meredupkannya ke 0,18. Dengan definisi itu dan dua perubahan yang diizinkan (kartu 240 → **200 px** `w-50`, plus jarak ekstra di sisi kanan sepanjang lebar label titik), hasil terukur di DOM pada 11 titik sektor: **label titik aktif bersih 11/11**, **ekor titik sendiri bersih 7/11** (sebelum: 5/11 pada kartu 240 px). Sisa 4 titik (IDXFINANCE 2 segmen, IDXINDUST 1, IDXBASIC 1, IDXENERGY 2) mentok tepi: kartu masih lebih lebar daripada jarak titik ke tepi chart, dan keempat sisi + keempat kombinasi penjepitan sudah dicoba — lever "kecilkan kartu" sudah dipakai sampai batas yang diminta, perlebar chart/keluar kotak tidak dipakai. Angka ini dicetak oleh `e2e/rrg-card-placement.spec.ts` (dua kolom: ekor sendiri vs ekor lain).

## ADR-040 — Harga entry TA = `open` yang sudah diskalakan ke kerangka `adj_close`
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/03` §10 membuka dengan "semua harga di bagian ini **`adj_close`**", tetapi §10.3 meminta entry = harga `open` hari D+1. Di DB nyata `price_daily.open` **mentah** (ingest memakai `auto_adjust=False`, docs/02 §1) sementara `adj_close` sudah disesuaikan aksi korporasi. Versi pertama memakai `open` mentah → entry `open` 3.880 dibagi `adj_close` 3.663 (BBRI 2026-02-23) memberi "rugi" −5,6% di **hari entry**: seluruh 7 event BBRI varian `filter_on` tercatat `loss` `periods 0`, dan `win_rate` run uji jatuh ke 0,3072 padahal setelah diperbaiki 0,5148. Bukti: `docs/evidence/b17/DIGEST.md` §7.
- keputusan: harga eksekusi = `open × adj_close / close` untuk bar yang sama (`load_bars()` di `compute/ta.py`), `entry_basis` tetap `"open"`; kalau `open`/`close` NULL → `entry_basis` `"adj_close"`, sektor → `"index"`. Rumus finansial lain tidak diubah.
- alternatif: (a) memakai `open` mentah apa adanya → ditolak: melanggar aturan "semua harga `adj_close`" §10 dan menghasilkan rugi palsu; (b) selalu memakai `adj_close` (buang D+1 `open`) → ditolak: §10.3 minta eksekusi D+1 pada `open`, dan selisih `open`→`close` hari itu memang bagian dari hasil; (c) mengubah `docs/03` lebih dulu → ditolak: dokumen yang benar adalah "semua harga satu kerangka", kodenya yang belum mengikuti.
- dampak: `price_daily.open` mentah **jangan** lagi dipakai langsung di hitungan apa pun tanpa dikalikan `adj_close/close`. Test pengunci: `test_entry_open_diskalakan_ke_adj_close`. Risiko sisa: kalau Yahoo mengubah definisi `Adj Close`, faktor itu ikut berubah — angka lama di `ta_breakout` tidak otomatis dihitung ulang sampai `stage=ta` dijalankan lagi.

## ADR-041 — Titik tepi `docs/03` §10.3 yang harus diputuskan saat implementasi
- tanggal: 2026-10-13
- status: diterima (dua keputusan) / usul (satu koreksi dokumen)
- konteks: tiga hal di §10.3/§10.6–§10.7 tidak bisa dijawab dokumen apa adanya: (1) apakah bar entry (`periods` 0) ikut dievaluasi; (2) "satu bar menyentuh `+target` **dan** `−target` → `loss`" padahal dasar hitungnya `close`/`adj_close`, bukan high/low, sehingga satu bar tidak mungkin melewati dua ambang sekaligus; (3) harga keluar untuk hasil `expired`.
- keputusan: (1) **bar entry ikut dievaluasi** (`periods` = 0 sah — DDL `docs/04` §4 menyebut "0 = bar entry", dan entry di `open` jadi close hari yang sama sudah bisa kena target). (2) urutan cabang dijaga **pesimis**: `change ≤ −target` dicek lebih dulu, lalu `change ≥ +target` — kalau nanti dasar hitungnya diubah ke high/low, aturannya sudah benar tanpa mengubah kode. (3) `expired` dianggap keluar di bar horizon terakhir → `exit_date`/`exit_price` diisi (bar ke-`timeout_periods`), `periods` = `timeout_periods`; `open` tetap `exit_*`/`periods` NULL.
- alternatif: (a) melewati bar entry → ditolak: `periods` 0 jadi mustahil padahal disebut DDL; (b) membuang aturan tepi (2) karena tidak terpakai → ditolak: lebih baik kodenya sudah benar saat dasar hitung berubah; (c) `expired` dengan `exit_*` NULL → ditolak: UI butuh harga keluar untuk kolom "keluar".
- dampak: **usul koreksi `docs/03` §10.3** — tulis bahwa dasar hitung `close` membuat aturan "+ dan − di satu bar" tidak mungkin terjadi di v1, dan sebutkan `expired` keluar di bar horizon. `timeframe` di `/ta/summary` & `/ta/{scope}/{ref_id}` diterima & divalidasi tetapi `ta_breakout` tidak punya kolom `timeframe` (seri harian saja) — permintaan `timeframe != "d1"` mengembalikan himpunan yang sama, dan itu belum dijanjikan dokumen. `/ta/*` sengaja **tanpa** cache in-process (permintaan pertama selalu segar; agregasi cepat karena indeks `ta_breakout`); `min_events` di `/ta/summary` menyembunyikan angka dengan `null` tanpa membuang barisnya; `coverage` dihitung live dari bar (`price_daily`/`sector_index_daily`) dan `ta.min_history`, bukan dari hasil run terakhir.


## ADR-042 — Label RRG scope saham = ticker dulu (`TICKER · Nama`), nama panjang dipotong
- tanggal: 2026-10-13
- status: diterima
- konteks: `docs/06` §6.2 sudah menetapkan entri legenda scope saham = **ticker**, tapi kode menampilkan `item.name` di label titik, legenda, dan `PointCard`. Untuk saham, ticker itulah yang dicari user di sekuritas; nama panjang justru menambah label bertumpuk di chart yang bisa memuat 25 titik (`docs/06` §6).
- keputusan: tiga helper murni di `lib/rrgChart.ts` — `pointLabel(item, scope)` (saham → `ref_id`, sektor → nama), `stockLabel(item)` (`TICKER · Nama`), `describePoint(item, scope)` (baris `aria-live` + `aria-label` titik memuat ticker dan nama). Label titik chart = ticker; entri legenda & judul `PointCard` = `TICKER · Nama` (nama di entri legenda dipotong `truncate` + `title` = nama penuh supaya tinggi entri tetap 24 px); tautan di `PointCard` untuk scope saham menjadi `/stocks/{ticker}` (sebelumnya `/stocks?sector=<ticker>`, salah alamat). `scope=sector` tidak disentuh sama sekali (nama sektor, tanpa kode).
- alternatif: (a) tetap memakai nama perusahaan tapi mengecilkan font → ditolak: melanggar skala teks `docs/06` §1 dan tidak menyelesaikan tumpukan label; (b) mengganti label titik saja tanpa legenda/kartu → ditolak: `docs/08` F16 minta ketiganya konsisten, dan pembaca layar butuh nama lengkapnya di satu tempat (kartu/aria).
- dampak: label titik lebih pendek → ambang anti-tumpuk `docs/06` §6 (24 px layar) tidak perlu diubah dan justru lebih sedikit label disembunyikan. Nama perusahaan tetap ada di legenda (dipotong) & kartu, jadi tidak ada informasi yang hilang. Kalau nanti tabel saham ingin kolom ticker+ nama berkode, pakai `stockLabel()` yang sama — jangan bikin format kedua.

## ADR-043 — Kolom insight TA: satu `/ta/summary` per halaman, bukan per baris & bukan sort tabel

- **Konteks (F17):** `SectorTable`/`StockTable` perlu kolom `win_rate`/median/`last_breakout`. `docs/05`
  §4.1/§2: sumbernya `GET /ta/summary` yang sudah punya `sort=win_rate|median_periods|events|last_breakout|…`.
- **Keputusan:** tabel memanggil **satu** `/ta/summary` (`limit=500`) lalu **join per `ref_id`** ke baris
  `/sectors/summary` / `/stocks`. Kolom insight **tidak bisa diurutkan** (header tidak diklik) karena urutan
  baris tabel milik endpoint tabel, bukan `/ta/summary`; mengurutkan `/ta/summary` tidak akan mengubah urutan
  baris. Kunci `sort` TA tidak dikirim (default backend: `win_rate desc`).
- **Kenapa:** AC F17 meminta satu permintaan per halaman (bukan per baris) dan angka kolom = angka panel.
  Memetakan `sort` TA ke header tabel akan berbohong: barisnya tetap urutan `/sectors/summary`.
- **Batasan yang diketahui:** `/ta/summary` mengirim maks 500 baris pertama → baris di luar itu tampil `—`
  (ada komentar `shortcut:` di komponen). Kalau nanti perlu semua ref, minta backend menerima daftar `ref_id`.
- **Alternatif yang ditolak:** satu permintaan per baris (dilarang AC), atau menyalin angka TA ke `/stocks`
  & `/sectors/summary` (mengubah bentuk respons = naikkan `api_version`, dan backend B17 sudah memisahkannya).

## ADR-044 — Plan mingguan: `reason` per elemen dari API, alasan alat/konfirmasi = field opsional

- **Konteks (F18):** `docs/06` §5.2 minta blok plan memuat nama alat + kalimat alasannya dan baris konfirmasi
  (contoh: "volume 1,8× rata-rata 20 hari"). Contoh `docs/05` §3 (kontrak beku) memuat `reason` di
  `entry_zone/stop/tp1/tp2/hold`, tetapi **tidak** memuat alasan untuk `entry_tool`/`confirm_tool`.
- **Keputusan:** `WeeklyPlan.entry_tool_reason` dan `confirm_reason` ditambahkan sebagai field **opsional**
  (aditif → `api_version` tetap 1.2). Kalau backend tidak mengirimnya, UI menampilkan nama alat Indonesia +
  baris konfirmasi **tanpa** kalimat tambahan; `planRows` memakai `entry_zone.reason` sebagai alasan alat.
  Frontend **tidak** menyusun kalimat dari `volume_ratio` (aturan: frontend tidak mengarang kalimat finansial).
- **Dampak / permintaan ke backend (B18):** kirim `entry_tool_reason` & `confirm_reason` (≤140 char, Bahasa
  Indonesia, tanpa istilah mentah) + tambahkan keduanya ke contoh `docs/05` §3.
- **Mock:** `mocks/plans.ts` mengirim keduanya supaya tampilan yang diharapkan bisa diuji; angka plan
  diturunkan dari fixture pick (zona = entry ± ½ ATR, TP1 = tengah entry–target, TP2 = target, R:R bersih
  biaya 0,40%) sehingga tidak ada angka baru yang bertentangan dengan `/weekly/picks`.
- **Knob dev:** `?mock=notrade` (tanpa level), `?mock=planfail` (`plan_ok=false` + notes), `?mock=noplan`
  (pick lama tanpa `plan` — dipakai membuktikan AC 6: tidak ada `NaN`/`undefined`).

## ADR-046 — `pytest-xdist` (dev) + template DB sesi untuk mempercepat suite backend
- tanggal: 2026-10-13
- status: diterima
- konteks: user mengeluh testing terlalu lama. `pytest -q backend` 82,8 s untuk 196 test. Dugaan awal: setup DB per test (skema + seed + migrasi dibangun ulang tiap test). Setelah `template_db` sesi + `tmp_config` menyalin DB, suite serial hanya turun ke 77,5 s — jadi sisa biaya adalah **komputasi per test** (fixture sintetis + pipeline compute), bukan I/O skema.
- keputusan: (1) fixture sesi `template_db` (`sqlite3.backup`, aman terhadap WAL) dipakai `tmp_db` & `tmp_config`; (2) marker `slow` untuk uji terberat + `pytest -m "not slow"` sebagai jalur cepat; (3) **dependency dev baru `pytest-xdist`** dan suite penuh dijalankan `pytest -q backend -n auto` (32,9 s; jalur cepat 28,2 s).
- alternatif: (a) tidak menambah dependency, terima 77 s → ditolak: user eksplisit meminta lebih cepat dan xdist hanya dependency **dev** (tidak ikut ke runtime/produksi); (b) memangkas jumlah test atau melonggarkan asersi → ditolak: bukti adalah aset repo ini; (c) `pytest-parallel`/`pytest-forked` → ditolak: xdist paling standar & sudah mendukung `-n auto`.
- dampak: `pip install -e "backend[dev]"` sekarang memasang xdist; gate penutup memakai `-n auto`; test wajib tetap terisolasi per proses (tidak boleh berbagi file/db di luar `tmp_path`). Risiko: flake yang hanya muncul di mode paralel → kalau terjadi, tandai test itu `slow` dan jalankan serial, jangan menaikkan retries.

## ADR-045 — Trading plan TA (B18): satu mesin `plan.py`, dua key config baru, dan tafsir rumus yang celah

- tanggal: 2026-10-14
- status: diterima (keputusan) / usul (dua koreksi dokumen)
- konteks: `docs/03` §6.4 sangat terperinci, tetapi saat implementasi ada empat hal yang tidak bisa dijawab dokumen apa adanya: (1) `weekly.plan` tidak memuat angka untuk "SMA20 menanjak (`sma20 > sma20 5 bar lalu`)" dan "RSI ≤ 35 di tepi bawah kanal" — §6.4.0/§6.4.2 menyebut angkanya di prosa saja; (2) §6.4.3 menulis `stop = max(stop_struct, stop_atr)` lalu `stop = min(stop, batas_bawah)` yang terbaca sebagai "lantai" tetapi arah `min` tidak jelas; (3) §6.4.2 punya tiga mode entry (`wait_pullback` > `breakout` > `pullback`) tanpa jawaban untuk kasus harga 1–2 × ATR di atas penyangga tanpa breakout; (4) §6.4.5 meminta `hit_tp*` dari **first touch** sedangkan AC B18 no. 5 memintanya dari **MFE** (`share(mfe_pct ≥ target)`) — dan `ta_breakout` belum punya kolom MFE/MAE sama sekali.
- keputusan: (1) dua key **baru** di `config weekly.plan`: `ma_slope_bars: 5`, `rsi_range_max: 35` (angka dari prosa dokumen, ditaruh di config sesuai aturan "tidak ada angka di kode"). (2) lantai stop dibaca sebagai batas "jangan lebih ketat dari 1 × ATR": stop = `max(struktur, volatilitas)`, lalu **hanya** bila nilainya lebih dekat ke entry daripada `1 × ATR` ia dijauhkan ke lantai itu (`stop_basis = lantai_atr`) — urutan ini yang membuat ketiga test §6.4.8 no. 3–4 benar (struktur 0,8 ATR → `struktur_swing_low`; 3 ATR → `volatilitas_atr`; 0,4 ATR → `lantai_atr`). (3) celah mode entry ditutup konservatif: kalau harga 1–`chase_atr` ATR di atas penyangga tanpa konfirmasi volume → `wait_pullback` (jangan chase), bukan memaksa `pullback`. (4) `hit_tp1`/`hit_tp2` = `share(mfe_pct ≥ tp)` dari MFE yang kini disimpan per event (`docs/03` §10.9, migrasi 005); fungsi `first_touch(...)` **belum** dibuat karena yang memakainya adalah skenario §6.5 (`p_tp1_first`) di task **B20** — bukan B18.
- tambahan keputusan: metrik untuk plan dibaca dari snapshot `stock_metrics d1` **terakhir** (bukan `as_of_date <= week_end`) karena skor/metrik memang hanya dihitung untuk `as_of` terakhir (ADR-021) — tanpa ini plan minggu mana pun jadi `null` di DB nyata. `entry_tool_reason` & `confirm_reason` dikirim sesuai permintaan ADR-044 (aditif, `api_version` tetap **1.2**), dan contoh `docs/05` §3 sudah ditambahi keduanya. Runner migrasi (`app/db.py`) kini menjalankan tiap statement sendiri dan melewati `duplicate column name` — bukan `executescript` yang berhenti di error pertama (migrasi jadi benar-benar idempotent-safe walau DB separuh termigrasi).
- alternatif: (a) menghardcode 5 bar & 35 RSI di kode → ditolak: melanggar aturan angka ambang; (b) mengartikan `min(stop, batas_bawah)` sebagai "ambil yang lebih jauh" → ditolak: tidak konsisten dengan nama "lantai" dan membuat test no. 3 gagal; (c) menghitung `hit_tp*` dengan first touch sekarang → ditolak: butuh kolom/penyimpanan tambahan yang tidak diminta B18, dan AC B18 memakai MFE; (d) menambah `first_touch` sekarang "untuk nanti" → ditolak: kode tanpa pemakai.
- dampak: **usul koreksi `docs/03`** — (i) tambahkan `ma_slope_bars` & `rsi_range_max` ke daftar `config weekly.plan.*` di §6.4.0/§6.4.2, dan (ii) tulis eksplisit arti `min(stop, batas_bawah)` = "stop tidak boleh lebih ketat dari 1 × ATR" plus mode `wait_pullback` sebagai jawaban untuk harga 1–`chase_atr` ATR di atas penyangga. Catatan test: `backend/tests/test_b3_intraday_gate.py` memakai `DAY = "2026-10-13"` padahal gate kesegaran selalu memeriksa **hari berjalan** → suite merah begitu lewat tengah malam (bukan karena kode); `DAY` sekarang diambil dari `datetime.now(Asia/Jakarta)`.

