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
**Deliverable:** `components/charts/QuadrantChart.tsx` sesuai dokumen 06 §6 + **§6.1 mode fokus**: zona kuadran 4%, grid, garis 100, ekor bertingkat, titik terakhir + ring, label anti-tumpuk, hover `PointCard`, **hover/klik → titik terfokus terang + semua titik & ekor lain meredup (0,22 / 0,18)**, klik = pin, navigasi keyboard (`Tab`/`←`/`→`/`Enter`/`Esc`) + `aria-live` satu baris, animasi masuk 180ms (dimatikan pada `prefers-reduced-motion`), kalau `tail` kosong cukup titik tanpa ekor.
**AC:**
1. Fixture 11 sektor: tidak ada label bertumpuk; ekor 3 titik tampil dengan opasitas bertingkat; rentang sumbu selalu memuat 100 dan simetris; angka di hover identik dengan baris tabel.
2. Mode fokus (`docs/06 §6.1`): hover satu titik → titik itu opacity 1 + r membesar + dirender paling atas, **titik lain opacity 0,22** dan ekor lain 0,18, label lain hilang, sedangkan garis 100 & zona kuadran tidak meredup. Dibuktikan dengan mengukur atribut `opacity` di DOM, bukan hanya screenshot.
3. Pin: klik titik → fokus bertahan walau mouse keluar chart; klik area kosong / `Esc` → lepas; klik baris tabel → pin pindah (dua arah, satu state).
4. Keyboard: `Tab` masuk → titik pertama fokus; `←`/`→` pindah titik (fokus ikut berpindah); `Enter` pin; `Esc` lepas + fokus kembali ke elemen sebelumnya; `aria-live` berisi nama + kuadran + RS-Ratio + RS-Momentum.
5. `tail: []` → hanya titik, tanpa error.
6. Scope saham: fixture 1 sektor 60 saham → default 25 titik (skor tertinggi) + tautan "lihat semua di tabel", tanpa label bertumpuk.
**Bukti:** screenshot normal / hover / pin / tanpa-ekor + test yang mengukur `opacity` dan urutan `Tab`.

## F5 — Tabel & filter
**Deliverable:** `SectorTable` (11 kolom dokumen 06 §5, sortable, header sticky, highlight baris sektor terpilih), `FilterBar` (semua filter dokumen 06 §7 + preset cepat + chip aktif + reset), `AsOfPicker` (pakai `GET /api/v1/meta/dates` — hari tanpa data dinonaktifkan; daftar kosong → `<input type="date">` biasa), sinkron dengan URL.
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

## F10 — Halaman Status (kesegaran data) — baca-saja
**Pembagian tugas dengan F12:** F12 = **aksi** (tombol menjalankan pipeline). F10 = **pembacaan** (kondisi data + riwayat run). Tombol `Jalankan` tidak diduplikasi di sini — cukup tautan "Buka halaman Data" ke `/data`.
**Deliverable:** `/status` — pill besar gate midday (`ok/stale`), waktu bar terakhir per probe ticker, daftar `ingest_run` (`GET /api/v1/admin/runs?limit=20`, komponen boleh dipakai ulang dari F12), info config aktif (`meta/config`).
**AC:** halaman tidak pernah error walau semua endpoint mengembalikan `null`; status `stale` punya penjelasan tindakan ("data Yahoo belum 11:30, coba lagi nanti").
**Bukti:** screenshot 2 skenario gate.

## F11 — Aksesibilitas, performa, finishing
**Deliverable:** axe bersih (0 violation WCAG2AA) di kedua tema, `prefers-reduced-motion` dihormati, tidak ada CLS (skeleton dengan tinggi akhir), bundle JS awal < 250 KB gzip (route-level `lazy`), README frontend (cara run, cara pakai MSW, cara ganti ke backend nyata).
**AC:** `npx playwright test` hijau; lighthouse performa ≥ 90 pada build produksi lokal; `npm run build` tanpa warning TS.
**Bukti:** output axe, playwright, ukuran bundle.

## F12 — Halaman Data / Pipeline (WAJIB: user menjalankan end-to-end dari sini)

Konteks: user **tidak** akan menjalankan CLI. Dia menjalankan seluruh pipeline (import sektor → ambil harga → hitung → tengah hari) dari UI ini saat semua sudah jadi. Jadi halaman ini bukan pelengkap — ini pintu masuk satu-satunya.

