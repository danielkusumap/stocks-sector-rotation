# CHEATSHEET FRONTEND — baca ini dulu, jangan seluruh `docs/`

Tujuan: satu task = baca file ini (~100 baris) + bagian task di `docs/08-TASKS-FRONTEND.md`. Dokumen besar (`docs/05`, `docs/06`) hanya dibuka saat benar-benar butuh bentuk response atau spesifikasi tampilan.

## Alur satu task (jangan menyimpang)

1. Baca task-nya di `docs/08-TASKS-FRONTEND.md` (hanya task itu).
2. Kerjakan. Rujuk `docs/05` **hanya** untuk bentuk response, `docs/06` **hanya** untuk aturan tampilan.
3. Loop verifikasi (cepat): `npm run typecheck` → `npx vitest run <file>` → `npm run spec -- e2e/<file>.spec.ts`.
   Penutup task: `npm run gate:full` (tsc + vitest + semua spec + build) — **sekali saja di akhir**, jangan diulang
   per mikro-edit. `npm run gate` = versi cepat tanpa spec `@a11y`/`@slow` (dipakai saat masih iterasi).
4. Update baris task di `docs/PROGRESS.md` (status + bukti).
5. Commit satu task: `git commit -m "F8: halaman saham + detail"`.

## Inventaris file (jangan bikin duplikatnya)

```
src/lib/       api.ts (TIPE SEMUA endpoint — jangan hitung ulang) · format.ts (angka Indonesia)
               filters.ts · urlFilters.ts (filter ↔ URL) · labels.ts (teks Indonesia)
               quadrant.ts (label+warna kuadran) · calendar.ts · heatmap.ts · rrgChart.ts
               sectorTable.ts · seriesChart.ts · pipeline.ts · queryKeys.ts · queryClient.ts · errors.ts · cn.ts
src/hooks/     useApiQuery.ts (semua hook baca) · useFilterState.ts · usePipeline.ts (start+poll run) · useTheme.ts
src/components/ui/        Button Panel Badge Pill Delta Drawer Popover Select Segmented Tooltip Table
                          StatCard Skeleton EmptyState ErrorState Toast ProgressBar ConfirmDialog
                          QuadrantBadge StreakBadge FreshnessPill
src/components/charts/    QuadrantChart
src/components/domain/    SectorTable FilterBar AsOfPicker PointCard ChangeList MarketSummary SectorDrawer
src/pages/                OverviewPage SectorPage StockPage WeeklyPage StatusPage DataPage PlaygroundPage
src/mocks/                handlers.ts browser.ts admin.ts fixtures/
```

Kalau butuh komponen baru: cek `ui/` dulu — hampir semua sudah ada. Kalau perlu varian, tambahkan prop, jangan bikin file baru.

## Perintah (F24)

| Perintah | Isi | Kapan |
|---|---|---|
| `npm run typecheck` | `tsc --noEmit` | tiap simpan penting (detik) |
| `npx vitest run src/lib/x.test.ts` | satu berkas unit test | saat menulis helper murni |
| `npm run spec -- e2e/x.spec.ts` | satu spec e2e | membuktikan task sendiri |
| `npm run gate` | tsc + vitest + spec **tanpa** `@a11y`/`@slow` | iterasi panjang |
| `npm run gate:full` | tsc + vitest + semua spec + build | **sekali** saat task ditutup |

Tag: spec a11y (`e2e/a11y.spec.ts`) memakai `@a11y`, spec berat (`> 30 s`) memakai `@slow` — keduanya
dilewati `npm run gate`. Playwright jalan paralel (`fullyParallel: true`, `workers: "75%"`).

## Aturan yang paling sering dilanggar

1. **Jangan hitung apa pun.** Kuadran, RS, skor, ATR, persentil — semua dari API. Angka kurang? catat di `docs/DECISIONS.md`, jangan hitung di frontend.
2. **Jangan pakai warna hardcoded.** Hanya token `src/styles/tokens.css` (+ 11 warna sektor). `grep -rn "#[0-9a-fA-F]\{6\}" src/components src/pages` harus 0 temuan.
3. **Format angka hanya lewat `lib/format.ts`** (`formatRp`, `formatRpCompact`, `formatPct`, `formatNum`, `formatDelta`, `formatDateTime`). Tidak ada `toFixed()` di komponen. Koma = desimal, titik = ribuan, minus U+2212.
4. **Tanda hanya untuk delta.** Level (`RS-Ratio`, `RS-Momentum`) tanpa tanda: `102,31`. Delta: `+0,42`.
5. **Filter hidup di URL** (`lib/urlFilters.ts` + `useFilterState`). Tidak ada state filter di context/zustand.
6. **Jangan ubah `lib/api.ts` sendiri-sendiri** kalau bekerja paralel dengan sesi lain — laporkan field yang kurang.
7. Semua teks UI **Bahasa Indonesia**. `null` → `—` (warna `--fg-faint`), bukan `0`.
8. Wajib keyboard-accessible + focus ring `--focus`. Hormati `prefers-reduced-motion`.

## Pola yang sudah baku (ikuti, jangan bikin pola baru)

**Baca data:**
```ts
const { data, isLoading, error } = useSectorSummary(params);   // hooks/useApiQuery.ts
```
Query key dari `lib/queryKeys.ts`; cache 60 s; `refetchOnWindowFocus: false`.

**Memicu pipeline (halaman Data, F12 sudah jadi):**
```ts
const { start, run, isRunning } = usePipeline();   // hooks/usePipeline.ts
start("prices_daily", { mode: "daily" });          // POST ?async=true → run_id
// hook mem-poll GET /admin/runs/{run_id} tiap 1 s sampai status final, lalu invalidateQueries
```
Tombol pipeline wajib: disabled + alasan saat prasyarat belum ada, progress dari `percent`/`message`, pesan manusiawi untuk `409` (`prereq_*`, `gate_*`).

**Kartu hover RRG vs baris tabel:** angka & format harus identik untuk `ref_id` yang sama.

## Perintah

```bash
npm run dev            # vite + proxy /api → 127.0.0.1:8000 (MSW aktif di dev, ?mock=ok|stale)
npm run typecheck      # tsc --noEmit — WAJIB bersih
npm run test           # vitest run (semua) — pakai `npx vitest run <file>` saat iterasi
npm run test:e2e       # playwright (smoke) — jalankan sebelum commit task, bukan tiap simpan
npm run build          # tsc + vite build
```

## Checklist sebelum commit

- [ ] `npm run typecheck` bersih, `npm run test` hijau, `npm run build` lolos
- [ ] `npm run test:e2e` hijau (smoke tidak boleh rusak)
- [ ] tidak ada warna hardcoded, tidak ada `toFixed`, tidak ada angka finansial dihitung di frontend
- [ ] state kosong/`null`/error/gagal-fetch semuanya punya tampilan (bukan layar putih)
- [ ] baris task di `docs/PROGRESS.md` terisi + bukti (screenshot/output test)
- [ ] commit `<TASK-ID>: <ringkasan imperatif>`
