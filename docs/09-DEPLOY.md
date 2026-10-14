# 09 — Deploy (Dokploy / Docker Compose)

Dokumen ini menjelaskan **satu repo → dua image**, env yang harus diisi, dan alur agar frontend & backend
saling terhubung. Berkas yang dipakai: `docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile`,
`frontend/nginx.conf.template`, `.dockerignore`, `frontend/.dockerignore`, `.env.example`.

## 1. Kenapa dua image (bukan satu)

Backend (Python + SQLite + yfinance) dan frontend (build Vite → berkas statis) tidak punya runtime yang sama:
menggabungkannya berarti satu container berisi nginx **dan** Python, dua proses, dua siklus build. Yang dipisah
justru lebih sedikit kode: dua Dockerfile kecil, disatukan `docker-compose.yml`.

```
                        ┌──────────────────────────── domain publik (Dokploy/Traefik)
                        │
                        ▼
        ┌───────────────────────────────┐        /api/*   ┌──────────────────────────────┐
        │ frontend (nginx:1.27-alpine)  │ ───────────────▶│ backend (python:3.12-slim)   │
        │  - berkas statis hasil build  │  proxy internal │  uvicorn 1 worker :8000      │
        │  - SPA fallback → index.html  │                 │  SQLite + job ingest (thread)│
        └───────────────────────────────┘                 └──────────────┬───────────────┘
                                                                          │ volume `rotation-data`
                                                                          ▼
                                                              /app/data/rotation.db (+ -wal/-shm)
```

- **Satu origin** untuk browser (UI + API di domain yang sama) → tidak ada CORS, tidak ada `VITE_*` untuk base URL:
  `frontend/src/lib/api.ts` memakai `API_BASE = "/api/v1"` (relatif) dan nginx mem-proxy ke `backend:8000`.
- **Backend tidak perlu domain publik.** Kalau kamu tetap memberinya domain (untuk `curl`/CLI dari luar),
  isi `API__CORS_ORIGINS` dengan domain UI, karena permintaan browser tidak lagi satu origin.
- **SQLite wajib satu replika.** Job ingest berjalan di thread proses backend (`backend/app/jobs.py`) dan menulis
  SQLite; dua replika = dua penulis + run ganda. Karena itu `--workers 1` dan jangan scale service backend.

## 2. Env yang harus diisi (bentuk `KEY=value`)

Isi di tab **Environment** aplikasi Compose di Dokploy (atau `.env` di sebelah `docker-compose.yml` saat lokal).

```ini
# ── Backend ───────────────────────────────────────────────────────────────────
TZ=Asia/Jakarta
ROTATION_CONFIG=/app/config/default.yaml
DATABASE__PATH=/app/data/rotation.db
API__HOST=0.0.0.0
API__PORT=8000
API__API_KEY=<string acak panjang — WAJIB kalau domain publik>
API__CORS_ORIGINS=[]
APP__TIMEZONE=Asia/Jakarta
INGEST__DAILY_LOOKBACK_DAYS=730
INGEST__BATCH_SIZE=50

# ── Frontend ──────────────────────────────────────────────────────────────────
BACKEND_ORIGIN=http://backend:8000
```

| Env | Wajib? | Guna |
|---|---|---|
| `TZ`, `APP__TIMEZONE` | ya | Zona tunggal `Asia/Jakarta` (label "per kapan", batas pekan, jam buka bursa) |
| `DATABASE__PATH` | ya | Lokasi SQLite di dalam volume (`/app/data/rotation.db`) |
| `API__HOST=0.0.0.0` | ya | Tanpa ini uvicorn hanya mendengar di localhost container → nginx dapat 502 |
| `API__API_KEY` | **ya kalau publik** | Melindungi `/admin/*` (pemicu ingest/backfill). Frontend menyimpannya di `localStorage` (`docs/05` §4.5) dan mengirim `X-API-Key` |
| `API__CORS_ORIGINS` | hanya jika backend diberi domain | Daftar origin yang boleh memanggil API langsung dari browser |
| `INGEST__DAILY_LOOKBACK_DAYS`, `INGEST__BATCH_SIZE` | opsional | Percepat backfill pertama / atur beban ke Yahoo |
| `BACKEND_ORIGIN` | ya | Target proxy nginx (`http://backend:8000` = nama service compose) |

