# 03 — Methodology (rumus & aturan)

Semua parameter di sini punya default di `config/default.yaml`. Kode **wajib** membacanya dari config (bukan konstanta di dalam fungsi). Rumus harus diimplementasi apa adanya — versi RRG yang berbeda menghasilkan kuadran yang berbeda.

## 1. Data dasar

```
adj_close_i,t   : harga penyesuaian saham i pada tanggal t (WIB)
r_i,t           = adj_close_i,t / adj_close_i,t-1 − 1
sector_index_t  : seri indeks sektor (docs/02 §3), base 100
bench_t         : IHSG (^JKSE), base 100 pada tanggal awal seri yang sama
turnover_i,t    = close_i,t × volume_i,t          (Rp)
```

**Titik awal seri (`t0`)** harus sama untuk sektor & benchmark: `t0 = min(date)` dari data harian yang tersimpan. Normalisasi base 100 dilakukan per seri di `t0` — kalau `t0` berbeda antar seri, RS akan salah.

## 2. Jarak relatif (RS) dan RRG

Dipakai *EMA-based ratio normalization* (stabil pada data harian, tanpa z-score yang meledak di pasar tipis). Sumber konsep: JdK RS-Ratio / RS-Momentum (keduanya "dinormalisasi" di sekitar 100).

```
RS_t          = 100 × (sector_index_t / bench_t) / (sector_index_t0 / bench_t0)
EMA_RS_t      = EMA(RS, span = rrg.ema_span)                    # ewm(span=m, adjust=False)
SMA_EMA_t     = SMA(EMA_RS, window = rrg.ema_span)
RS_Ratio_t    = 100 × EMA_RS_t / SMA_EMA_t
ROC_t         = RS_Ratio_t / RS_Ratio_{t−rrg.roc_lag} − 1
EMA_ROC_t     = EMA(ROC, span = rrg.ema_span)
RS_Momentum_t = 100 + 100 × EMA_ROC_t
```

Default: `rrg.ema_span = 14`, `rrg.roc_lag = 10` (harian). Untuk timeframe `w1`/`w1_fri`: `rrg.weekly.ema_span = 14`, `rrg.weekly.roc_lag = 4` (minggu). Nilai ini **tidak** berubah saat user mengganti window.

Warmup: baris pertama yang dianggap valid butuh `rrg.min_points[timeframe]` bar — **60 bar harian**, **30 bar mingguan** (`config/default.yaml`). Sebelum itu baris **jangan disimpan/ditampilkan** (bukan diisi 100). Angka mingguan jauh lebih besar dari harian karena EMA 14 minggu + SMA(EMA) 14 minggu + ROC 4 minggu; inilah alasan riwayat ditarik 2 tahun (lihat `docs/02 §7`).

## 3. Kuadran

```
RS_Ratio > 100 dan RS_Momentum > 100  → leading
RS_Ratio > 100 dan RS_Momentum < 100  → weakening
RS_Ratio < 100 dan RS_Momentum < 100  → lagging
RS_Ratio < 100 dan RS_Momentum > 100  → improving
RS_Ratio == 100 atau RS_Momentum == 100 (tepat) → ikut kuadran periode sebelumnya; kalau tidak ada, "leading"
```

Teks keterangan otomatis (dipakai web & briefing):

| Kuadran | Label singkat | Kalimat keterangan |
|---|---|---|
| leading | Memimpin | "Tren relatif naik dan masih dipercepat." |
| weakening | Melemah | "Masih di atas pasar, tapi laju mulai berkurang." |
| lagging | Tertinggal | "Di bawah pasar dan masih melemah." |
| improving | Membaik | "Masih di bawah pasar, tapi mulai berbalik naik." |

**Turunan yang wajib dihitung & disimpan:**
```
quadrant_prev          : kuadran pada bar/periode sebelumnya
transition             = f"{quadrant_prev}→{quadrant}"     (mis. "improving→leading")
quadrant_age_periods   : jumlah periode berturut-turut di kuadran sekarang
rs_ratio_change_1p     = RS_Ratio_t − RS_Ratio_{t−1}
rs_momentum_change_1p  = RS_Momentum_t − RS_Momentum_{t−1}
```

## 4. Rotasi saham di dalam sektor (drill-down)

