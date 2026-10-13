# Frontend — Sector Rotation IDX

React 19 + TypeScript + Vite + Tailwind v4. Semua angka datang dari API backend (tidak ada
rumus finansial di sini); filter hidup di URL; warna hanya dari token di `src/styles/tokens.css`.

Panduan kerja agen ada di `AGENTS.md` (folder ini) dan `../AGENTS.md` (root repo).

## 1. Pasang

```bash
npm install
```

Butuh Node ≥ 20 (diuji dengan Node 26).

## 2. Jalankan mode mock (tanpa backend)

```bash
npm run dev            # http://localhost:5173
```

Di mode dev, **MSW aktif**: semua `/api/*` dijawab dari fixture `src/mocks/` (tidak butuh
backend hidup, tidak menyentuh DB). Knob skenario lewat URL halaman:

| URL | Skenario |
|---|---|
| `/` | data normal (fixture) |
| `/?mock=stale` | gate tengah hari `stale` (bar terakhir 11:05) |
| `/?mock=notfriday` | hari kerja → `compute` mingguan ditolak `409 gate_weekly_not_final` |
| `/?mock=empty` | daftar/tabel kosong |
| `/?mock=fail` | endpoint mengembalikan galat (uji `ErrorState`) |

## 3. Jalankan mode nyata (pakai backend)

Urutannya: **backend dulu, baru frontend.**

```bash
# 1) dari root repo — backend di http://127.0.0.1:8000
.venv/Scripts/python.exe -m backend.cli serve        # atau: uvicorn backend.app.main:app

# 2) dari folder frontend/ — MSW dimatikan, /api diteruskan proxy Vite ke 127.0.0.1:8000
npm run dev:real
```

`dev:real` = `vite --mode real`, dan `.env.real` berisi `VITE_MOCKS=off` — jadi perintahnya
sama di PowerShell, cmd, maupun bash. Kalau mau lewat variabel lingkungan (bash/git-bash):

```bash
VITE_MOCKS=off npm run dev          # PowerShell: $env:VITE_MOCKS="off"; npm run dev
```

Kalau backend mati, halaman menampilkan keadaan galat (`Coba lagi`) — itu tanda mode nyata
sedang aktif dan permintaan benar-benar keluar ke backend, bukan dijawab MSW.

**Pengambilan & pengolahan data dijalankan user dari halaman `/data`** (tombol stepper 1→6,
`POST /admin/*?async=true`). Frontend tidak pernah menjalankan pipeline sendiri: saat
membuka halaman tidak ada ingest/backfill otomatis, dan tidak ada data contoh yang ditulis ke DB.

## 4. Build & jalankan hasil build

```bash
npm run build          # tsc --noEmit + vite build → dist/
npm run preview        # http://localhost:4173, proxy /api tetap diteruskan ke 127.0.0.1:8000
```

MSW **tidak ikut** ke build produksi: `vite.config.ts` memakai `build.copyPublicDir: false`,
jadi `public/mockServiceWorker.js` hanya disajikan di dev, dan bundel JS produksi tidak memuat
kode MSW (kodenya `import.meta.env.DEV` saja).

Di produksi, `dist/` dilayani server statis apa pun; `/api` harus diarahkan ke backend
(proxy seperti di dev, atau reverse proxy di depan). `npm run preview` sudah melakukannya.

## 5. Test

```bash
npm run typecheck      # tsc --noEmit — wajib 0 error
npm run test           # vitest run (unit: src/**/*.test.ts)
npm run test:e2e       # playwright test (butuh dev server; reuseExistingServer: true)
```

Spec Playwright di `e2e/` (semua jalan di dev server + MSW, bukan backend nyata):

| Berkas | Cakupan |
|---|---|
| `smoke.spec.ts` | shell, rute, stepper `/data` |
| `overview.spec.ts` | heatmap, matriks rotasi, ringkasan pasar |
| `rrg.spec.ts` | chart RRG: hover/klik, keyboard, label anti-tumpuk |
| `sector-table.spec.ts` | tabel + filter (URL), pin dua arah |
| `sector-drawer.spec.ts` | drawer detail sektor, fokus, Esc |
| `stock-list.spec.ts` / `stock-detail.spec.ts` | halaman saham |
| `weekly-picks.spec.ts` | halaman Weekly + pemilih pekan |
| `status-readonly.spec.ts` | halaman Status (baca-saja) |
| `as-of.spec.ts` | pemilih tanggal acuan |
| `a11y.spec.ts` | axe WCAG 2 A/AA 0 violation di 7 halaman × 2 tema + `prefers-reduced-motion` |
| `keyboard.spec.ts` | Tab/Enter/Esc (tabel, filter, stepper, pemilih pekan) + focus ring 2 tema |

Menjalankan satu spec:

```bash
npx playwright test e2e/a11y.spec.ts
npx vitest run src/lib/weeklyPicks.test.ts
```

## 6. Peta folder

```
src/lib/        api.ts (tipe SEMUA endpoint) · format.ts (angka Indonesia) · urlFilters.ts
                filters.ts · labels.ts · quadrant.ts · calendar.ts · heatmap.ts · rrgChart.ts
                sectorTable.ts · stockTable.ts · seriesChart.ts · weeklyPicks.ts · runStatus.ts
src/hooks/      useApiQuery.ts · useFilterState.ts · usePipeline.ts · useTheme.ts
src/components/ ui/ (komponen dasar) · charts/ · domain/ · layout/
src/pages/      Overview /sectors /stocks /weekly /status /data (+Playground, dev saja)
src/mocks/      handlers.ts · browser.ts · admin.ts · fixtures/
e2e/            spec Playwright
```
