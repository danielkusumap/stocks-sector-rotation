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
  --up:            oklch(0.50 0.14 152);    /* hijau, harga naik — 5,57:1 di --surface (ADR-034); 0.56 gagal AA */
  --down:          oklch(0.55 0.17 22);     /* merah, harga turun */
  --flat:          oklch(0.60 0.01 255);
  --warn:          oklch(0.52 0.15 75);     /* 5,62:1 di --surface (ADR-034); 0.68 → 2,95:1 gagal AA */
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
| `WindowSelect` | Pilih `1 mgg / 1 bln / 3 bln / 6 bln / 1 thn / YTD` (default **3 bln**) untuk panjang ekor & kolom return. Ada catatan kecil "tidak mengubah kuadran". Kode di URL tetap Inggris: `1w,1m,3m,6m,1y,ytd` — **label UI Bahasa Indonesia** (`mgg`, `bln`, `thn`), jangan campur. |
| `AsOfPicker` | Tanggal acuan; hari tanpa data ditandai & tidak bisa dipilih. |
| `FreshnessPill` | `ok` (dot hijau + "data 12 Okt 16:10") / `stale` (dot amber + "delay") / `partial` (dot merah + "n sektor tipis"). Klik → popover detail `data_status`. |
| `QuadrantChart` (RRG) | SVG buatan sendiri (lihat §6 & §6.1). Ekor, crosshair di 100/100, zona kuadran berwarna 4%, hover menampilkan `PointCard`, klik = pin sektor (sinkron dua arah dengan tabel). **Mode fokus:** titik terfokus terang, sisanya meredup 0,22. Keyboard penuh. |
| `PointCard` | Popover: judul `TICKER · Nama` untuk `scope=saham` (kode saham dulu — itu yang dicari user), kuadran + umur, RS-Ratio/RS-Momentum + perubahan, return, turnover, streak, tombol "Lihat saham sektor ini". |
| `SectorTable` | Kolom: Sektor, Kuadran, Umur, RS-Ratio, RS-Mom, Δ1p, **1 hr**, **1 mgg**, **1 bln**, **3 bln**, **Turnover hr ini**, Streak, Skor. Sortable semua kolom angka; baris klik → `SectorDrawer`. |
| `FilterBar` | Chip filter aktif (bisa dihapus satu-satu), tombol "Filter" (popover), "Reset". Semua nilai tercermin di URL. |
| `Sparkline` | 80×24 SVG dari seri 30 bar terakhir, tanpa axis, warna `--up/--down` sesuai perubahan total. |
| `QuadrantBadge` | Badge kecil 20px: dot warna kuadran + label Indonesia. |
| `StreakBadge` | `2w` / `3w` — hanya muncul bila `streak_weeks ≥ 2`, dengan tooltip "muncul n minggu berturut-turut". |
| `SectorDrawer` | Panel dari kanan (lebar 720px) saat sektor diklik: metrik, chart `SectorSeries` (garis indeks + IHSG), tabel konstituen (sort; filter kuadran §6.4 ikut menyaring tabel **dan** mini-RRG), mini-RRG saham (label ticker §6). |
| `StockTable` | Kolom seperti `SectorTable` + Ticker, Nama, Harga, RSI, ATR, Skor. Baris klik → halaman `/stocks/{ticker}`. |
| `WeeklyPicksPanel` | Dua blok (Sektor / Saham), tiap baris: rank, nama, streak badge, `entry_ref/stop/target` (monospace), `rationale`, expander "kenapa?" → `rule_hits` sebagai daftar centang. |
| `RotationMatrix` | Matriks 4×4 count transisi + daftar perubahan. |
| `HeatmapGrid` | 11 baris × 4 kolom (`1 hr` / `1 mgg` / `1 bln` / `3 bln`), intensitas warna dari `--up/--down` dengan alpha 0.08–0.55, angka selalu tampil. |
| `StatCard` | Angka besar 24px monospace + label 11px uppercase + delta kecil. Tanpa ikon dekoratif. |
| `EmptyState`, `Skeleton`, `ErrorState`, `Toast` | Skeleton meniru bentuk tabel (bukan spinner penuh layar). ErrorState menampilkan pesan API apa adanya + tombol "Coba lagi". |

