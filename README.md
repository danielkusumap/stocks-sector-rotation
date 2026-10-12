# Sector Rotation IDX — Planning Pack

Aplikasi analisis **sector rotation saham Indonesia** (IDX): diagram RRG (Leading / Weakening / Lagging / Improving), tabel per-sektor yang bisa difilter, drill-down rotasi saham per sektor, dan **satu endpoint summary** yang dipakai Hermes agent untuk report pagi.

Stack: Python (FastAPI) + SQLite + React/TS (Vite). Data: **yfinance** (gratis) + file Excel sektor dari user.

---

## 1. Cara memakai dokumen ini (WAJIB dibaca agen)

Repo ini dikerjakan oleh **dua agen OpenCode terpisah** (backend & frontend), sering di dua window VSCode berbeda.

**Aturan entry point:**

| Kamu mengerjakan | Baca urut ini |
|---|---|
| Backend | `docs/07-TASKS-BACKEND.md` → `docs/05-API-CONTRACT.md` → `docs/04-DATABASE-SCHEMA.md` → `docs/03-METHODOLOGY.md` → `docs/02-DATA-SOURCES.md` |
| Frontend | `docs/08-TASKS-FRONTEND.md` → `docs/05-API-CONTRACT.md` → `docs/06-DESIGN-SYSTEM.md` |
| Keduanya | `docs/01-PRODUCT-SCOPE.md` + `config/default.yaml` |

Buka **root repo** (`E:\stocks-sector-rotation`) di kedua window VSCode, bukan subfolder — kalau kamu membuka `backend/` atau `frontend/` saja, `docs/` tidak terlihat. Setiap subfolder punya `AGENTS.md` sendiri yang menunjuk ke `../docs/`.

**Kontrak antar-agen:** `docs/05-API-CONTRACT.md` adalah **satu-satunya sumber kebenaran** untuk bentuk request/response. Frontend tidak boleh menebak field. Backend tidak boleh mengubah bentuk response tanpa menaikkan `api_version` dan mencatatnya di `docs/DECISIONS.md`.

## 2. Aturan kerja (berlaku untuk semua task)

1. **Selalu pakai skill `ponytail`** (mode `full`). Solusi paling kecil yang benar-benar jalan. Stdlib dulu, dependency baru terakhir, diff terpendek.
2. **Catat setiap keputusan non-obvious** di `docs/DECISIONS.md` (format ADR di file itu) — terutama yang menyimpang dari dokumen ini.
3. **Update `docs/PROGRESS.md` setelah setiap task selesai** (status, tanggal, catatan, bukti verifikasi). Task dianggap selesai hanya kalau acceptance criteria-nya terpenuhi dan dibuktikan (test lulus / output command nyata), bukan "seharusnya jalan".
4. **Angka ambang (threshold)** tidak boleh di-hardcode di kode. Semua di `config/default.yaml`, dibaca oleh backend, dan diekspos ke frontend lewat `GET /api/v1/meta/config`.
5. **Jangan menambah fitur yang tidak diminta.** Kalau menurutmu ada yang kurang, tulis usulnya di `docs/DECISIONS.md` bagian "Proposed", jangan langsung dibangun.
6. Zona waktu tunggal: **Asia/Jakarta (WIB, UTC+7)**. Semua timestamp disimpan dengan offset, semua tanggal bisnis adalah tanggal WIB.

## 3. Struktur repo yang dituju

```
E:\stocks-sector-rotation\
├─ README.md                  # file ini
├─ AGENTS.md                  # aturan kerja ringkas untuk OpenCode
├─ saham_sektoral.xlsx        # SUDAH ADA: master sektor→saham (11 sheet, 962 emiten)
├─ config/default.yaml        # semua threshold & parameter (sumber kebenaran angka)
├─ docs/                      # planning pack ini
├─ data/rotation.db           # SQLite (gitignored, dibuat oleh `db-init`)
├─ backend/                   # FastAPI + jobs + tests  (agen backend)
└─ frontend/                  # React + TS + Vite        (agen frontend)
```

## 4. Kondisi awal (sudah diverifikasi, lihat `docs/02-DATA-SOURCES.md`)

- `yfinance 1.7.0` **sudah diuji** terhadap `.JK`: bar harian, 5m, 60m, `^JKSE` (IHSG), metadata `sector`/`marketCap`, dan agregasi mingguan `W-FRI` — semuanya jalan.
- **Indeks sektoral IDX di Yahoo tidak bisa dipakai**: `IDXENERGY.JK` / `IDXFINANCE.JK` hanya mengembalikan 1 baris untuk periode 5 hari. Indeks sektor **dihitung sendiri** dari konstituen.
- `interval="1wk"` yfinance memberi bar minggu berjalan dengan `Close = NaN` → jangan dipakai; agregasi mingguan dilakukan sendiri (`resample("W-FRI")`).
- **File `saham_sektoral.xlsx` sudah ada di root repo dan sudah diperiksa**: 11 sheet (kode IDX-IC), **962 emiten unik**, 0 kode tidak valid, 0 duplikat lintas sheet. Kolom: `No, Kode, Nama Perusahaan, Tanggal Pencatatan, Saham, Papan Pencatatan`. → `docs/02 §6`.

## 5. Definisi "selesai" tingkat proyek

1. `POST /api/v1/admin/import/excel` memasukkan Excel sektor user ke SQLite tanpa error dan melaporkan baris gagal per sheet.
2. `POST /api/v1/admin/ingest/prices` menarik harga harian + intraday untuk seluruh universe dari yfinance ke SQLite.
3. `GET /api/v1/rrg?scope=sector` mengembalikan titik RS-Ratio/RS-Momentum + ekor historis untuk 11 sektor, dengan kuadran benar menurut `docs/03-METHODOLOGY.md`.
4. `GET /api/v1/briefing/morning` mengembalikan satu JSON lengkap yang cukup untuk Hermes menulis report pagi tanpa query tambahan.
5. Frontend menampilkan diagram RRG interaktif + tabel sektor yang bisa difilter + drill-down saham, rapi di dark & light mode, tanpa chart library eksternal.
6. `docs/DECISIONS.md` dan `docs/PROGRESS.md` terisi.
