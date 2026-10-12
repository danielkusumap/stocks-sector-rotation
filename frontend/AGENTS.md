# AGENTS.md — frontend

Kamu bekerja di `frontend/` (React 19 + TS + Vite + Tailwind v4). Aturan lengkap ada di `../AGENTS.md`, task di `../docs/08-TASKS-FRONTEND.md`.

Baca berurutan: **`../docs/CHEATSHEET-FRONTEND.md` (baca ini DULU — inventaris file, aturan, perintah, checklist)** → `../docs/08-TASKS-FRONTEND.md` (hanya task yang sedang dikerjakan) → `../docs/05-API-CONTRACT.md` (hanya kalau butuh bentuk response) → `../docs/06-DESIGN-SYSTEM.md` (hanya kalau butuh spesifikasi tampilan).

Jangan membaca seluruh `docs/` di awal setiap task — itu biaya waktu terbesar per task. Cheatsheet sudah merangkum yang berulang; dokumen besar dibuka per bagian sesuai kebutuhan.

Ringkas:
- Pakai skill **ponytail** (full).
- Bangun UI dengan **MSW + fixture** dari `../docs/05-API-CONTRACT.md` supaya tidak menunggu backend.
- **Jangan menghitung rumus finansial** dan jangan mengubah nama field API. Field kurang → catat di `../docs/DECISIONS.md`.
- Warna hanya dari token `src/styles/tokens.css` (+ 11 warna sektor). Semua string UI Bahasa Indonesia, angka format Indonesia.
- Filter hidup di URL (`src/lib/urlFilters.ts`), bukan di state terpisah.
- Selesai satu task → screenshot + catatan di `../docs/PROGRESS.md`.
- Jalankan: `npm run dev` (proxy `/api` → `127.0.0.1:8000`), `npm run build`, `npx vitest`, `npx playwright test`.
