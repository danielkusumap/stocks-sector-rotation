# 06 — Design System & UI Spec

Tujuan: UI terlihat seperti alat analis profesional (Bloomberg/Koyfin/TradingView kelas atas), **bukan** template AI. Aturan anti-slop yang mengikat:

- **Dilarang**: gradient ungu-biru default, glow/neon berlebih, emoji sebagai ikon, kartu rounded-2xl + shadow besar di mana-mana, "hero section", ilustrasi 3D, font default Tailwind tanpa skala, warna aksen di setiap elemen.
- **Wajib**: latar netral gelap/terang yang tenang, **satu** warna aksen, angka tabular (`font-variant-numeric: tabular-nums`), garis pemisah tipis (1px, `--border`), radius kecil (6–10px), ikon SVG garis (Lucide, `stroke-width: 1.75`), kepadatan tinggi (baris tabel 36px), tanpa animasi yang tidak punya arti.

## 1. Fondasi

| Aspek | Keputusan |
|---|---|
| Font UI | `Inter Variable` (fallback `system-ui`) |
| Font angka/tabel | `JetBrains Mono` untuk kolom angka & ticker (fallback `ui-monospace`) |
| Skala teks | 11 / 12 / 13 / 14 / 16 / 20 / 24 / 32 px — UI utama 13px (padat, seperti terminal finansial) |
| Bobot | 400 body, 500 label, 600 angka penting, 700 judul panel |
| Radius | `--radius-sm: 4px`, `--radius: 8px`, `--radius-lg: 10px` |
| Spacing | kelipatan 4px; padding panel 16px; gap baris tabel 0 |
| Bayangan | hanya untuk elemen mengambang (popover/drawer): `0 8px 24px rgb(0 0 0 / .28)` |
| Grid halaman | sidebar 64px (ikon) / 216px (label, bisa ditutup) + konten maks 1680px |
| Motion | 120ms `ease-out` untuk hover/focus; 180ms untuk panel. `prefers-reduced-motion` → 0ms |
| Ikon | Lucide React, 16px, `stroke-width: 1.75` |

## 2. Token warna (OKLCH, dua tema)

Ditulis sebagai CSS variables di `frontend/src/styles/tokens.css`; Tailwind v4 memetakannya lewat `@theme inline`. **Jangan** pakai `bg-gray-800` langsung di komponen — selalu token.

```css
:root {                                     /* LIGHT (default bila OS terang) */
  --bg:            oklch(0.985 0.002 250);  /* halaman */
  --bg-subtle:     oklch(0.968 0.003 250);  /* panel sekunder, header tabel */
  --surface:       oklch(1 0 0);            /* kartu/panel utama */
  --surface-hover: oklch(0.972 0.004 250);
  --border:        oklch(0.905 0.004 250);
  --border-strong: oklch(0.84 0.006 250);
  --fg:            oklch(0.22 0.012 255);   /* teks utama */
  --fg-muted:      oklch(0.50 0.010 255);   /* label, metadata */
  --fg-faint:      oklch(0.64 0.008 255);   /* placeholder */
  --accent:        oklch(0.55 0.14 258);    /* SATU aksen: biru kalem */
  --accent-fg:     oklch(0.99 0 0);
  --accent-subtle: oklch(0.95 0.03 258);
  --up:            oklch(0.56 0.14 152);    /* hijau, harga naik */
  --down:          oklch(0.55 0.17 22);     /* merah, harga turun */
  --flat:          oklch(0.60 0.01 255);
  --warn:          oklch(0.68 0.14 75);
  --info:          oklch(0.58 0.12 235);
  --focus:         oklch(0.62 0.16 258);

  /* kuadran RRG (juga dipakai legenda & badge) */
  --q-leading:    oklch(0.60 0.13 165);   /* teal */
  --q-improving:  oklch(0.60 0.13 250);   /* biru */
  --q-weakening:  oklch(0.68 0.14 75);    /* amber */
  --q-lagging:    oklch(0.58 0.16 20);    /* merah bata */
  --q-leading-bg:   oklch(0.95 0.04 165);
  --q-improving-bg: oklch(0.95 0.04 250);
  --q-weakening-bg: oklch(0.96 0.05 75);
  --q-lagging-bg:   oklch(0.95 0.05 20);
}

[data-theme="dark"] {                       /* DARK (tema utama untuk app ini) */
  --bg:            oklch(0.175 0.008 260);
  --bg-subtle:     oklch(0.205 0.009 260);
  --surface:       oklch(0.225 0.010 260);
  --surface-hover: oklch(0.255 0.012 260);
  --border:        oklch(0.30 0.012 260);
  --border-strong: oklch(0.38 0.014 260);
  --fg:            oklch(0.93 0.004 260);
  --fg-muted:      oklch(0.70 0.010 260);
  --fg-faint:      oklch(0.56 0.010 260);
  --accent:        oklch(0.68 0.13 250);
  --accent-fg:     oklch(0.16 0.02 260);
  --accent-subtle: oklch(0.28 0.05 250);
  --up:            oklch(0.72 0.15 152);
  --down:          oklch(0.68 0.17 22);
  --flat:          oklch(0.62 0.01 260);
  --warn:          oklch(0.78 0.13 75);
  --info:          oklch(0.72 0.11 235);
  --focus:         oklch(0.72 0.14 250);

  --q-leading:    oklch(0.74 0.13 165);
  --q-improving:  oklch(0.72 0.13 250);
  --q-weakening:  oklch(0.80 0.13 75);
  --q-lagging:    oklch(0.70 0.16 20);
  --q-leading-bg:   oklch(0.30 0.05 165);
  --q-improving-bg: oklch(0.30 0.05 250);
  --q-weakening-bg: oklch(0.32 0.05 75);
  --q-lagging-bg:   oklch(0.30 0.06 20);
}
```