**Aturan tanda & satuan di tabel (final, hasil keputusan F5):**
- **Level** (`RS-Ratio`, `RS-Momentum`) ditampilkan **tanpa tanda**: `102,31`, bukan `+102,31`. Tanda `+`/`−` hanya untuk **perubahan/delta** (`Δ1p`, kolom return, delta harga). RS 102,31 adalah posisi relatif terhadap 100, bukan kenaikan — memberi tanda `+` membuat user mengira itu perubahan sesi. Wireframe §8 sudah dikoreksi mengikuti aturan ini.
- Kolom **`Turnover hr ini`** = `turnover_idr` (nilai transaksi hari itu, mis. `1,18 T`). Ini **berbeda** dari filter likuiditas yang memakai `median_turnover_20d_idr` — bedanya wajib ada di tooltip header, dan header menyebut "hr ini" supaya tidak ada baris yang tampak "lolos filter padahal turnover kecil" tanpa penjelasan.
- Kartu hover (`PointCard`) memakai angka & format yang **sama persis** dengan baris tabel untuk `ref_id` sama.
- `AsOfPicker` memakai `GET /api/v1/meta/dates` (`docs/05` §1) untuk menonaktifkan hari tanpa data; kalau daftar kosong → jatuh ke `<input type="date">` biasa, jangan memblokir user.

### 5.1 Panel Analisa Teknikal (halaman Saham & drawer Sektor)

Sumber: `GET /api/v1/ta/{scope}/{ref_id}` (`docs/05` §2). Aturan angka: **semua harga penyesuaian (`adj_close`)** — label wajib **"harga penyesuaian"** di dekat angka harga, karena levelnya bisa berbeda dari layar sekuritas (dividen/aksi korporasi). Untuk saham, harga bar terakhir = harga layar; yang berbeda hanya harga historis.

- Kontrol: segmented MA (`10`/`20`/`50`) + toggle "filter tren MA50" (default dari `/meta/config` → `ta.trend_filter`). Tidak ada kontrol lain.
- Empat angka besar (`StatCard`): **+5% dulu** (`win_rate`), **median periode ke +5%**, **median periode ke −5%**, **jumlah event**. Persentase format Indonesia 1 desimal; `—` kalau tidak ada event.
- Baris **terakhir breakout**: tanggal sinyal → tanggal entry (`entry_price`, "harga penyesuaian"), umur (`periods_since` periode), perubahan harga sekarang vs harga entry (`gain_since`, pakai `Delta`), status (`Badge`: `+5% dulu` / `−5% dulu` / `belum selesai` / `lewat batas`).
- Perbandingan filter: satu baris kecil **"dengan filter tren: 62,5% (9 event) · tanpa filter: 46,2% (14 event)"** dari `stats.filter_on`/`filter_off` (satu permintaan, bukan dua).
- Tabel event terakhir (maks 20): tanggal sinyal, tanggal entry, harga entry, hasil, periode, harga keluar (`—` saat belum selesai).
- Satu baris catatan cakupan: "angka dari 916 emiten; 6 emiten dilewati karena riwayat < 60 bar" + rentang tanggal data. Ini wajib — DB dev masih universe parsial.
- Grafik harga + garis MA: **opsional v1** (boleh menyusul). Angka & daftar event dulu.
- Kolom ringkas di `SectorTable`/`StockTable` (tanpa buka detail, `docs/08` F18): `+5% dulu` (`win_rate`), `median periode`, `terakhir breakout` (mis. `6 Okt · 5 periode`) — bisa disortir, sumber `GET /api/v1/ta/summary`. Semua angka dihitung backend; frontend tidak menghitung rumus apa pun.

### 5.2 Trading plan di halaman Weekly (docs/03 §6.4, `api_version` 1.2)

Tiap pick saham punya blok plan yang **bisa dibuka** (expander `plan`), dan barisnya tetap ringkas.