**Deliverable:** `/data` — halaman stepper vertikal dengan 6 tombol pipeline dari `docs/05 §4.1`, ditambah panel riwayat run.

Isi tiap baris stepper:
- Nomor + judul + satu baris penjelasan singkat (Bahasa Indonesia, tanpa jargon).
- Tombol aksi (`Jalankan`), `status chip` (`belum pernah | terakhir ok 12 Okt 07:02 | gagal 2x`).
- Prasyarat yang belum terpenuhi → tombol `disabled` + alasannya ditulis, mis. "Jalankan 'Import sektor' dulu".
- Saat jalan: progress bar (`percent`) + `message` dari run (mis. "batch 9/20") + tombol `Batalkan` **tidak perlu** di v1 (jangan bangun cancel kalau backend belum janji).

Alur teknis (ikuti `docs/05 §5.1`):
```ts
// lib/api.ts
startRun(kind, body) → POST ...?async=true → { run_id }
// useRun(runId) → poll GET /admin/runs/{run_id} tiap 1s selama status queued|running
// saat status final → toast + queryClient.invalidateQueries() untuk data terkait + refresh daftar run
```
- Import Excel (tombol 1) = `<input type="file" accept=".xlsx">` + `FormData`; tampilkan hasil `inserted/updated/deactivated/errors[]` (tabel baris gagal, bisa di-expand).
- Tombol 2 (Ambil harga harian) → dialog konfirmasi dulu (jumlah emiten aktif + "±1,5 menit"), karena ini operasi berat dan memanggil Yahoo ratusan kali.
- Tombol 4 (`Hitung semua`) dan 5 (`Hitung mingguan`) → tombol 5 `disabled` dengan catatan "tersedia setelah penutupan Jumat" bila backend menolak (`409 gate_weekly_not_final`).
- Tombol 6 (`Tengah hari`) → kalau respons `gate: "stale"`, tampilkan pesan jelas: "Data Yahoo belum sampai sesi 1 (bar terakhir 11:05 WIB < 11:30 WIB). Coba lagi nanti." Bukan toast merah error.
- Panel riwayat: `GET /admin/runs?limit=20` → tabel `kind, status, mulai, durasi, rows, pesan`; klik baris → detail (`params_json`, `result_json`, `failed_tickers`). Ini yang dipakai user untuk tahu apa yang gagal tanpa buka terminal.

**AC:**
1. Dari kondisi DB kosong, tombol 1→6 bisa dijalankan berurutan sampai selesai hanya dengan klik, tanpa membuka terminal. Bukti: rekaman urutan klik + screenshot tiap state.
2. Tombol 2–6 `disabled` dengan alasan tepat saat prasyarat belum ada (uji: DB kosong → semua terkunci kecuali tombol 1).
3. Progres berjalan: progress bar bergerak (poling 1 s) dan berhenti di status final; tidak ada request poll yang tetap jalan setelah status final (uji: hitung request, harus berhenti).
4. `409` dari backend (semua 4 kode di `docs/05 §4.1`) ditampilkan sebagai pesan yang bisa dimengerti, bukan stack trace.
5. Import Excel menampilkan baris gagal per sheet (`reason` diterjemahkan ke kalimat Indonesia).
6. Riwayat run menampilkan minimal 20 run terakhir dan menandai yang `failed`/`partial` mencolok.

**Bukti:** screenshot tiap state + daftar request yang dikirim (tab Network) + hasil akhir `GET /admin/runs`.

## F14 — Filter rotasi (kuadran) saham di detail sektor

**Latar:** di `SectorDrawer` ada bagian "RRG saham sektor ini", tapi user tidak bisa menyaringnya — untuk "siapa yang tertinggal di sektor ini" dia harus pindah ke halaman Saham dan menyetel filter di sana.

