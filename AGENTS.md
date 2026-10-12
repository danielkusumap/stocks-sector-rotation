# AGENTS.md — aturan untuk agen (OpenCode) di repo ini

Repo: **Sector Rotation IDX** — backend FastAPI + SQLite, frontend React/TS.
Ada **dua agen yang bekerja terpisah**: satu di `backend/`, satu di `frontend/`.

## Wajib dibaca dulu (jangan mulai sebelum ini)

- Backend → `docs/07-TASKS-BACKEND.md`
- Frontend → `docs/08-TASKS-FRONTEND.md`
- Keduanya → `docs/05-API-CONTRACT.md` (**sumber kebenaran bentuk data**), `config/default.yaml`
- Tampilan → `docs/06-DESIGN-SYSTEM.md` (wajib untuk frontend)
- Rumus → `docs/03-METHODOLOGY.md` (wajib untuk backend)

## Aturan mengikat

1. **Gunakan skill `ponytail` (mode `full`) untuk semua pekerjaan.** Solusi paling kecil yang benar-benar jalan: stdlib/API bawaan dulu, dependency baru terakhir, diff terpendek, tanpa abstraksi yang tidak diminta. Setiap laporan diakhiri 1–2 baris: apa yang kamu lewati dan risiko yang perlu user tahu.
2. **Catat keputusan** yang menyimpang dari dokumen planning di `docs/DECISIONS.md` (format ADR sudah ada di file itu).
3. **Update `docs/PROGRESS.md` setiap task selesai** — status + bukti nyata (output command, hasil test, path screenshot). Task tanpa bukti dianggap belum selesai. Jangan menandai `done` hanya karena "seharusnya jalan".
4. **Angka ambang hanya di `config/default.yaml`.** Tidak ada threshold hardcoded. Backend mengeksposnya lewat `GET /api/v1/meta/config`.
5. **Jangan menghitung rumus finansial di frontend** dan **jangan mengubah bentuk response API** tanpa menaikkan `api_version` + mencatat di `DECISIONS.md`.
6. Buka **root repo**, bukan subfolder, supaya `docs/` terlihat.
7. Bahasa UI: **Indonesia**. Angka format Indonesia (koma desimal, titik ribuan). Kode/komentar: Inggris singkat.
8. Zona waktu tunggal **Asia/Jakarta (UTC+7)**.
9. Jangan menambah fitur di luar `docs/01` §3. Usul fitur → tulis di `DECISIONS.md` bagian "usul", jangan dibangun.
10. Rahasia/kunci tidak masuk repo (`.env` di-gitignore). `data/rotation.db`, `node_modules`, `dist`, `.venv` di-gitignore.
11. **Satu task = satu commit.** Setelah satu task selesai (kode jalan + `docs/PROGRESS.md` diperbarui + bukti nyata ada), langsung commit:

    ```
    git add -A
    git commit -m "B0: skeleton FastAPI, loader config, db-init"
    ```

    Format pesan: `<TASK-ID>: <ringkasan imperatif, huruf kecil, tanpa titik di akhir>`. Contoh lain: `B4: indeks sektor equal/turnover/captier`, `F4: QuadrantChart RRG + ekor`, `docs: koreksi rumus RS-Momentum`. Untuk perubahan non-task: awali `docs:`, `fix:`, `chore:`, `refactor:`.
    Larangan: jangan mencampur dua task dalam satu commit; jangan commit saat test merah; jangan commit `data/rotation.db` atau file `.xlsx` lain (hanya `saham_sektoral.xlsx` yang ikut).
12. Jangan `git push` ke remote apa pun kecuali user secara eksplisit meminta. Repo ini lokal dulu.

## Kondisi awal repo (sudah diverifikasi user)

- `yfinance 1.7.0` sudah diuji terhadap `.JK` (detail bukti di `docs/02-DATA-SOURCES.md` §1).
- Indeks sektor IDX **tidak tersedia** di Yahoo → dihitung sendiri.
- Belum ada kode apa pun. Task pertama backend: `B0`. Task pertama frontend: `F0` (frontend boleh jalan duluan dengan MSW + fixture dari `docs/05`).