- **Baris ringkas** (`PickSummary`) — tetap monospace: `zona 4.088–4.135 · SL 3.991 (−2,85%) · TP1 4.360 (+6,25%) · TP2 4.580 (+11,61%) · R:R 4,07 · skor 92,1`. `lots_hint` tetap tampil bila ada.
- **Badge rezim** di baris: `Tren naik` / `Range` / `Turun` / `Tipis` (label Indonesia; token warna: netral untuk tren, `--warn` untuk range, `--down` untuk turun, `--warn` untuk tipis). Sumber `plan.regime`.
- **Blok terbuka** berisi, berurutan: (1) nama alat dalam Bahasa Indonesia — `pullback_ma20` → "pantulan ke penyangga 20 hari", `breakout_donchian` → "tembus puncak 20 hari", `sr_channel` → "pantulan di kanal penyangga–penahan", `pivot_level` → "level pivot" — **plus** kalimat `reason`-nya; (2) baris konfirmasi (`volume` → "volume 1,8× rata-rata 20 hari"); (3) batas rugi (level + % + basis + alasan); (4) TP1 & TP2 (level + % + R:R bersih + alasan); (5) ekspektasi lama tahan + peluang historis (`median 7 bar`, `TP1 kena 62% · TP2 kena 34%`) atau "belum cukup riwayat"; (6) baris **invalidasi** apa adanya; (7) `notes[]` bila ada, gaya `--warn`.
- **`plan_ok = false`** → badge "perlu ditinjau" + `notes` terlihat tanpa membuka; pick tidak disembunyikan. `entry_mode = no_trade` → baris plan diringkas jadi satu kalimat "tidak ada rencana beli (rezim turun)".
- **Jangan menampilkan nama alat mentah** (`breakout_donchian`) dan jangan menghitung ulang R:R/% — semua dari API; persen pakai `formatPct`? **tidak**: `plan.stop.pct`/`tp*.pct` adalah level dari entry → pakai `formatPct` (bertanda) hanya untuk kolom perubahan; untuk label "SL −2,85%" pakai `formatPct` juga karena angkanya memang perubahan dari entry.
- Aturan lama tetap: `rationale` di baris tetap ditampilkan (ringkasan 1 kalimat), `rule_hits` tetap di expander terpisah, dan setiap angka yang muncul di blok plan harus bisa dicocokkan dengan `/weekly/picks` di Network.

## 6. RRG chart — spesifikasi teknis

- Ukuran responsif, rasio 1:0.78, padding 32px untuk label. Rentang sumbu **selalu mengandung 100** di kedua sumbu, simetris: `pad = max(0.6, 1.15 × max|nilai − 100|)`. Ticks di 100 dan ±pad×0.5.
- Zona kuadran: `Leading` kanan-atas, `Weakening` kanan-bawah, `Lagging` kiri-bawah, `Improving` kiri-atas. Label zona 10px uppercase di tepi (opacity .55), **bukan** di tengah (jangan menutupi titik).
- Grid: 1px `--border`, garis 100/100 `--border-strong` lebih tebal.
- Ekor: polyline 1.5px dengan opasitas bertingkat 0.25 → 1.0 ke arah titik terakhir; titik akhir r=7 dengan ring `--surface` 2px; titik `leading` diberi dot kecil di ujung ekor sebagai penanda arah. Tanpa gradien. Animasi masuk: titik bergerak dari posisi sebelumnya 180ms.
- Label: tampilkan nama sektor di sebelah titik; bila titik berdekatan, hanya yang terpilih/hover yang berlabel — hindari label bertumpuk (penyakit utama UI RRG buatan AI). **Ambang kedekatan diukur dalam pixel di layar, bukan satuan viewBox:** `threshold_viewBox = 24 / (renderedWidth_px / viewBoxWidth)`. Chart ini responsif, jadi ambang dalam satuan viewBox akan salah di layar kecil (label tetap bertumpuk) dan terlalu agresif di layar besar. **Untuk `scope=saham` label titik = ticker** (`ref_id`, monospace), bukan nama perusahaan: itu yang dicari user di sekuritas dan labelnya lebih pendek sehingga lebih sedikit bertumpuk. Nama perusahaan tetap tampil di legenda (§6.2) dan `PointCard`.
- Interaksi dasar: hover → `PointCard`; klik → **pin** pilihan (tabel ikut terfilter). Tombol "Semua"/"Hanya kuadran" **bukan** bagian chart — pindah ke `FilterBar` (F5, docs/06 §7), karena itu kontrol filter dan tidak boleh punya dua tempat. **Pengecualian:** di dalam `SectorDrawer` (mini-RRG saham) ada baris chip kuadran **lokal** untuk saham sektor itu (§6.4) — `FilterBar` halaman tetap satu-satunya tempat filter kuadran **sektor**.
- Plot pakai `d3-scale` + `d3-shape` saja. **Tidak ada** chart library (Recharts/Chart.js/nivo) — hindari bloat & gaya default yang sulit dikalahkan.

### 6.1 Mode fokus — hover/klik satu titik, sisanya meredup (WAJIB)

Berlaku sama untuk `scope=sector` **dan** `scope=stock` (mini-RRG di drawer sektor).