**Deliverable:** satu baris chip di dalam section `RRG saham sektor ini`: `Semua` + `Memimpin` + `Membaik` + `Melemah` + `Tertinggal` (label dari `lib/quadrant.ts`, jangan tulis ulang). Single-select, chip aktif `aria-pressed=true`. Pakai komponen rumah (`Segmented` — sudah dipakai pemilih `weighting`), jangan bikin kontrol baru.
- Jumlah per kuadran dibaca dari `rrg.data.quadrants` (sudah ada di respons `/rrg` yang memang dipanggil drawer). **Tidak boleh** memanggil endpoint tambahan per chip: tampilkan `Tertinggal (53)` dan `Semua (99)` dari satu respons itu.
- Efeknya dua tempat, satu state: (a) titik RRG yang kuadrannya tidak cocok dibuang **sebelum** chart (batas 25 titik + catatan "lihat semua di tabel" berlaku setelah filter), (b) tabel konstituen mengirim `quadrant[]` ke `GET /stocks` supaya `total` & paginasi benar — bukan menyaring 20 baris yang sudah diunduh.
- State lokal drawer (sama seperti `sort`/`dir` yang sudah lokal di sana), **bukan** URL: `?quadrant=` di URL sudah milik `FilterBar` halaman untuk kuadran **sektor**; satu param dua arti = menyesatkan. Alasan ini wajib masuk `DECISIONS.md`.
- Kirim `as_of` dari `AsOfPicker` ke **kedua** query (chart & tabel). Hari ini chart tidak menerimanya, jadi saat user memilih tanggal lama angka chart & tabel bisa beda tanggal (lihat backend B16).
- Kuadran terpilih berisi 0 saham → `EmptyState` + tombol "Tampilkan semua", bukan chart kosong tanpa penjelasan.

**AC:**
1. `Semua` = perilaku sekarang (regresi: 99 saham IDXFINANCE → 25 titik + catatan cap tetap muncul).
2. Pilih `Tertinggal`: chart hanya memuat titik kuadran itu, dan `total` tabel **sama dengan angka chip** (silang: `GET /stocks?timeframe=d1&sector=IDXFINANCE&quadrant=lagging` → `total`; angka ini memang beda per timeframe, jadi bandingkan pada timeframe yang sama).
3. Filter bertahan saat `timeframe`/`window`/`weighting`/`as_of` diganti dari topbar; hasil 0 → EmptyState di atas.
4. Tanpa request tambahan untuk hitungan chip (bukti tab Network: per klik hanya `/stocks` dengan `quadrant[]`, bukan 5× `/stocks`).
5. Keyboard & a11y: chip di-Tab, `Enter`/`Space` memilih, `aria-pressed` benar, `PointCard` tetap memuat angka yang sama dengan baris tabel.
6. Penyaring jadi fungsi murni **di `lib/quadrant.ts`** (`filterByQuadrant(items, quadrant)` — sengaja bukan di `lib/rrgChart.ts`, supaya F14 tidak bentrok file dengan F15/F16 yang berjalan paralel) dengan unit test ≥ 4 kasus (`Semua`, satu kuadran, kuadran kosong, item tanpa kuadran).

**Bukti:** screenshot 3 state + output vitest + potongan tab Network.
Referensi: `docs/06` §5 (`SectorDrawer`), §6.4 (aturan chip), `docs/05` §2 (`/stocks` sudah punya `quadrant[]`, `/rrg` sudah punya `quadrants`).

## F15 — Kartu hover RRG tidak menutupi ekor & pergerakan

**Latar:** saat hover satu titik, `PointCard` muncul di samping titik dengan offset tetap dan menutupi ekornya sendiri plus titik/ekor tetangga — user kehilangan justru informasi yang sedang dibaca (arah & panjang ekor).

**Deliverable:** posisi kartu dihitung, bukan tetap:
- Arah gerak titik = vektor `tail[-2] → tail[-1]`; kartu diletakkan di sisi **berlawanan ekor** (ruang yang baru ditinggalkan titik), bukan menimpa ekornya.
- `tail < 2` (warmup) → fallback: sisi menjauhi pusat chart.
- Kartu tidak boleh keluar kotak chart: clamp 8px; kalau sisi pilihan kurang ruang → `flip` ke sisi seberang.
- Kartu tetap `pointer-events: none`, tetap muncul saat hover entri legenda (`docs/06` §6.2 tidak berubah).
- Hitungannya jadi fungsi murni `cardPlacement()` di `lib/rrgChart.ts` (input: titik, titik ekor sebelumnya, kotak chart, ukuran kartu) supaya bisa diuji tanpa DOM; `QuadrantChart` hanya memakainya.