Saham di-RRG-kan terhadap **indeks sektornya sendiri** (bukan IHSG): benchmark = `sector_index` sektornya. Rumus identik §2. Ini menjawab "saham mana yang memimpin di sektor yang sedang naik".

## 5. Skor sektor (untuk sorting & ranking)

Skor gabungan 0–100, semua komponen dihitung lintas 11 sektor (persentil), bobot dari config (`scoring.sector`):

```
rank_rs_ratio   = persentil RS_Ratio antar sektor (0–100, tertinggi = 100)
rank_rs_mom     = persentil RS_Momentum antar sektor
rank_ret_w      = persentil return periode acuan (default 4 minggu)
rank_turnover   = persentil pertumbuhan turnover (median 20 hari / median 60 hari)
penalty_decline = (share saham decline < 0.4) ? 0 : 100 × (share_decline − 0.4) / 0.6

score = w1×rank_rs_ratio + w2×rank_rs_mom + w3×rank_ret_w + w4×rank_turnover − w5×penalty_decline
default bobot: w1=0.35, w2=0.25, w3=0.20, w4=0.20, w5=0.25
```

Skor tidak dipakai untuk mengganti kuadran; ia hanya untuk mengurutkan tabel & memilih kandidat `midday`. Angka bulat 1 desimal.

## 6. Sinyal mingguan (rule-based, transparan)

Dihitung setiap **penutupan Jumat** (timeframe `w1_fri`) dan disimpan per `week_end`. Setiap baris menyimpan `rule_hits` (JSON) supaya bisa diaudit user.

### 6.1 Kandidat sektor

Wajib **semua** terpenuhi:
```
1. quadrant ∈ {improving, leading}
2. quadrant_age_periods >= 2   dan quadrant ∈ {improving, leading} pada periode sebelumnya
3. RS_Momentum > 100           dan rs_momentum_change_1p > 0
4. return_4w > 0
5. constituents_count >= 3     (sektor terlalu tipis tidak layak)
```
Ranking kandidat: `score` (§5) menurun. Simpan maks. `weekly.max_sectors` (default 3).

### 6.2 Kandidat saham (hanya dari sektor kandidat §6.1)

Wajib **semua** terpenuhi:
```
1. sektor saham ∈ daftar kandidat sektor minggu itu
2. likuiditas  : median(turnover 20 hari) >= universe.min_turnover_idr
3. harga       : close terakhir >= universe.min_price_idr
4. tren        : close > SMA20 > SMA50 (harian)
5. kekuatan relatif: stock RS_Ratio (vs indeks sektornya) > 100
6. momentum    : return_5d > 0
7. tidak overbought: RSI(14) < universe.max_rsi (default 75)
8. tidak suspend: ada bar di 5 hari bursa terakhir
```
Ranking: `stock_score = 0.4×persentil(RS_Ratio) + 0.3×persentil(return_5d) + 0.3×persentil(median turnover 20d)` (persentil dihitung di antara kandidat saham saja). Simpan maks. `weekly.max_stocks_per_sector` (default 3).

**Level harga wajib ikut disimpan** (dipakai web & report):
```
atr14      = ATR(14) harian (mean true range 14 periode, Wilder)
entry_ref  = close Jumat (acuan, bukan perintah beli)
stop       = entry_ref − weekly.atr_stop_mult × atr14        (default 1.5)
target     = entry_ref + weekly.rr_target × (entry_ref − stop)  (default 2.0 → RR 1:2)
risk_per_trade_idr = config tetap user; lots = floor(risk / ((entry_ref−stop) × 100))
```

### 6.3 Streak

```
streak_weeks = 1 + jumlah minggu berurutan sebelumnya (menghitung mundur) di mana
               (scope, ref_id) muncul di signal_weekly dengan week_end berurutan
```
"Berurutan" = minggu kalender perdagangan berikutnya (pakai kalender minggu dari data, bukan selisih hari). Badge di UI: `2w`, `3w`, … dan kalimat "muncul 3 minggu berturut-turut". Streak dihitung ulang saat compute (bukan dihitung di API).

## 7. Mode midday (setelah sesi 1)

Setelah gate `docs/02 §5` lolos:

```
last_price_i   = close bar 5m terakhir hari ini (jam bursa reguler)
r_intraday_i   = last_price_i / close_{t−1} − 1
sector_intraday_t = rata-rata r_intraday_i konstituen (weighting sama seperti rulenya)
RS_* dihitung ulang dengan bar hari ini sebagai bar terakhir (bar partial)
```
Bar hari ini **bukan** menggantikan bar harian final: baris `midday` disimpan dengan `as_of_date = hari ini`, `timeframe = "midday"`, dan **tidak** menimpa `d1`. Setelah penutupan, job harian menimpa `d1` seperti biasa.

Output tambahan di API: `intraday_move` (arah per sektor: `naik` / `turun` / `datar`, ambang `midday.move_flat_pct = 0.15%`), dan kuadran mana yang **berpotensi berpindah** bila sesi 2 melanjutkan arah yang sama (`projected_quadrant`).

## 8. Aturan angka & pembulatan

| Nilai | Simpan (DB) | Tampil (API) |
|---|---|---|
| Harga (Rp) | integer | integer, pemisah ribuan titik |
| turnover (Rp) | integer | ringkas: `1,2 T` / `845,3 M` / `12,4 jt` |
| return, RS-Ratio, RS-Momentum | float penuh | 2 desimal |
| skor | float penuh | 1 desimal |
| persen | float (0.0123) | `1,23%` (koma, karena Bahasa Indonesia) |

Bahasa UI: **Indonesia**, angka format Indonesia (`,` = desimal, `.` = ribuan). Semua label kuadran & keterangan memakai Bahasa Indonesia (`leading` = "Memimpin" untuk teks, kode tetap Inggris di API/DB).

## 9. Test yang wajib ada (bukti, bukan klaim)

1. `test_index_equal_weight`: 3 saham return +10%/+0%/−10% → indeks naik 0% (rata-rata), turnover & advancer benar.
2. `test_rrg_quadrant`: seri sintetis yang naik relatif dengan momentum positif → `leading`; setelah momentum berbalik → `weakening`.
3. `test_rrg_warmup`: seri < 60 bar → tidak ada baris RRG (bukan exception).
4. `test_resample_wfri`: data harian Sen–Jum → tepat 1 bar minggu dengan label Jumat; minggu berjalan dikecualikan pada `w1_fri`.
5. `test_weekly_rules`: fixture 6 saham (1 likuid+tren naik, 1 likuid+tren turun, 1 tipis, 1 harga Rp 50, 1 RSI 80, 1 suspend) → hanya saham pertama lolos; `rule_hits` berisi alasan yang benar.
6. `test_streak`: 3 minggu berturut-turut fixture sama → `streak_weeks = 3`; ada jeda 1 minggu → reset ke 1.

## 10. Analisa teknikal & backtest MA (`adj_close`)

Semua harga di bagian ini **`adj_close`** (sama seperti §1). `close` mentah tidak dipakai: aksi korporasi menciptakan lompatan palsu dan itu terlihat di data nyata (DB dev: **801 bar >30%** pada 293 emiten — FORU −93,6%, PACK −91,7%, FISH −90,0%, TFCO +55,8%). Bandingkan: cek "harga di atas MA20" berbeda antara `close` dan `adj_close` di **3.131 baris / 353 emiten** — bukan kasus teoretis.

### 10.1 SMA
`ma_p(t) = rata-rata adj_close(t−p+1 … t)`, untuk `p ∈ config ta.ma_periods` (default `[10, 20, 50]`).
MA = `NULL` sebelum `p` bar pertama (jangan 0, jangan jendela parsial). **SMA**, bukan EMA/WMA: versi sederhana yang paling andal & paling mudah diaudit.

### 10.2 Breakout (transisi, bukan kondisi)
`breakout_p(t) = adj_close(t) > ma_p(t)` **DAN** `adj_close(t−1) <= ma_p(t−1)`.
Selama harga masih di atas MA **tidak ada event baru** — satu event per breakout. `ma_p(t)` atau `ma_p(t−1)` NULL → tidak ada event (warmup).