Aturan pemakaian warna:
- **Hijau/merah hanya untuk arah harga** (`--up`/`--down`). Jangan pakai hijau untuk "sukses" di UI finansial — bikin bingung dengan arah harga.
- Warna kuadran dipakai **hanya** untuk RRG, badge kuadran, dan heatmap kuadran. Tidak untuk tombol.
- Kontras minimum AA: teks di `--bg`/`--surface` ≥ 4.5:1; label kecil ≥ 4.5:1. Karena token OKLCH dipakai apa adanya, **uji** dengan `axe` di kedua tema sebelum menganggap task selesai.

## 3. Warna 11 sektor (tetap, dipakai di legenda, dot RRG, heatmap)

Hue berbeda, lightness seragam per tema supaya tidak ada sektor yang "terlihat lebih penting".

| Kode | Nama | Light hex | Dark hex |
|---|---|---|---|
| IDXENERGY | Energi | `#B45309` | `#F0A868` |
| IDXBASIC | Barang Baku | `#7C6F2A` | `#D6C87A` |
| IDXINDUST | Perindustrian | `#4B5563` | `#A8B0BC` |
| IDXNONCYC | Konsumen Primer | `#0F766E` | `#5FC9BE` |
| IDXCYCLIC | Konsumen Non-Primer | `#BE185D` | `#F08CB4` |
| IDXHEALTH | Kesehatan | `#0284C7` | `#6EC1F0` |
| IDXFINANCE | Keuangan | `#1D4ED8` | `#7C9BFF` |
| IDXPROPERT | Properti & Real Estat | `#7C3AED` | `#B492F8` |
| IDXTECHNO | Teknologi | `#0891B2` | `#5FD1E8` |
| IDXINFRA | Infrastruktur | `#65A30D` | `#A9D666` |
| IDXTRANS | Transportasi & Logistik | `#C2410C` | `#F09A6E` |

## 4. Kepadatan & tabel

- Header tabel: 32px, `--bg-subtle`, teks 11px uppercase `letter-spacing: .04em`, `--fg-muted`, sticky saat scroll.
- Baris: 36px, border bawah 1px `--border`, hover `--surface-hover`, tanpa zebra striping.
- Kolom angka: rata kanan, `tabular-nums`, monospace. Kolom teks: rata kiri.
- Delta ditampilkan dengan tanda eksplisit (`+1,23%` / `−0,45%`) dan warna arah; **jangan** hanya warna (aksesibilitas buta warna) → tanda selalu ada.
- Nilai `null` ditampilkan `—` dengan warna `--fg-faint`, bukan `0`.

## 5. Komponen (yang wajib ada)