| State | Titik terfokus | Titik lain | Ekor terfokus | Ekor lain | Label | Garis 100 & zona kuadran |
|---|---|---|---|---|---|---|
| normal | opacity 1 | opacity 1 | 0.25 → 1.0 (bertingkat) | sama | semua tampil (anti-tumpuk §6) | tampil |
| hover | 1, r naik ke 8, dirender paling atas | **0.22** | full | **0.18** | hanya label terfokus | **tidak ikut meredup** |
| dipin (setelah klik) | sama seperti hover, tetap | 0.22 | full | 0.18 | hanya label terfokus | tetap |

Aturan teknis:
- Transisi opacity 120 ms `ease-out`; `prefers-reduced-motion` → 0 ms.
- Titik lain **tetap ada** (bukan dihapus) dan masih bisa di-hover — hover pindah ke titik itu, fokus ikut pindah (bukan terkunci oleh posisi mouse sebelumnya).
- Mouse keluar dari chart → kembali normal, **kecuali** ada titik yang dipin: pin bertahan sampai diklik ulang, klik area kosong, atau `Esc`.
- Pin tidak boleh mematikan filter tabel: `selectedRefId` di-share satu arah — klik chart memfilter tabel; klik baris tabel **memindahkan** pin ke sektor itu (dua arah, satu state).
- Titik terfokus dirender terakhir di SVG (z-order) supaya garis ekornya tidak tertutup titik lain.
- Angka di `PointCard` selalu identik dengan baris tabel untuk `ref_id` yang sama.

**Keyboard (wajib, bukan opsional):**
- `Tab` masuk ke chart → titik pertama (urutan = `rank_score` sektor, atau `stock_score` untuk saham) menerima fokus, mode fokus aktif.
- `←`/`→` (atau `↑`/`↓`) pindah antar titik dengan mode fokus ikut berpindah.
- `Enter`/`Space` = pin (sama seperti klik); `Esc` = lepas pin dan kembalikan fokus ke elemen sebelum chart.
- Focus ring 2 px `--focus` mengelilingi titik terfokus — jangan hanya mengandalkan warna titik.
- Karena isi SVG tidak terbaca pembaca layar, kirim satu baris `aria-live="polite"`: `"Keuangan — Memimpin, RS-Ratio 102,31, RS-Momentum 100,84"`. Tabel di bawah chart tetap alternatif utama (docs/06 §9).

**Kalau data ekor tidak ada:** `tail` kosong atau < 2 titik (warmup belum cukup) → gambar titiknya saja tanpa polyline, tanpa error dan tanpa placeholder aneh. Tooltip boleh menambahkan "ekor belum tersedia (data < n periode)".

**Batasan jumlah titik:** untuk `scope=stock`, satu sektor bisa 160+ saham → titik & label jadi tak terbaca. Default tampilkan **maks 25 saham** dengan `stock_score` tertinggi (slider/pilihan "semua" tersedia), dan selalu sediakan tautan "lihat semua di tabel".

### 6.2 Legenda interaktif (hover + klik dari legenda)

Legenda **bukan hiasan** — dia jalur interaksi kedua ke titik yang sama, dan jalur keyboard utama.

- **Isi tiap entri**: dot warna (token sektor / kuadran untuk saham) + nama (sektor: `name_id`; saham: **`TICKER · Nama`** — nama panjang dipotong `truncate` dengan `title` = nama penuh) + `QuadrantBadge`. Untuk `scope=sector` juga tampil `streak_weeks` bila ≥ 2 (pakai `StreakBadge`).
- **Perilaku sama dengan titik di chart, satu state** (`selectedRefId` + `hoveredRefId` di-share dua arah):
  - `hover` entri → sama seperti hover titik: titik itu opacity 1 + r membesar + dirender paling atas, semua titik lain **0,22**, ekor lain **0,18**, label lain hilang, dan `PointCard` untuk titik itu **tampil** di posisi titiknya (bukan menempel kursor legenda).
  - `click` entri → **pin** (identik dengan klik titik). Klik lagi / `Esc` / klik area kosong → lepas.
  - `hover` titik di chart → entri legenda yang bersangkutan **ter-highlight** (ring `--focus` 1px + `bg-surface-hover`), supaya mata tahu entri mana yang sedang dibaca.
