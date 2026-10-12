# 08 — Task Frontend (agen frontend)

Kamu mengerjakan folder `frontend/`. Baca dulu: `docs/05-API-CONTRACT.md` (bentuk data), `docs/06-DESIGN-SYSTEM.md` (tampilan), `config/default.yaml`.

**Stack wajib:** React 19 + TypeScript (strict) + Vite + TanStack Query v5 + React Router v7 + Tailwind CSS v4 (`@theme inline` dari token di dokumen 06) + Radix primitives (popover/drawer/select/tooltip) + `d3-scale` & `d3-shape` (chart, tanpa library chart) + Lucide React + `clsx`/`tailwind-merge`.
**Testing:** Vitest + Testing Library untuk logika/filter; 1 smoke test Playwright (buka Overview, ganti timeframe, klik sektor, assert drawer terbuka).
**MSW** dipakai supaya seluruh UI bisa dibangun & diuji sebelum backend siap, memakai JSON di `docs/05` apa adanya.

---

## F0 — Skeleton & token
**Deliverable:** Vite + TS strict + Tailwind v4, `styles/tokens.css` (dua tema dari dokumen 06 §2, termasuk 11 warna sektor §3), `AppShell` (sidebar 5 menu, topbar, toggle tema tersimpan di `localStorage` + hormati `prefers-color-scheme` pada kunjungan pertama), routing 5 halaman dengan placeholder, proxy `/api` → `http://127.0.0.1:8000`.
**AC:** `npm run build` tanpa error TS; tema berganti tanpa flash; tidak ada warna hardcoded (`grep -r "#[0-9a-fA-F]\{6\}" src/components` hanya boleh menemukan file token).
**Bukti:** screenshot dark & light di `docs/evidence/`.

## F1 — Layer data
**Deliverable:** `lib/api.ts` (fetch + tipe TS hasil-generate manual dari `docs/05`, satu tipe per endpoint), TanStack Query hooks (`useRrg`, `useSectorSummary`, `useSector`, `useStocks`, `useStock`, `useWeeklyPicks`, `useBriefing`, `useFreshness`, `useMetaConfig`), `lib/urlFilters.ts` (baca/tulis semua filter ke URL: single source of truth), MSW handler + fixture dari dokumen 05.
**AC:** mengubah URL → query key berubah & data ikut berubah; setiap tipe field di `docs/05` punya padanan TS (tidak ada `any`); `queryClient` default: `staleTime` 60s, retry 1, `refetchOnWindowFocus: false`.
**Bukti:** `npx tsc --noEmit` bersih + daftar tipe.

## F2 — Komponen UI dasar
**Deliverable:** Button, Card/Panel, Segmented, Select, Popover, Drawer, Tooltip, Badge, Pill, Skeleton, EmptyState, ErrorState, Toast, tabel primitives (Table, Th, Td dengan `sortable`), `StatCard`, `QuadrantBadge`, `StreakBadge`, `FreshnessPill`.
**AC:** semua bisa diakses keyboard; fokus ring terlihat di kedua tema; Table punya `<caption>`/`aria-label`; komponen tanpa angka terformat sendiri (lewat `lib/format.ts`).
**Bukti:** halaman `/playground` (dev-only, tidak di bundle produksi) menampilkan semua komponen di dua tema.

## F3 — Format & util
**Deliverable:** `lib/format.ts` (`formatRp`, `formatRpCompact` — T/M/jt, `formatPct` dengan koma & tanda eksplisit, `formatNum`, `formatDelta`), `lib/quadrant.ts` (label Indonesia, warna token, deskripsi dari dokumen 03 §3), `lib/format.test.ts`.
**AC:** test lulus untuk: `1180000000000 → "1,18 T"`, `980000000 → "980,0 jt"`, `0.0181 → "+1,81%"`, `null → "—"`, `-0.0045 → "−0,45%"` (pakai minus U+2212).
**Bukti:** output vitest.

## F4 — QuadrantChart (RRG)
**Deliverable:** `components/charts/QuadrantChart.tsx` sesuai dokumen 06 §6: zona kuadran 4%, grid, garis 100, ekor bertingkat, titik terakhir + ring, label anti-tumpuk, hover `PointCard`, klik → memilih sektor (mengangkat state ke halaman), animasi masuk 180ms (dimatikan pada `prefers-reduced-motion`), `aria-label` + daftar tersembunyi berisi angka (untuk screen reader).
**AC:** dengan fixture 11 sektor: tidak ada label bertumpuk; ekor 3 titik tampil dengan opasitas bertingkat; rentang sumbu selalu memuat 100 dan simetris; hover menampilkan angka yang sama dengan tabel.
**Bukti:** screenshot + 1 test yang membandingkan jumlah `<circle>` dengan jumlah sektor.