**AC:**
1. Unit test 8 arah gerak + kasus tanpa ekor → anchor yang diharapkan, dan tidak ada kasus yang menaruh kartu searah ekor.
2. Titik di 4 sudut chart → kartu tetap di dalam kotak (uji DOM: `getBoundingClientRect(kartu)` ⊆ kotak chart, toleransi 1px).
3. Anti-tumpang diukur, bukan dilihat: irisan kotak kartu dengan segmen ekor titik itu = 0 (angka dilaporkan di PROGRESS).
4. Hover lewat legenda → kartu tetap di posisi titiknya (regresi §6.2).
5. `prefers-reduced-motion` tetap 0 ms; titik di balik kartu tetap bisa di-hover/klik.

**Bukti:** screenshot before/after untuk 4 kuadran + angka irisan (0) + output vitest.
Referensi: `docs/06` §6.3 (aturan baru), §6.1 & §6.2.

## F16 — Kode saham (ticker) di label, legenda, dan kartu RRG saham

**Latar:** `docs/06` §6.2 sudah menulis entri legenda scope saham = **ticker**, tapi kode menampilkan `item.name` (nama perusahaan) di label titik, legenda, dan `PointCard`. Untuk saham, ticker yang dicari user di sekuritas — nama panjang justru menambah label bertumpuk.

**Deliverable:** untuk `scope=stock` (mini-RRG drawer & RRG halaman saham):
- label titik chart = ticker (`ref_id`), mono;
- entri legenda = `TICKER · Nama` (dot warna + `QuadrantBadge` + `StreakBadge` tidak berubah), nama panjang dipotong `truncate` + `title` = nama penuh;
- judul `PointCard` = `TICKER · Nama`;
- teks aria (`describePoint`) & `aria-live` memuat ticker;
- pencarian legenda cocok pada ticker **dan** nama (sudah begitu — jangan diregresikan).
`scope=sector` tidak berubah (nama sektor, tanpa kode).

**AC:**
1. Drawer sektor: label titik terbaca `POLA`, legenda `POLA · Pool Advista Finance`, kartu memuat keduanya.
2. Fixture 25 saham: tidak ada label bertumpuk baru (ambang pixel `docs/06` §6 tidak diubah) — ticker memperpendek label, bukan memperpanjang.
3. Regresi scope sektor: label tetap `Keuangan` dsb, tidak ada ticker di legenda sektor.
4. `describePoint` & `aria-live` memuat ticker (uji teks DOM); helper label (`stockLabel()` di `lib/rrgChart.ts`) punya unit test.
5. Tidak ada perubahan API/field (ticker = `ref_id` yang sudah ada) → `api_version` tetap.

**Bukti:** screenshot chart + legenda scope saham, output vitest, potongan teks `aria-live`.
Referensi: `docs/06` §6 (label) & §6.2 (entri legenda).

## F17 — Analisa teknikal di UI (satu task: panel detail + kolom insight + tombol 7)

**Latar:** fitur baru `docs/01` §3 butir 14. Rumus `docs/03` §10, kontrak `docs/05` §2 (`/ta/summary`, `/ta/{scope}/{ref_id}`) + §4.1 (tombol 7), tampilan `docs/06` §5.1. Frontend **tidak menghitung** apa pun.

**Deliverable (satu task):**
1. Komponen `TaPanel` sesuai `docs/06` §5.1, sumber `GET /api/v1/ta/{scope}/{ref_id}`: segmented MA (`10`/`20`/`50`) + toggle "filter tren MA50" (default dari `/meta/config.ta`); 4 angka besar (`+5% dulu`, median periode ke +5%, median periode ke −5%, jumlah event); baris "terakhir breakout" (tanggal sinyal → entry, `entry_price` berlabel **harga penyesuaian**, umur `periods_since`, `gain_since` via `Delta`, status `Badge`: `+5% dulu` / `−5% dulu` / `belum selesai` / `lewat batas`); baris perbandingan "dengan filter tren … · tanpa filter …" dari `stats.filter_on`/`filter_off` (**satu** permintaan); tabel maks 20 event terakhir; baris catatan `coverage` (emiten diuji/dilewati, rentang tanggal, `price_basis`). Dipasang di `SectorDrawer` (section baru setelah konstituen) **dan** `StockPage` — satu komponen, bukan dua implementasi.
2. Kolom insight di `SectorTable` + `StockTable`: `+5% dulu`, `median periode`, `terakhir breakout` (mis. `6 Okt · 5 periode` + badge hasil), sumber **satu** permintaan per halaman `GET /api/v1/ta/summary` untuk semua `ref_id` yang tampil; `sort` = `win_rate|median_periods|last_breakout|…` diteruskan ke API.
3. Halaman Data mengikuti `docs/05` §4.1 versi baru: stepper **8 langkah** — tombol **7 "Hitung analisa teknikal (MA & backtest)"** (`POST /admin/compute?async=true {"stage":"ta"}`) dengan chip status, prasyarat, progres, dan `result_json` (jumlah event, win rate) di panel riwayat; tombol **8 "Refresh data tampilan"** (dulu 7); chip/riwayat mengenali `kind=compute_ta`; teks tombol 4 menyebut `Hitung semua` sudah termasuk analisa teknikal; setelah run `ok` → invalidate query `/ta/*` supaya tabel & panel segar.