- **Legenda tidak ikut meredup.** Saat ada titik terfokus, legenda tetap terbaca penuh; hanya entri aktif yang ditandai. (Kalau legenda ikut meredup, user kehilangan navigasinya.)
- **Keyboard**: entri legenda adalah `<button>` — `Tab` untuk berpindah antar entri, `Enter`/`Space` = pin, `Esc` = lepas. Karena itu legenda **menggantikan** jalur `←`/`→` sebagai cara utama (jalur panah boleh tetap ada, tapi legenda wajib lengkap). `aria-pressed` = status pin; teks entri memuat nama + kuadran + RS-Ratio + RS-Momentum agar pembaca layar dapat angkanya.
- **Urutan entri**: `scope=sector` → `rank_score` menaik (pemenang pertama); `scope=stock` → `stock_score` menurun. Urutan sama dengan urutan `Tab` di chart.
- **Tata letak**: di bawah chart, `flex-wrap`, gap 8px, tinggi entri 24px, font 13px; untuk `scope=stock` yang bisa 25 entri → wadah `max-height` 96px dengan scroll, dan entri terurut. Jangan bikin legenda vertikal di samping chart (sempit di layar kecil).
- **Pencarian (opsional, hanya kalau entri > 12)**: satu `<input>` kecil "cari nama/ticker" yang memfilter entri legenda — tanpa mengubah data chart.
- Zona kuadran sudah punya label di tepi chart (§6); legenda **tidak** mengulang legenda kuadran — cukup badge di tiap entri.


### 6.3 Posisi kartu hover — kartu tidak boleh menutupi ekor & pergerakan (WAJIB)

Kartu `PointCard` saat hover **tidak boleh** menutupi ekor titik yang sedang dibaca, titik tetangga, atau arah pergerakannya. Offset tetap `+12px` / `-50%` (seperti sebelumnya) selalu melakukan itu di salah satu sisi chart — jadi posisinya dihitung:

**Definisi "tidak menutupi" (dikoreksi F15b):** yang wajib bersih adalah **(a) titik aktif**, **(b) ekor titik aktif**, dan **(c) label titik aktif**. Irisan dengan **ekor titik lain** boleh: mode fokus §6.1 sudah meredupkannya (0,18) dan tanpa itu tidak ada penempatan yang muat untuk kartu selebar ini di chart 760 px. Angka yang dilaporkan karena itu dua: irisan ekor sendiri vs irisan ekor titik lain (per titik).

- Arah gerak titik = vektor `tail[-2] → tail[-1]` (periode terakhir vs sebelumnya). Kartu diletakkan di sisi **berlawanan ekor** — yaitu searah gerak, ruang yang baru ditinggalkan titik — sehingga ekor tetap terlihat utuh.
- Titik tanpa ekor (`tail < 2`, warmup) → fallback: sisi menjauhi pusat chart (titik di kanan-atas → kartu ke kanan-atas), bukan menimpa kuadran tempat titik itu ada.
- Kartu tidak boleh keluar kotak chart: jarak tepi minimal 8px; kalau sisi pilihan tidak cukup ruang, `flip` ke sisi seberang pada sumbu itu. Ukuran kartu **`w-50` (200 px)** — diturunkan dari 240 px di F15b setelah pengukuran; tinggi diukur dari DOM kalau penempatan butuh angka tepi.
- Sisi kanan kartu diberi jarak tambahan sepanjang perkiraan lebar **label titik** (label digambar di kanan titik) supaya kartu tidak menutupi label yang sedang dibaca.
- Kartu tetap `pointer-events: none` (titik di baliknya tetap bisa di-hover/klik) dan tetap muncul saat hover entri legenda (§6.2).
- Rumusnya **fungsi murni** (`lib/rrgChart.ts`: `cardPlacement()`) yang diuji unit tanpa DOM; komponen hanya memakainya. Ini yang membuat "tidak menutupi" bisa dibuktikan angka, bukan penilaian mata.

### 6.4 Chip filter kuadran saham di `SectorDrawer`

Khusus drawer detail sektor (mini-RRG saham + tabel konstituen), ada satu baris chip **lokal**:

- Isi: `Semua` + 4 label kuadran dari `lib/quadrant.ts` (`Memimpin`, `Membaik`, `Melemah`, `Tertinggal`) + jumlah dari `rrg.data.quadrants` — mis. `Tertinggal (53)`. Tidak ada request tambahan untuk angkanya.
- Single-select (`aria-pressed`), bisa dioperasikan keyboard (`Tab` + `Enter`/`Space`); pakai `Segmented`/chip yang sudah ada, bukan kontrol baru.
- Satu state menggerakkan **dua** hal: titik RRG yang tidak cocok dibuang sebelum digambar (batas 25 titik §6.1 berlaku setelah filter), dan tabel konstituen memakai `quadrant[]` di `GET /stocks` (bukan menyaring baris yang sudah diunduh).
- **Bukan** filter halaman: nilai ini tidak masuk URL (`?quadrant=` sudah milik `FilterBar` untuk kuadran sektor) — state lokal drawer, sama seperti `sort`/`dir` di sana.
- Kuadran terpilih tanpa isi → `EmptyState` + tombol "Tampilkan semua", bukan chart/tabel kosong tanpa penjelasan.

### 5.3 Halaman detail saham — semua yang sudah terbaca terlihat (docs/03 §6.5)

Urutan panel di `/stocks/{ticker}` (atas → bawah), supaya mata membaca dari ringkasan ke bukti:

1. **Header**: `TICKER` + nama + sektor + harga terakhir (+Δ hari itu) + badge **rezim** (`Tren naik`/`Range`/`Turun`/`Likuiditas tipis`/`Data belum cukup`) + label "harga penyesuaian".
2. **Panel "Analisa teknikal"** (`AnalysisPanel`, sumber `GET /plan/stock/{ticker}`):
   - **Ringkasan** — `summary_lines` sebagai 1–3 baris teks (bukan bullet panjang), apa adanya dari API.
   - **Skenario historis** — tabel kecil: `Target 1 kena dulu 62% · Batas rugi kena dulu 24% · Lewat horizon 14% · median 7 bar (dari 29 breakout, 1 belum selesai)`. Kolom `n_events` **wajib** tampil; `scenario = null` → satu baris "belum cukup riwayat (butuh ≥ 10 breakout)". Judulnya "Skenario historis" — **jangan** "prediksi" (angkanya frekuensi masa lalu pada level hari ini).
   - **Plan** — blok sama seperti `docs/06` §5.2 (zona, batas rugi + basis, TP1/TP2 + R:R bersih, ekspektasi lama tahan) + `invalidation` + `notes[]` (`--warn`) + badge "perlu ditinjau" bila `plan_ok=false`; `entry_mode = no_trade` → satu kalimat "tidak ada rencana beli (rezim turun)".
   - **Alat & alasan** — daftar `active_tools` dalam Bahasa Indonesia + `regime.reason`, ditambah alasan per elemen dari `plan.*.reason` (yang tidak terpakai di blok plan, mis. alasan basis stop).
   - **Daftar level** — `levels_table` apa adanya (label Indonesia + angka monospace), termasuk penyangga 20/50 hari, puncak 20/40 hari, terendah 10 hari.
   - **Catatan cakupan** — `coverage` (jumlah bar, rentang tanggal, jumlah event, `price_basis`) + pengingat "angka dihitung dari subset universe yang punya data".
   - Keadaan `regime.code = tidak_cukup_data` → panel menampilkan ringkasan + catatan cakupan saja (tanpa tabel kosong, tanpa "0%").
3. **Panel "Grafik & analisa teknikal"** — `CandleChart` (§6.5) dengan legend rezim yang **sama** (satu sumber: baris `stock_plan`).
4. Panel lama tetap: metrik (`/stocks/{ticker}`), `Sparkline`, RRG vs sektor, `TaPanel` (statistik MA 10/20/50 & event), snapshot pick mingguan bila ada.

Aturan: tidak ada angka yang dihitung frontend (R:R, %, peluang semua dari API); persentase peluang **tanpa tanda** (`62%`, pakai `formatNum(v×100,0)+"%"` — `formatPct` selalu bertanda dan salah untuk ini); warna status hanya token; setiap keadaan (memuat/kosong/gagal/perlu ditinjau) punya tampilan sendiri.

### 6.5 Grafik candle + overlay TA di halaman detail saham (docs/05 `series/stock`, `docs/03` §6.4)

Komponen `CandleChart` di panel "Grafik & analisa teknikal" (`/stocks/{ticker}`). Menggambar **SVG sendiri** (aturan §6: tanpa library chart), rasio 1:0,45 + sub-panel volume 18%, `padding` 32 px kiri untuk label harga.

**Candle**: body `max(1px, |close−open| skala)`, wick 1 px; warna `--up`/`--down` (naik/turun dari `open`); border `--surface` 1 px saat body < 2 px. Sumber `candles` (harga penyesuaian) — label wajib "harga penyesuaian".