### 10.3 Entry & hasil
- **Entry**: harga `open` hari bursa berikutnya (D+1); kalau `open` NULL → `adj_close` D+1 (`entry_basis` = `open` / `adj_close`). Sinyal dari close D, eksekusi D+1 → tidak ada look-ahead (lihat skill backtest: *point-in-time data*).
- `return(t) = adj_close(t) / entry_price − 1`.
- Hasil: `return ≥ +target_pct` → **`win`**; `return ≤ −target_pct` → **`loss`**; `target_pct` = `config ta.target_pct` (0,05).
- **Dasar hitung = `close`/`adj_close` harian**, bukan high/low intraday. Sengaja konservatif dan bisa direplay ulang oleh siapa pun; versi "touch" (high/low) bukan v1.
- Horizon: maks `config ta.timeout_periods` (default 60) periode bursa sejak `entry_date`. Lewat itu → **`expired`**, tetap dicatat (kalau dibuang, win rate jadi bohong). Belum melewati horizon dan belum kena target → **`open`**.
- Kasus tepi: satu bar menyentuh `+target` **dan** `−target` (gap) → dihitung **`loss`** (pesimis).
- `periods` = jumlah periode bursa dari `entry_date` ke bar hasil (bar entry = `0`).

### 10.4 Statistik (diagregasi saat endpoint dipanggil, tidak disimpan)
- `win_rate = win / (win + loss)` — `expired` dan `open` **tidak** dihitung sebagai kekalahan; keduanya dilaporkan sendiri (`expired`, `open`).
- `median_periods_win`, `median_periods_loss` — **median**, bukan rata-rata (distribusi ekor panjang: satu trade 60 periode merusak mean).
- `min_history` (`config ta.min_history`, default 60 bar) — di bawah itu entitas **tidak** diuji dan jumlahnya dilaporkan di `coverage`.
- Cakupan wajib disebut di UI: emiten diuji vs dilewati, rentang tanggal, dan bahwa semua harga penyesuaian (`adj_close`).

### 10.5 Varian filter tren
`config ta.trend_filter: true` → event hanya dihitung bila `adj_close(t) > ma_(trend_filter_period)(t)` (default MA50).
Alasan: mode gagal MA adalah pasar sideways (signal palsu, terutama MA pendek) — mitigasi standarnya filter tren dulu. Dua varian disimpan sebagai baris terpisah (`trend_filter` 0/1) dan **selalu dilaporkan berdampingan** supaya pemilihan periode/filter dijawab data, bukan opini.

### 10.6 Konteks "sekarang" (dipakai UI tanpa buka detail)
- `last_breakout` = event terbaru untuk (entitas × `ma_period` × `trend_filter`).
- `periods_since` = periode bursa dari `entry_date` sampai `as_of`; `gain_since = adj_close(as_of)/entry_price − 1`; `above_ma = adj_close(as_of) > ma_p(as_of)`.
- Label harga di UI **wajib** menyebut **"harga penyesuaian"** — level historis `adj_close` bisa berbeda dari layar sekuritas; harga bar terakhir selalu sama dengan harga layar.

### 10.7 Sektor
Rumusnya sama, `ref_id` = kode sektor dan harga = **indeks sektor** (`weighting` dari config, default `equal`), bukan harga saham. Pengecualian: indeks sektor tidak punya `open`, jadi entry sektor memakai **nilai indeks D+1** (`entry_basis` = `index`) — jangan mengarang nilai `open`.

### 10.8 Test yang wajib ada (tambahan §9)
1. `test_ma_warmup`: 25 bar, `p=20` → MA NULL untuk 19 bar pertama, terisi mulai bar ke-20.
2. `test_breakout_sekali_per_transisi`: seri yang naik terus di atas MA → **1** event, bukan satu per bar.
3. `test_entry_pakai_bar_d_plus_1`: ubah harga D+1 → `entry_price` ikut berubah (bukti tidak memakai harga sinyal).
4. `test_win_loss_same_bar`: bar menyentuh +5% dan −5% → `loss`.
5. `test_expired_timeout`: tidak kena target sampai 60 periode → `expired`, `periods` = 60.
6. `test_open_horizon_belum_selesai`: event terbaru yang belum lewat horizon → `open`, `periods` NULL.
7. `test_median_bukan_mean`: fixture dengan satu trade 60 periode → median tetap kecil.
8. `test_trend_filter_mengurangi_event`: varian `on` menghasilkan `n_events ≤ off` dan win rate berbeda.
9. `test_ta_recompute_idempoten`: jalankan 2× → jumlah baris `ta_breakout` sama.