| Komponen | Deskripsi & aturan |
|---|---|
| `AppShell` | Sidebar kiri (Overview, Sektor, Saham, Weekly, Status), topbar dengan judul halaman + `AsOfPicker` + `FreshnessPill` + toggle tema. |
| `TimeframeSegmented` | Segmented control: `Harian` / `Mingguan` / `Mingguan (Sen–Jum)` / `Tengah Hari`. Opsi `Mingguan (Sen–Jum)` menampilkan ikon gembok + tooltip "tersedia setelah penutupan Jumat" bila hasil final belum ada. Nilainya masuk URL. |
| `WindowSelect` | Pilih `1B/1M/3M/6M/1T/YTD` (default 3M) untuk panjang ekor & kolom return. Ada catatan kecil "tidak mengubah kuadran". |
| `AsOfPicker` | Tanggal acuan; hari tanpa data ditandai & tidak bisa dipilih. |
| `FreshnessPill` | `ok` (dot hijau + "data 12 Okt 16:10") / `stale` (dot amber + "delay") / `partial` (dot merah + "n sektor tipis"). Klik → popover detail `data_status`. |
| `QuadrantChart` (RRG) | SVG buatan sendiri (lihat §6). Ekor, crosshair di 100/100, zona kuadran berwarna 4%, hover menampilkan `PointCard`, klik → pilih sektor (sinkron dengan tabel: baris ter-highlight). |
| `PointCard` | Popover: nama, kuadran + umur, RS-Ratio/RS-Momentum + perubahan, return, turnover, streak, tombol "Lihat saham sektor ini". |
| `SectorTable` | Kolom: Sektor, Kuadran, Umur, RS-Ratio, RS-Mom, Δ1p, 1H, 1B, 3B, Turnover, Streak, Skor. Sortable semua kolom angka; baris klik → `SectorDrawer`. |
| `FilterBar` | Chip filter aktif (bisa dihapus satu-satu), tombol "Filter" (popover), "Reset". Semua nilai tercermin di URL. |
| `Sparkline` | 80×24 SVG dari seri 30 bar terakhir, tanpa axis, warna `--up/--down` sesuai perubahan total. |
| `QuadrantBadge` | Badge kecil 20px: dot warna kuadran + label Indonesia. |
| `StreakBadge` | `2w` / `3w` — hanya muncul bila `streak_weeks ≥ 2`, dengan tooltip "muncul n minggu berturut-turut". |
| `SectorDrawer` | Panel dari kanan (lebar 720px) saat sektor diklik: metrik, chart `SectorSeries` (garis indeks + IHSG), tabel konstituen (filter & sort), mini-RRG saham. |
| `StockTable` | Kolom seperti `SectorTable` + Ticker, Nama, Harga, RSI, ATR, Skor. Baris klik → halaman `/stocks/{ticker}`. |
| `WeeklyPicksPanel` | Dua blok (Sektor / Saham), tiap baris: rank, nama, streak badge, `entry_ref/stop/target` (monospace), `rationale`, expander "kenapa?" → `rule_hits` sebagai daftar centang. |
| `RotationMatrix` | Matriks 4×4 count transisi + daftar perubahan. |
| `HeatmapGrid` | 11 baris × 4 kolom (1H/1B/1M/3B), intensitas warna dari `--up/--down` dengan alpha 0.08–0.55, angka selalu tampil. |
| `StatCard` | Angka besar 24px monospace + label 11px uppercase + delta kecil. Tanpa ikon dekoratif. |
| `EmptyState`, `Skeleton`, `ErrorState`, `Toast` | Skeleton meniru bentuk tabel (bukan spinner penuh layar). ErrorState menampilkan pesan API apa adanya + tombol "Coba lagi". |

## 6. RRG chart — spesifikasi teknis