**Cara kerja override env (sudah diverifikasi):** `backend/app/config.py` membaca
`init → env → YAML`, jadi env **menang** atas `config/default.yaml`. Key bertingkat ditulis dengan pemisah
`__` (`API__API_KEY`, `DATABASE__PATH`, `INGEST__BATCH_SIZE`). Bentuk JSON juga jalan untuk objek utuh:
`API={"host":"0.0.0.0","port":8000,"api_key":"…","cors_origins":[],"cache_ttl_seconds":60,"backup_enabled":true}`.
Tanpa env, nilai YAML dipakai apa adanya — jadi dev lokal tidak berubah.

**Rahasia & kredensial (audit 14 Okt 2026).** Satu-satunya kredensial aplikasi = `API__API_KEY`
(grep `key|token|secret|password` di `config/default.yaml` hanya menemukan baris itu). Tidak ada kunci pihak
ketiga: yfinance tanpa key, tidak ada password DB (SQLite lokal), dan kode tidak membaca `.env`
(`settings_customise_sources` = `init → env → YAML`; `DotEnvSettingsSource` tidak dipakai). Frontend **tidak**
menyimpan kunci saat build: pengguna menempelkannya di UI → `localStorage` → header `X-API-Key`
(`frontend/src/lib/api.ts`), jadi image frontend bebas rahasia. Token Cloudflare/tunnel **tidak** masuk
container ini — taruh di pengaturan Dokploy/Cloudflare. Jangan commit `.env`; `.env.example` hanya placeholder.

## 3. Langkah di Dokploy

1. **Project** baru → **Create Service → Compose**.
2. Sumber kode: repo Git ini (branch `main`). **Compose path: `./docker-compose.yml`** (root repo).
3. Tab **Environment**: tempel blok `KEY=value` di atas (isi `API__API_KEY`). Semua kredensial dibaca dari
   environment server — tidak ada rahasia di dalam image maupun di `config/default.yaml`: `api.api_key`
   default kosong dan itu satu-satunya kunci aplikasi. Nilai env di-inject ke container lewat interpolasi
   compose (`${API__API_KEY}`); kalau nilainya mengandung `$`, tulis `$$` (aturan compose).
4. Tab **Domains**: tambahkan domain untuk service **`frontend`**, port **80** (Dokploy menambahkan label
   Traefik). Backend biarkan internal — cukup `expose: 8000`.
   *Kalau mau API punya domain sendiri:* tambahkan domain untuk service `backend` port 8000 **dan** isi
   `API__CORS_ORIGINS=["https://<domain-ui>"]`.
5. **Deploy**. Yang terjadi: `backend` di-build dari root repo (`pip install -e ./backend`), `frontend` di-build
   dari `frontend/` (`npm ci && npm run build`), volume `rotation-data` dibuat dan dipasang di `/app/data`.
6. Cek: `https://<domain>/healthz` → `ok`; `https://<domain>/health` → JSON `{"api_version": …, "status": …}`;
   buka `https://<domain>/` → halaman Overview.

Lokal (uji cepat sebelum Dokploy), dari root repo:

```bash
docker compose up --build          # lalu buka http://127.0.0.1/ (frontend) — lihat catatan port di bawah
docker compose logs -f backend     # "db-init" jalan otomatis saat start
docker compose down                # volume tetap ada; `down -v` menghapus DB
```
Compose ini sengaja **tidak** mem-publish port (Dokploy/Traefik yang mengekspos). Untuk mencoba lokal,
pakai override kecil di luar repo, mis. `docker compose -f docker-compose.yml -f ~/port.yml up --build`
dengan isi `services: { frontend: { ports: ["18080:80"] } }`.

## 4. Setelah deploy pertama — semua dari UI

