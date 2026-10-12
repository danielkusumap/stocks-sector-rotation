# PROGRESS — status pekerjaan

Update file ini **setiap kali satu task selesai** (atau diblokir). Satu baris per task, bukti wajib dilampirkan (output command nyata / path screenshot). Task tanpa bukti = belum selesai.

Legenda status: `todo` · `wip` · `blocked` · `done`

## Backend

| ID | Task | Status | Bukti / catatan |
|---|---|---|---|
| B0 | Skeleton, config, db-init | done | `python -m backend.cli db-init` (2×, dari root) → `{"path": "E:\\stocks-sector-rotation\\data\\rotation.db", "tables": 13, "user_version": 0, "api_version": "1.0"}`; `sqlite_master` = 13 tabel + 2 view (`v_sector_latest`, `v_stock_latest`), `journal_mode=wal`; `curl /health` → `{"api_version":"1.0","status":"ok","db":"ok","tables":13,"detail":null,"uptime_s":1}`; preflight CORS `Origin: http://localhost:5173` → `access-control-allow-origin: http://localhost:5173`; `.venv/Scripts/python.exe -m pytest -q` → **4 passed** (dari root dan dari `backend/`); override config diuji lewat env `ROTATION_CONFIG` dan flag `--config` (keduanya menulis ke db di luar repo, `data/rotation.db` tidak tersentuh); `pip install -e backend` (setuptools, `package-dir`) terverifikasi. **Selisih:** AC menyebut 14 tabel, DDL `docs/04` mendefinisikan **13 tabel + 2 view** → `/health.tables` melaporkan hitungan live; lihat ADR-006 |
| B1 | Import Excel | todo | |
| B2 | Ingest harga harian | todo | |
| B3 | Ingest intraday + gate | todo | |
| B4 | Indeks sektor | todo | |
| B5 | RRG sektor & saham | todo | |
| B6 | Skor & metrik | todo | |
| B7 | Sinyal mingguan + streak | todo | |
| B8 | Endpoint read | todo | |
| B9 | Briefing & weekly | todo | |
| B10 | Admin runs, backup, retention | todo | |
| B11 | Test & dokumentasi | todo | |

## Frontend

| ID | Task | Status | Bukti / catatan |
|---|---|---|---|
| F0 | Skeleton & token | done | `npm run build` bersih (tsc --noEmit + vite build: JS 85,75 kB gzip / CSS 3,59 kB). Tema: kunjungan pertama ikut `prefers-color-scheme` (diuji dark & light lewat emulasi media), toggle tersimpan di `localStorage` dan menang saat reload; `data-theme` dipasang script inline sebelum paint. Kontras token (canvas + WCAG) dark: fg/bg 15,43 · fg-muted 6,75 · fg-faint 4,68–4,92 · label nav aktif 11,9; light: 16,55 · 5,47 · 5,05 · 14,94 — semua ≥ 4,5. `--motion-panel` = 0 ms saat `prefers-reduced-motion`. `grep -rn "#[0-9a-fA-F]\{6\}" src/components src/pages src/hooks src/App.tsx` → 0 temuan (hex hanya di `src/styles/tokens.css`). Sidebar 64/216 px, topbar 48 px, padding panel 16 px. Screenshot: `docs/evidence/F0-dark.png`, `docs/evidence/F0-light.png`. Proxy terverifikasi: `curl -i http://localhost:5173/api/v1/meta/sectors` → `404` dari `server: uvicorn` (bukan connection error) = diteruskan ke `127.0.0.1:8000`; endpoint-nya sendiri baru ada di B8. |
| F1 | Layer data | todo | |
| F2 | Komponen UI dasar | todo | |
| F3 | Format & util | todo | |
| F4 | QuadrantChart (RRG) | todo | |
| F5 | Tabel & filter | todo | |
| F6 | Ringkasan, heatmap, matriks | todo | |
| F7 | Drawer detail sektor | todo | |
| F8 | Halaman Saham | todo | |
| F9 | Halaman Weekly | todo | |
| F10 | Halaman Status | todo | |
| F11 | A11y, performa, finishing | todo | |

## Blocker & pertanyaan terbuka

| # | Pertanyaan | Pemilik | Status |
|---|---|---|---|
| 1 | Delay nyata feed Yahoo untuk `.JK` (dipakai untuk `midday.gate_min_bar_time`) — ukur 3 hari bursa selama sesi 1 | backend | terbuka |
| 2 | Bobot skor & parameter RRG final setelah lihat hasil nyata 11 sektor | user + backend | terbuka |
| 3 | ~~Isi `data/idx_sector_master.xlsx`~~ → `saham_sektoral.xlsx` sudah ada di root repo & sudah diverifikasi (962 emiten, 11 sheet) | user | **selesai** |
| 4 | Bobot indeks default: `equal` (sekarang) vs `captier` — putuskan setelah lihat selisih arah keduanya | user | terbuka |
| 5 | Apakah papan `Pemantauan Khusus` (69 emiten) tetap ditampilkan di tabel (badge PK) atau disembunyikan total | user | terbuka |

## Log perubahan dokumen planning

| Tanggal | Perubahan |
|---|---|
| 2026-10-12 | Planning pack awal dibuat (README + docs 01–08 + config + DECISIONS/PROGRESS). Data source yfinance diverifikasi langsung. |
| 2026-10-13 | B0 selesai: `backend/` (pyproject, `app/config.py`, `app/db.py` + `db/schema.sql`, `app/main.py`, `cli.py`, `tests/`). Dua temuan dicatat di ADR-006 (jumlah tabel & `IF NOT EXISTS`) dan ADR-007 (packaging `pip install -e backend`). |
| 2026-10-12 | Disesuaikan dengan `saham_sektoral.xlsx` nyata: kolom Excel (Kode/Nama/Tanggal Pencatatan/Saham/Papan), 962 emiten, `shares_outstanding` + `listing_date` masuk skema, weighting `captier` ditambahkan (ADR-004), AC task B1 memakai angka nyata dari file. |
| 2026-10-13 | Frontend `F0` selesai: token dua tema disesuaikan agar lolos AA (ADR-008), peta rute halaman dibuat (ADR-009), sumber warna sektor ditetapkan (ADR-010). |

## Cara kerja per task

1. Ambil satu task (mulai dari `B0` backend / `F0` frontend).
2. Kerjakan sampai acceptance criteria terpenuhi, buktikan dengan output nyata.
3. Update tabel di file ini (status → `done`, isi kolom bukti).
4. Commit sendiri: `git commit -m "B0: skeleton FastAPI, loader config, db-init"`.
5. Baru lanjut task berikutnya.

Satu task = satu commit. Kalau task gagal di tengah, commit tetap boleh dibuat dengan status `wip` di tabel — tapi **jangan** tandai `done`.

## Status planning

**SELESAI** — seluruh dokumen planning (README, docs 01–08, config, DECISIONS, PROGRESS, AGENTS.md root/backend/frontend) sudah ditulis dan disesuaikan dengan data nyata. Belum ada kode yang ditulis; tahap berikutnya adalah task backend `B0` dan frontend `F0` (dikerjakan agen OpenCode di repo ini).