- Ukuran responsif, rasio 1:0.78, padding 32px untuk label. Rentang sumbu **selalu mengandung 100** di kedua sumbu, simetris: `pad = max(0.6, 1.15 × max|nilai − 100|)`. Ticks di 100 dan ±pad×0.5.
- Zona kuadran: `Leading` kanan-atas, `Weakening` kanan-bawah, `Lagging` kiri-bawah, `Improving` kiri-atas. Label zona 10px uppercase di tepi (opacity .55), **bukan** di tengah (jangan menutupi titik).
- Grid: 1px `--border`, garis 100/100 `--border-strong` lebih tebal.
- Ekor: polyline 1.5px dengan opasitas bertingkat 0.25 → 1.0 ke arah titik terakhir; titik akhir r=7 dengan ring `--surface` 2px; titik `leading` diberi dot kecil di ujung ekor sebagai penanda arah. Tanpa gradien. Animasi masuk: titik bergerak dari posisi sebelumnya 180ms.
- Label: tampilkan nama sektor di sebelah titik; bila titik berdekatan (< 24px), hanya yang terpilih/hover yang berlabel (label lain jadi dot polos) — hindari label bertumpuk (penyakit utama UI RRG buatan AI).
- Interaksi: hover → `PointCard`; klik → filter tabel ke sektor itu; tombol kecil "Semua"/"Hanya kuadran" di pojok chart.
- Plot pakai `d3-scale` + `d3-shape` saja. **Tidak ada** chart library (Recharts/Chart.js/nivo) — hindari bloat & gaya default yang sulit dikalahkan.

## 7. Daftar filter (jawaban pertanyaan "filternya apa saja")

Filter di URL, berlaku untuk tabel & (kalau relevan) chart:

| Filter | Kontrol | Nilai | Default |
|---|---|---|---|
| `timeframe` | segmented | d1, w1, w1_fri, midday | d1 |
| `window` | select | 1w, 1m, 3m, 6m, 1y, ytd | 3m |
| `weighting` | toggle kecil di menu ⋯ | equal, turnover, captier | equal |
| `as_of` | date picker | tanggal tersedia | terakhir |
| `sector` | multi-select | 11 kode | semua |
| `quadrant` | multi-select chip | leading/improving/weakening/lagging | semua |
| `min_streak` | angka | 0–8 | 0 (di halaman Weekly: 1) |
| `min_turnover_idr` | preset + input Rp | 0 / 1 M / 5 M / 10 M / 50 M | dari config |
| `min_price_idr` | input | Rp | dari config |
| `ret_positive_only` | toggle | — | off |
| `sort`, `dir` | klik header | lihat API | score desc |
| `q` | search | ticker/nama | kosong |

Preset cepat (tombol, hanya mengubah URL): **"Rotasi aktif"** (quadrant=improving, dir=rs_momentum), **"Pemimpin"** (quadrant=leading, min_streak=2), **"Semua lingkup"** (reset).

## 8. Mock UI (wireframe + data contoh)

Halaman Overview, dark mode, lebar 1440px:

```
┌ 60px ┬───────────────────────────────────────────────────────────────────────────────────────────┐
│  ◎   │  Sector Rotation IDX        [ Harian | Mingguan | Mingguan (Sen–Jum) | Tengah Hari ]        │
│  ▦   │  Jendela: 3M ▾   as of 9 Okt 2026            ● data 9 Okt 17:02      ☾/☀                 │
│  ≣   ├──────────────────────────────────────────────────────────┬────────────────────────────────┤
│  ⚑   │  Diagram RRG — Sektor                                    │  Ringkasan Pasar               │
│  ◷   │                                                          │  IHSG 5.936,15   −2,59%        │
│      │        RS-Momentum ↑                                     │  Sektor naik 2 / turun 9       │
│      │   104┤            Improving      │      Leading            │  Breadth 120 ↑ / 380 ↓         │
│      │      │        ● IDXINFRA        │   ● IDXFINANCE          │  Regime: risk-off              │
│      │   102┤              ●IDXTRANS    │        ●IDXHEALTH       ├────────────────────────────────┤
│      │      │                          │                         │  Perubahan Kuadran (1 mgg)     │
│      │   100┼──────────────────────────┼─────────────────────────│  Infrastruktur                 │
│      │      │                          │                         │   Lagging → Improving          │
│      │    98┤   ●IDXENERGY  Weakening   │   ●IDXBASIC  Lagging    │  Keuangan                      │
│      │      │                          │                         │   Improving → Leading          │
│      │    96┤              ●IDXPROPERT │   ●IDXINDUST            ├────────────────────────────────┤
│      │      └──────────────────────────┴───────────  RS-Ratio →  │  Fokus Mingguan (9 Okt)        │
│      │        96        98      100     102       104           │  1. IDXFINANCE  2w  +4,1%/4mgg │
│      ├──────────────────────────────────────────────────────────┤  2. IDXHEALTH   1w             │
│      │ Filter: [Kuadran ▾] [Sektor ▾] [Streak ≥ 1 ▾] [Likuiditas Rp 1 M ▾]  Reset │ 3 filter │  3. IDXTRANS    1w             │
│      ├──────────────────────────────────────────────────────────┴────────────────────────────────┤
│      │ Sektor         Kuadran      Umur  RS-Ratio  RS-Mom   Δ1p    1H      1B      3B    Turnover  │
│      │ Keuangan       ● Memimpin    2    +102,31  +100,84  +0,42  +1,81%  +4,12%  +9,03%  1,18 T   │
│      │ Kesehatan      ● Memimpin    1    +101,06  +100,41  +0,11  +0,92%  +2,44%  +5,10%  412 M    │
│      │ Infrastruktur  ● Membaik     1     +98,74   +99,88  +0,31  +0,44%  −0,80%  +1,20%  245 M    │
│      │ ...                                                                                        │
└──────┴────────────────────────────────────────────────────────────────────────────────────────────┘
```