**Overlay (semuanya dari API, tidak ada hitungan di frontend):**

| Overlay | Gaya | Tampil kapan |
|---|---|---|
| MA20 | garis solid 1,5 px, token `--fg-muted` | selalu (filter tren) |
| MA50 | garis putus-putus 1,5 px, `--fg-faint` | selalu |
| Donchian 20 high/low | titik-titik 1 px, `--border-strong` | selalu (level breakout & resistance) |
| Donchian 40 high/low | titik-titik 1 px, opacity 0,5 | selalu (target terukur) |
| Kanal S/R (pivot) | pita `--border` opacity 0,10 + garis tengah, label `strength` | **hanya** `regime = range\|tipis` (di `tren_naik` disembunyikan; skill: bukan alat utama saat tren) |
| Zona entry plan | pita `--accent-subtle` 0,25 | bila `levels` ada |
| SL / TP1 / TP2 | garis putus 1 px + label kanan (`SL 3.991 (−2,85%)`) warna `--down` untuk SL, `--up` untuk TP | bila `levels` ada |
| Penanda event breakout | segitiga 6 px di `signal_date` — `--up` hasil `win`, `--down` hasil `loss`, `--fg-faint` `expired`/`open` | selalu (maks `events`) |
| Volume | bar 1 px + garis `volume_ma` + ambang `volume_confirm_mult ×` (garis putus, warna `--warn`) | selalu |

**Legenda & rezim**: satu baris di atas grafik — badge rezim (`Tren naik` / `Range` / `Turun` / `Tipis`) + `active_tools` dalam Bahasa Indonesia + `regime_reason` apa adanya. Ini yang menjelaskan *kenapa* overlay-nya begini, dan menutup pertanyaan "kok kanal S/R-nya hilang?".

**Interaksi**: hover bar → garis bidik + kotak angka (O/H/L/C, volume, % perubahan) yang diposisikan **tidak menutupi 20 bar terakhir** (aturan §6.3 berlaku); klik penanda event → baris teks hasil (`breakout 6 Okt · kena +5% dalam 7 bar` / `−5% dalam 4 bar` / `belum selesai`). Tanpa zoom/pan di v1.

**A11y & stabilitas**: SVG `role="img"` + `aria-label` ringkas (tren, rezim, level plan); tabel angka di bawah grafik **tidak** diwajibkan (halaman sudah punya tabel metrik), tapi `aria-live` menyebut bar terakhir saat hover. Tinggi panel dipatok (tidak ada CLS); `prefers-reduced-motion` → tanpa animasi masuk. `candles: []` → `EmptyState` "belum ada bar harga untuk saham ini".

**Dilarang di v1** (sengaja): VWAP/POC & volume profile (intraday, retensi 30 hari), kotak SMC, hitungan Elliott, panel Ultimate RSI terpisah, zoom/pan, indikator yang bisa ditambahkan user.

### 6.6 Panel indikator tambahan (Ultimate RSI, VWAP, POC) — docs/03 §11.1–§11.3

Toggle kecil di header grafik: `Indikator` (default **aktif**), `SMC`, `Elliott` (dua terakhir default **mati**). Pilihan toggle masuk **URL** (`?layers=indicators,smc`) dan diteruskan sebagai `layers` ke `series/stock` — bukan dihitung di frontend.

| Elemen | Gaya | Catatan |
|---|---|---|
| **Ultimate RSI** | sub-panel 18% tinggi di bawah volume; garis `--fg` 1,5 px + garis sinyal `--fg-faint` putus; area 70–100 `--up` opacity 0,08 dan 0–30 `--down` 0,08; garis 50 `--border` | label panel: `Ultimate RSI (14, SMA)`. Di `regime = tren_naik` ini alat momentum **searah** tren; di `range` panel disembunyikan dan diganti catatan "di rentang, pakai RSI klasik (kontrarian)" |
| **VWAP + pita σ** | VWAP `--accent` 1,5 px; pita ±1σ `--accent` opacity 0,10 (isi), ±2σ garis putus 1 px opacity 0,35 | header panel memuat anchor (`VWAP 20 · anchor 14 Sep`); **tampil hanya bila `regime = range`** (skill: di tren VWAP bukan alat) — kalau user memaksa lewat toggle di rezim tren, tampil dengan label peringatan `--warn` "bukan alat utama saat tren" |
| **POC / value area** | garis `--warn` 1 px di `poc` + pita `value_area` opacity 0,06 | **wajib** menulis `basis`: `daily` → "perkiraan dari bar harian" · `intraday` → "dari bar 5 menit (N bar)". Tanpa label ini, angka POC menyesatkan |

