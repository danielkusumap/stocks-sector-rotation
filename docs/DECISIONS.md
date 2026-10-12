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
