# AGENTS.md — frontend

Kamu bekerja di `frontend/` (React 19 + TS + Vite + Tailwind v4). Aturan lengkap ada di `../AGENTS.md`, task di `../docs/08-TASKS-FRONTEND.md`.

Baca berurutan: `../docs/08-TASKS-FRONTEND.md` → `../docs/05-API-CONTRACT.md` → `../docs/06-DESIGN-SYSTEM.md` (token warna, mock UI, daftar filter) → `../config/default.yaml`.

Ringkas:
- Pakai skill **ponytail** (full).
- Bangun UI dengan **MSW + fixture** dari `../docs/05-API-CONTRACT.md` supaya tidak menunggu backend.
- **Jangan menghitung rumus finansial** dan jangan mengubah nama field API. Field kurang → catat di `../docs/DECISIONS.md`.
- Warna hanya dari token `src/styles/tokens.css` (+ 11 warna sektor). Semua string UI Bahasa Indonesia, angka format Indonesia.
- Filter hidup di URL (`src/lib/urlFilters.ts`), bukan di state terpisah.
- Selesai satu task → screenshot + catatan di `../docs/PROGRESS.md`.
- Jalankan: `npm run dev` (proxy `/api` → `127.0.0.1:8000`), `npm run build`, `npx vitest`, `npx playwright test`.
