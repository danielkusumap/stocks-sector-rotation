# 01 — Product Scope

## 1. Masalah yang dipecahkan

Trader saham IDX ingin tahu **uang sedang berpindah ke sektor mana**, lalu **saham apa di sektor itu** yang layak di-swing minggu depan. Alat yang ada (RRG di TradingView/StockCharts) butuh langganan dan tidak punya tabel terfilter + rule-based weekly picks untuk IDX.

## 2. Pengguna & dua permukaan

| Permukaan | Pemakai | Kebutuhan |
|---|---|---|
| **Web app** | user (manusia) | Lihat diagram RRG, tabel per sektor yang bisa difilter, drill-down saham. Eksploratif, interaktif. |
| **HTTP API** | Hermes agent (otomatis, tiap pagi) | Satu endpoint `GET /api/v1/briefing/morning` berisi semua angka + narasi siap pakai untuk report. |

Konsekuensi desain: agregasi berat **dihitung sekali** saat ingest/compute dan disimpan di SQLite; endpoint hanya membaca + memformat. Filter di web dikerjakan di SQL, bukan di browser.

## 3. Ruang lingkup v1 (harus ada)

1. **Import Excel sektor** (sheet per sektor) → tabel `stock` + `sector`, dengan laporan baris gagal.
2. **Ingest harga** dari yfinance: harian (min. 2 tahun) + intraday 5m/60m (hari berjalan) untuk universe.
3. **Indeks sektor** dihitung sendiri (equal-weight, turnover-weight, cap-weight dari kolom "Saham" di Excel) + benchmark IHSG.
4. **RRG sektor**: RS-Ratio, RS-Momentum, kuadran, ekor historis, label transisi kuadran, umur kuadran.
5. **Tabel per sektor** di bawah diagram, dengan filter & sorting (daftar filter ada di `docs/06-DESIGN-SYSTEM.md` §7).
6. **Drill-down saham per sektor**: tabel saham dengan RRG saham vs indeks sektornya.
7. **Pilihan timeframe**: `d1` (harian), `w1` (mingguan), bebas pilih jendela 1B/1M/3M/6M/1T/YTD.
8. **Mode mingguan Senin–Jumat (`w1_fri`)**: hanya memakai minggu yang **sudah lengkap** (Senin–Jumat); nilainya baru muncul setelah penutupan Jumat. Tujuan: menyusun rencana minggu depan.
9. **Weekly picks rule-based** (rule transparan, bukan ML) untuk sektor & saham, plus **streak**: berapa minggu berturut-turut kandidat itu muncul.
10. **Mode tengah hari (`midday`)**: perhitungan ulang setelah sesi 1 (data s/d ~12:00 WIB), dengan **gate kesegaran data** (lihat `docs/02-DATA-SOURCES.md` §5).
11. **Endpoint briefing** untuk Hermes.
12. **Halaman Data (pipeline dari UI)** — user menjalankan seluruh alur (import Excel → ambil harga → hitung → tengah hari) lewat tombol di web, **bukan** lewat terminal. Tiap langkah punya tombol, progresnya, prasyaratnya, dan riwayat run-nya. Ini pintu masuk utama, bukan pelengkap (`docs/08` F12, `docs/05` §4).
13. **Dark + light mode**, responsif, aksesibel.

## 4. Bukan ruang lingkup v1 (jangan dibangun)

- Trading/order eksekusi, backtest multi-tahun, portofolio & P&L, alert email/Telegram, autentikasi multi-user (cukup single-user lokal; API key opsional), prediksi ML, data fundamental (PER/PBV/EPS), foreign flow / broker summary (tidak tersedia gratis), realtime tick (yfinance delay), opsi/derivatif, IDX-IC subsector resmi (pakai input Excel user), indeks sektor resmi IDX (dihitung sendiri).
- Tulis usul fitur tambahan di `docs/DECISIONS.md` → "Proposed", jangan dikerjakan.

## 5. Glosarium

| Istilah | Arti di aplikasi ini |
|---|---|
| **Benchmark** | IHSG (`^JKSE`). Semua RS dihitung relatif ke sini. |
| **RS** | Rasio harga relatif: `index_sector / index_benchmark`, dinormalisasi ke 100 di titik awal seri. |
| **RS-Ratio** | Kekuatan tren relative strength (indikator arah), di sekitar 100. |
| **RS-Momentum** | Laju perubahan RS-Ratio (indikator yang memimpin), di sekitar 100. |
| **Leading** | RS-Ratio > 100 dan RS-Momentum > 100. |
| **Weakening** | RS-Ratio > 100 dan RS-Momentum < 100. |
| **Lagging** | RS-Ratio < 100 dan RS-Momentum < 100. |
| **Improving** | RS-Ratio < 100 dan RS-Momentum > 100. |
| **Ekor (tail)** | Jejak posisi N periode terakhir pada diagram RRG. |
| **Turnover** | Nilai transaksi harian = `close × volume` (Rp). |
| **Sesi 1** | Sesi perdagangan pagi IDX, 09:00–12:00 WIB. |
| **Streak** | Jumlah periode berturut-turut sebuah kandidat muncul di daftar weekly picks. |
| **as_of** | Tanggal/periode acuan hasil perhitungan (bukan waktu request). |

## 6. Alur data

```
Excel sektor  ──┐
                ├─► SQLite (stock, sector)  ──► ingest yfinance ──► price_daily / price_intraday
config.yaml   ──┘                                                        │
                                                                         ▼
                        compute (jobs) ──► sector_index_daily ──► rrg_daily ──► signal_weekly
                                                                         │
                                                                         ▼
                                        API (baca SQLite) ──► web app  +  Hermes briefing
```

Urutan job yang benar: `import excel` → `ingest prices` → `compute index` → `compute rrg` → `compute weekly signals` → (opsional) `compute midday`.

## 7. Definisi istilah produk lain

- **"Per segment"**: web menampilkan hasil **per sektor** (11 baris), bukan seluruh pasar sekaligus; daftar seluruh saham ada di halaman Stocks dengan filter.
- **Report pagi**: teks yang dibuat Hermes dari `briefing/morning`, dikirim ke user tiap pagi (di luar repo ini; Hermes cukup memanggil endpoint).