## F5 — Tabel & filter
**Deliverable:** `SectorTable` (11 kolom dokumen 06 §5, sortable, header sticky, highlight baris sektor terpilih), `FilterBar` (semua filter dokumen 06 §7 + preset cepat + chip aktif + reset), sinkron dengan URL.
**AC:** setiap kombinasi filter menghasilkan query param yang sesuai `docs/05`; reload halaman mempertahankan filter; `0 hasil` menampilkan `EmptyState` dengan tombol reset; sorting dari header mengubah `sort`/`dir` di URL.
**Bukti:** 3 URL contoh + screenshot hasilnya.

## F6 — Ringkasan pasar, heatmap, matriks rotasi
**Deliverable:** `StatCard` IHSG/breadth/regime, `HeatmapGrid` (11×4, warna dari `--up/--down` alpha 0.08–0.55, angka selalu tampil), `RotationMatrix` (4×4 + daftar perubahan), `SectorSeries` mini chart di kartu.
**AC:** angka heatmap = response `heatmap`; warna tidak pernah jadi satu-satunya penanda (selalu ada angka + tanda); regime tampil dengan kalimat penjelasan.
**Bukti:** screenshot Overview lengkap (satu tema).

## F7 — Drawer detail sektor
**Deliverable:** `SectorDrawer` (720px, buka dari klik tabel/chart, tutup dengan Esc & klik luar, fokus terkunci), isi: metrik, `SectorSeries` (indeks vs IHSG, dua garis, legend kecil), tabel konstituen (sort & filter lokal ke API), mini-RRG saham.
**AC:** URL berisi `?sector=IDXFINANCE` saat drawer terbuka (bisa di-share); `stocks?timeframe&sector` dipanggil dengan param benar; Esc menutup & fokus kembali ke baris asal.
**Bukti:** screenshot + test keyboard (Esc).

## F8 — Halaman Saham
**Deliverable:** `/stocks` (tabel semua saham + filter dokumen 06 §7 + paginasi `limit/offset` + search `q` debounce 300ms), `/stocks/{ticker}` (metrik, seri harga + `Sparkline`, RRG vs sektor, snapshot pick terakhir bila ada).
**AC:** paginasi tidak kehilangan baris (uji dengan fixture 120 saham); `q` kosong tidak mengirim param; halaman detail saham tanpa pick menampilkan `—` (bukan error).
**Bukti:** screenshot kedua halaman.

## F9 — Halaman Weekly
**Deliverable:** `/weekly` — `WeeklyPicksPanel` (blok sektor & saham, streak badge, entry/stop/target monospace, `rationale`, expander "kenapa?" berisi `rule_hits` sebagai centang), pemilih `week_end` (default minggu final terakhir), filter `min_streak`.
**AC:** badge `2w`+ hanya muncul saat `streak_weeks ≥ 2`; expander menampilkan semua rule_hits (true maupun false) dengan label Indonesia; memilih minggu berjalan → tampil catatan "belum final, tersedia setelah penutupan Jumat" dan daftar kosong (bukan error).
**Bukti:** screenshot + test pemilih minggu.

## F10 — Halaman Status (kesegaran data)
**Deliverable:** `/status` — pill besar gate midday (`ok/stale`), waktu bar terakhir per probe ticker, daftar `ingest_run`, tombol "Jalankan midday sekarang" (memanggil `/admin/midday` bila `api_key` tidak diisi; kalau diisi, tombol disembunyikan + catatan), info config aktif (`meta/config`).
**AC:** halaman tidak pernah error walau semua endpoint mengembalikan `null`; status `stale` punya penjelasan tindakan ("data Yahoo belum 11:30, coba lagi nanti").
**Bukti:** screenshot 2 skenario gate.

## F11 — Aksesibilitas, performa, finishing
**Deliverable:** axe bersih (0 violation WCAG2AA) di kedua tema, `prefers-reduced-motion` dihormati, tidak ada CLS (skeleton dengan tinggi akhir), bundle JS awal < 250 KB gzip (route-level `lazy`), README frontend (cara run, cara pakai MSW, cara ganti ke backend nyata).
**AC:** `npx playwright test` hijau; lighthouse performa ≥ 90 pada build produksi lokal; `npm run build` tanpa warning TS.
**Bukti:** output axe, playwright, ukuran bundle.

---

## Aturan tambahan untuk agen frontend

1. **Jangan menghitung rumus finansial apa pun** (kuadran, RS, skor, ATR). Semua dari API; kalau field kurang → catat di `DECISIONS.md` dan minta backend, jangan hitung sendiri.
2. **Jangan pakai warna hardcoded** kecuali warna sektor (yang juga punya token).
3. Semua string UI **Bahasa Indonesia**, angka format Indonesia (koma desimal).
4. Filter hanya di URL (`lib/urlFilters.ts`). Tidak ada state filter ganda di context/zustand.
5. Kalau bentuk response `docs/05` ternyata berbeda saat backend selesai: **backend yang salah** → lapor, jangan buat adapter diam-diam.
6. Setelah setiap task: update `docs/PROGRESS.md` (status + bukti screenshot/output). Task tanpa bukti = belum selesai.