Backend menjalankan `python -m backend.cli db-init` saat start (idempotent), jadi skema + migrasi sudah ada dan
DB kosong. Isi datanya dari halaman **Data** (aturan `docs/01` §3 no.12: pipeline dijalankan dari UI):

1. Langkah **1** — impor master sektor dari `saham_sektoral.xlsx` (sudah ada di image, 962 emiten).
2. Langkah **2–3** — tarik harga harian (backfill 962 emiten; ini yang paling lama: ratusan batch × `batch_size`,
   `sleep_seconds` 1 s). Jalankan sekali, biarkan berjalan; status run dipantau di halaman yang sama.
3. Langkah **4–7** / tombol **Hitung semua** — indeks sektor, RRG, metrik, sinyal, TA, plan.
4. Halaman **Weekly** dan detail saham langsung terisi.

Kalau `API__API_KEY` diisi: buka UI → masukkan kunci di tempat yang disediakan (disimpan di `localStorage`),
kalau tidak, tombol-tombol admin akan ditolak 401.

## 5. Operasional

- **Volume**: `rotation-data` → `/app/data` berisi `rotation.db` (+ `-wal`, `-shm`). Redeploy tidak menghapusnya;
  `docker compose down -v` menghapusnya.
- **Backup**: `api.backup_enabled: true` di config membuat salinan DB lewat pemeliharaan (lihat `docs/04`/`docs/03`
  bagian retensi). Untuk salinan luar: `docker compose exec backend python -m backend.cli retention` atau
  `docker run --rm -v <volume>:/data -v $PWD:/out alpine cp /data/rotation.db /out/`.
- **Resource**: siapkan RAM ≥ 2 GB (pandas + yfinance + 962 emiten) dan disk ≥ 5 GB (DB dev sekarang ± 50 MB;
  tumbuh dengan bar intraday). Backfill penuh butuh waktu lama dan CPU saat tahap `compute`.
- **Jatah CPU = 10% server** (permintaan owner): `cpus` di `docker-compose.yml` — 8 core → total 0,8 vCPU,
  dibagi **backend 0,72** + **frontend 0,08**; server dengan core lain: 10% × `nproc`, setel lewat env
  `DOCKER_CPUS_BACKEND` / `DOCKER_CPUS_FRONTEND` (tidak perlu mengedit compose). Konsekuensinya **backfill
  962 emiten berjalan lambat** — hitung dulu sebelum maraton ~4 menit jadi belasan menit; naikkan sementara
  jatahnya kalau mau backfill, lalu turunkan lagi. `cpus` berlaku di `docker compose` (cgroup); kalau deploy
  diubah ke mode Swarm, pindahkan angka ini ke `deploy.resources.limits.cpus`.
- **Egress**: container backend butuh akses keluar ke Yahoo Finance (`query1.finance.yahoo.com`). Tanpa itu,
  langkah 2–3 di halaman Data akan gagal.
- **Update**: `git push` ke repo → Deploy ulang dari Dokploy (atau aktifkan auto-deploy). Build frontend & backend
  independen, jadi perubahan satu sisi tidak membangun ulang sisi lain (cache layer Docker).

## 6. Troubleshooting

| Gejala | Sebab & tindakan |
|---|---|
| `502 Bad Gateway` di UI | Backend belum siap / crash. `docker compose logs backend`; pastikan `API__HOST=0.0.0.0`. |
| UI kosong tapi `/health` OK | DB kosong — jalankan langkah 1–3 di halaman Data. |
| Tombol admin 401 | `API__API_KEY` diisi tapi kunci belum dimasukkan di UI (atau sebaliknya). |
| CORS error | Backend diberi domain sendiri tanpa `API__CORS_ORIGINS`. Tambahkan domain UI ke daftar itu. |
| `422 invalid_layer` di `/series/stock` | Bug `layers` berkoma — task `docs/07` **B19b**. |
| Build frontend gagal di `tsc` | `npm run build` menjalankan `tsc --noEmit`; jangan pakai `npm ci --omit=dev`. |
| Container backend restart terus | `db-init` gagal (volume tanpa izin tulis). Pastikan `/app/data` writable oleh user container. |
