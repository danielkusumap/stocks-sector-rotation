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