Aturan: tidak ada perhitungan di frontend (semua titik dari API); `points` kosong → panel/lapisan disembunyikan (bukan garis datar di 0); sumbu URSI selalu 0–100 dengan garis 50 dan ambang `ob`/`os`; `prefers-reduced-motion` → tanpa animasi.

### 6.7 Lapisan konteks SMC & Elliott (toggle, bukan aturan) — docs/03 §11.4–§11.5

- **Gaya SMC** (semua `pointer-events: none`, opacity rendah supaya candle tetap terbaca): BOS/CHoCH = garis putus 1 px + label kecil `BOS`/`CHoCH` di ujung; order block = kotak `--up`/`--down` opacity 0,08 (garis tepi 1 px), yang sudah termitigasi opacity 0,04 + garis putus; FVG = kotak `--border` opacity 0,08; equal high/low = garis titik 1 px + label `2×`; premium/discount = dua pita 0,04 dengan garis tengah 50%.
- **Gaya Elliott**: ZigZag `--fg-faint` 1 px; label wave `1..5`/`A..C` 10 px di titik pivot; zona Fibonacci = garis putus + label rasio; pola yang `invalidated` digambar **putus-putus + opacity 0,5** dan **selalu** disertai catatan `elliott.note` ("kandidat, bisa berubah") di legenda panel.
- **Aturan keras**: kedua lapisan tidak boleh muncul sebagai baris level di blok plan (`docs/06` §5.3) dan tidak boleh dijadikan alasan entry — kalau user menanyakannya, jawabannya ada di legenda: "lapisan konteks, bukan sinyal".
- Default mati karena menambah ~20 garis; menyalakannya dihitung sebagai preferensi tampilan, bukan fitur analisa baru.

### 6.8 Zoom & pan grafik (frontend saja)

- Zoom: roda mouse / `+` `-` keyboard / pinch; **pan**: drag horizontal (dan vertikal bila zoom > 1,5×).
- Batas: minimal **20 bar**, maksimal seluruh `candles` yang dikirim; tidak boleh melewati tepi data (clamp). Reset: klik ganda atau tombol `Reset`.
- Setelah zoom/pan: (a) label harga di sumbu kanan tetap dihitung dari rentang yang terlihat, (b) garis level plan/VWAP/POC hanya digambar bila masih di dalam rentang, (c) kotak hover **tetap** mematuhi aturan §6.3 (tidak menutupi 20 bar terakhir) — diuji pada 3 tingkat zoom, (d) `aria-live` menyebut rentang yang terlihat saat zoom berubah.
- Tanpa zoom/pan di v1 halaman lain (Overview/Weekly) — hanya `CandleChart`.

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

Pengecualian: filter kuadran **saham** di dalam `SectorDrawer` (§6.4) hidup sebagai state lokal drawer, bukan di URL — `quadrant` di URL sudah berarti kuadran **sektor** di tabel/chart halaman.

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
│      │ Sektor         Kuadran      Umur  RS-Ratio  RS-Mom   Δ1p   1 hr    1 mgg   1 bln   3 bln  Turnover hr ini │
│      │ Keuangan       ● Memimpin    2    102,31    100,84   +0,42  +1,81%  +4,12%  +9,03%  1,18 T  │
│      │ Kesehatan      ● Memimpin    1    101,06    100,41   +0,11  +0,92%  +2,44%  +5,10%  412 M    │
│      │ Infrastruktur  ● Membaik     1     98,74     99,88   +0,31  +0,44%  −0,80%  +1,20%  245 M    │
│      │ ...                                                                                        │
└──────┴────────────────────────────────────────────────────────────────────────────────────────────┘
```

Mock data yang wajib dipakai saat frontend dibangun tanpa backend (MSW/fixture): `frontend/src/mocks/` berisi JSON persis seperti contoh di `docs/05-API-CONTRACT.md` §2 (11 sektor, 30 saham). Jangan mengarang bentuk baru.

Halaman `/weekly`:

```
┌ Fokus Mingguan — pekan 5–9 Okt 2026 (final, Jumat 9 Okt) ───────────────────────────────────────┐
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