Mock data yang wajib dipakai saat frontend dibangun tanpa backend (MSW/fixture): `frontend/src/mocks/` berisi JSON persis seperti contoh di `docs/05-API-CONTRACT.md` §2 (11 sektor, 30 saham). Jangan mengarang bentuk baru.

Halaman `/weekly`:

```
┌ Fokus Mingguan — pekan 6–10 Okt 2026 (final, Jumat 9 Okt) ───────────────────────────────────────┐
│  SEKTOR                                                                                          │
│  1  Keuangan        2w  skor 87,4   "Masuk Memimpin 2 periode berturut-turut, momentum naik."  ▾ │
│  2  Kesehatan       1w  skor 71,2   "Membaik dengan RS-Momentum di atas 100."                  ▾ │
│  SAHAM                                                                                           │
│  1  BBRI  Keuangan  3w  entry 4.250  stop 4.132  target 4.486  (RR 1:2)  12 lot   skor 92,1  ▾  │
│     └ kenapa?  ✓ likuiditas ✓ harga ✓ tren ✓ RS ✓ momentum ✓ RSI 62 < 75 ✓ tidak suspend        │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 9. Aksesibilitas & kualitas (acceptance, bukan saran)

1. Setiap kontrol bisa dicapai keyboard, `--focus` ring 2px terlihat di kedua tema.
2. Chart RRG: tersedia **tabel alternatif** (tabel sektor di bawahnya sudah memenuhi syarat ini) — angka tidak hanya ada di gambar.
3. Kontras AA diuji dengan axe pada dark & light (0 violation kategori `wcag2aa`).
4. `prefers-reduced-motion` → tidak ada animasi titik RRG.
5. Tidak ada layout shift (CLS) saat data masuk: skeleton sudah punya tinggi akhir.
6. Angka diformat satu tempat saja: `frontend/src/lib/format.ts` (`formatRp`, `formatRpCompact`, `formatPct`, `formatNum`). Tidak boleh ada `toFixed()` tersebar di komponen.

## 10. Struktur folder frontend

```
frontend/src/
├─ main.tsx, App.tsx
├─ styles/tokens.css, globals.css
├─ lib/{api.ts, format.ts, urlFilters.ts, quadrant.ts}
├─ components/ui/        (Button, Card, Popover, Drawer, Table primitives, Tooltip, Segmented, Badge, Pill)
├─ components/charts/    (QuadrantChart.tsx, Sparkline.tsx, SectorSeries.tsx, HeatmapGrid.tsx, RotationMatrix.tsx)
├─ components/domain/    (SectorTable, StockTable, FilterBar, WeeklyPicksPanel, FreshnessPill, StreakBadge, PointCard)
├─ pages/                (OverviewPage, SectorPage, StockPage, WeeklyPage, StatusPage)
├─ mocks/                (fixture JSON + MSW handler)
└─ hooks/                (useApiQuery.ts, useTheme.ts, useFilterState.ts)
```