**AC:**
1. Ganti `ma_period`/toggle filter → panel & kolom berubah **tanpa reload**; state bertahan selama drawer terbuka.
2. `win_rate` `null` → `—` (bukan `0%`); `expired`/`open` tidak dihitung sebagai kalah dan jumlahnya terlihat.
3. Uji silang: 3 ticker → angka panel = angka `/ta/summary` untuk `ref_id`, `ma_period`, `trend_filter` yang sama; angka kolom = angka panel.
4. Tidak ada permintaan `/ta/*` per baris tabel (bukti Network: 1 permintaan per halaman; chip/tombol lain sesuai).
5. Entitas tanpa event → EmptyState singkat ("belum ada breakout pada periode MA ini"); halaman saham tanpa metrik tetap `—`.
6. DB/`price_daily` kosong → tombol 7 `disabled` + alasan tertulis; `409 prereq_no_prices` dari backend ditampilkan sebagai pesan Indonesia, bukan stack trace.
7. Semua string UI Bahasa Indonesia (tidak ada `win_rate`/`leading` mentah di teks), angka format Indonesia, harga TA berlabel "harga penyesuaian".

**Bukti:** screenshot (panel di drawer + halaman saham × 2 state filter, kolom tabel, 3 state tombol 7: disabled / jalan / selesai) + potongan tab Network + hasil uji silang 3 ticker + 4 perintah hijau (`npx tsc --noEmit`, `npx vitest run`, `npx playwright test`, `npm run build`).
Ketergantungan: butuh backend `B17` untuk data nyata — boleh dibangun dengan MSW memakai contoh `docs/05` §2 (kontrak beku). Kalau field kurang → tulis `docs/DECISIONS.md`, jangan menghitung sendiri.
Commit (satu task satu commit): `F17: panel analisa teknikal + kolom insight + tombol hitung TA`.

### Urutan & paralel (F14–F17)

| Bisa paralel | Tidak boleh paralel |
|---|---|
| F14 ∥ F15 — F14 wajib menaruh helper di `lib/quadrant.ts` (bukan `lib/rrgChart.ts`) | F15 vs F16 — dua-duanya `QuadrantChart.tsx` + `lib/rrgChart.ts` |
| F17 berkas utamanya `SectorDrawer.tsx` → jalankan **setelah** F14 | F14 vs F17 — dua-duanya `SectorDrawer.tsx` |
| Semua task frontend ∥ task backend (folder berbeda) | F17 setelah F14 selesai (bukan cuma ditulis) |

---

## Aturan tambahan untuk agen frontend

1. **Jangan menghitung rumus finansial apa pun** (kuadran, RS, skor, ATR). Semua dari API; kalau field kurang → catat di `DECISIONS.md` dan minta backend, jangan hitung sendiri.
2. **Jangan pakai warna hardcoded** kecuali warna sektor (yang juga punya token).
3. Semua string UI **Bahasa Indonesia**, angka format Indonesia (koma desimal).
4. Filter hanya di URL (`lib/urlFilters.ts`). Tidak ada state filter ganda di context/zustand.
5. Kalau bentuk response `docs/05` ternyata berbeda saat backend selesai: **backend yang salah** → lapor, jangan buat adapter diam-diam.
6. **Jangan menjalankan pipeline skala penuh saat development.** Pakai MSW untuk UI, dan untuk uji nyata cukup DB kecil (mis. 10–20 emiten). Backfill 962 emiten adalah wewenang user, dijalankan sekali dari halaman Data saat semuanya sudah jadi.
7. Setelah setiap task: update `docs/PROGRESS.md` (status + bukti screenshot/output). Task tanpa bukti = belum selesai.
