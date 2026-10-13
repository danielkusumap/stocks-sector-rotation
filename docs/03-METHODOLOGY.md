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

> **Blok di bawah digantikan `§6.4`** (plan berbasis analisa teknikal, `api_version` 1.2 — 13 Okt 2026).
> Rumusnya tetap berlaku untuk baris lama di `signal_weekly` sebelum migrasi 005 dijalankan.

**Level harga wajib ikut disimpan** (versi lama, dipakai web & report):
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

### 6.4 Trading plan berbasis analisa teknikal (pengganti §6.2 di atas)

Dipakai untuk setiap **pick saham** di `signal_weekly` dan disajikan `/weekly/picks` (`docs/05` §3, `api_version` **1.2**).
Semua level dihitung dari **harga penyesuaian** (`adj_close` — aksi korporasi memalsukan struktur) dan **semua angka ambang dibaca dari `config weekly.plan.*`**. Sumber data: `price_daily` (OHLCV+adj_close), `stock_metrics` d1 (`sma20`, `sma50`, `rsi14`, `atr14`), `ta_breakout` (statistik MFE/MAE — §10).

**Alasan tiap elemen harus disertakan** (`reason`, ≤ 140 char, Bahasa Indonesia, tanpa istilah mentah): user memutuskan dari alasan, bukan dari angka telanjang.

#### 6.4.0 Rezim pasar — gerbang yang menentukan alat (WAJIB dibaca lebih dulu)

Rencana **tidak boleh** memakai semua alat sekaligus: alat dipilih oleh rezim, dan satu pick maksimum **satu alat utama + satu konfirmasi**. (Dasar pemilihan: skill `idx-ta-trading-plan`, hasil pelajari 7 script LuxAlgo + Murphy bab 9.)

```
regime = "tren_naik"  bila close > SMA20 > SMA50 dan SMA20 menanjak (sma20 > sma20 5 bar lalu)
                      dan sektor saham ∈ {leading, improving}
         "range"      bila |SMA20 − SMA50| / close <= plan.range_ma_gap  (default 0,02)
         "turun"      bila close < SMA20 < SMA50
         "tipis"      bila median_turnover_20d_idr < universe.min_turnover_idr
                      atau share bar volume-0 dalam 20 bar terakhir >= plan.thin_zero_volume (default 0,2)
```
Urutan cek: `tipis` > `turun` > `range` > `tren_naik` (yang paling konservatif menang).

| Rezim | Alat utama (`entry_tool`) | Konfirmasi (`confirm_tool`) | Yang DILARANG | Stop (`stop_tool`) | Target |
|---|---|---|---|---|---|
| `tren_naik` | `pullback_ma20` (harga ≤ 1 ATR dari SMA20) **atau** `breakout_donchian` (tembus puncak 20 bar) | `volume` (≥ `plan.volume_mult` × rata-rata 20 bar) | entry reversion VWAP/RSI-overbought sebagai sinyal jual | `struktur_swing_low` (lantai ATR) | resistance 20 hari (TP1), puncak 40 hari / RR (TP2) |
| `range` | `sr_channel` (pantulan di pivot S/R terkuat) | `rsi_tepi_range` (RSI ≤ 35 di tepi bawah) | `breakout_donchian`, MA crossover | `sr_channel_bawah` (di balik kanal bawah, lantai ATR) | tepi atas kanal (TP1), kanal berikutnya (TP2) |
| `turun` | tidak ada — `entry_mode = "no_trade"` | — | semua entry | — | — |
| `tipis` | `pivot_level` (level pivot saja) | tidak ada (volume tidak dipercaya) | `volume`, VWAP/POC | `struktur_swing_low` dengan buffer × `plan.thin_stop_mult` (default 1,0 ATR) | pivot berikutnya |

Gerbang tambahan di dalam `tren_naik`: `chase_atr` (harga terlalu jauh dari SMA20) atau `rsi14 > universe.max_rsi` → `entry_mode = wait_pullback` (jangan chase). Di `range`, breakout yang tetap diambil berarti melanggar tabel di atas → `plan_ok = false` + catatan.

**Urutan penyelesaian konflik** (kalau alat bertentangan — mis. harga menembus resistance tapi rezim `range` dan RSI belum di tepi bawah): struktur harga menang atas indikator turunan → filter tren menang atas osilator → volume hanya mengonfirmasi/membatalkan → **masih seri = `no_trade`** (jawaban yang sah, bukan dipaksa).

#### 6.4.1 Setup & input
```
close            = adj_close bar terakhir sampai week_end
atr14            = ATR14 harian (Wilder) dari stock_metrics
above_ma20_atr   = (close − SMA20) / atr14            # jarak harga dari support dinamis, satuan ATR
vol20            = rata-rata volume 20 bar (bar yang punya volume > 0)
volume_ratio     = volume bar terakhir / vol20
don_high_f       = max(high, `plan.donchian_fast` bar)  # 20 bar
don_low_f        = min(low,  `plan.donchian_fast` bar)
don_high_s       = max(high, `plan.donchian_slow` bar)  # 40 bar
swing_low        = min(low,  `plan.swing_low_bars` bar) # 10 bar
```
`atr14 = null` → seluruh plan `null` (jangan mengarang level; UI menampilkan "—").

#### 6.4.2 Mode entry (dan mengapa)
| Kondisi | `entry_mode` | Zona entry | Alasan (yang ditulis ke user) |
|---|---|---|---|
| `close > don_high_f(bar sebelumnya)` **dan** `volume_ratio ≥ plan.volume_mult` | `breakout` | `don_high_f ± plan.zone_atr×atr14` | "Menembus puncak 20 hari dengan volume {x}× rata-rata — permintaan nyata, bukan kenaikan tipis." (aturan 4 minggu Donchian + konfirmasi volume ala Dow) |
| `above_ma20_atr ≤ 1` | `pullback` | `SMA20 ± plan.zone_atr×atr14` | "Harga masih dekat penyangga SMA20; beli di penyangga membuat stop lebih dekat dan R:R lebih baik." (MA sebagai support dinamis di tren naik) |
| `above_ma20_atr > plan.chase_atr` **atau** `rsi14 > universe.max_rsi` | `wait_pullback` | `SMA20 ± plan.zone_atr×atr14` | "Harga sudah {x} ATR di atas SMA20 (RSI {y}) — jangan chase; tunggu pullback ke SMA20." (memperbaiki risk kompensasi + RSI tinggi rawan mean-revert) |

Prioritas: `wait_pullback` > `breakout` > `pullback` (kalau dua kondisi benar, yang paling konservatif menang).
`chase_risk = (entry_mode == "wait_pullback")` — dipakai UI sebagai badge "jangan chase".
`entry_mid` = titik tengah zona = level acuan untuk stop/target/RR.

#### 6.4.3 Stop / SL — struktur dulu, volatilitas sebagai lantai (dan mengapa)
```
stop_struct = swing_low − plan.stop_buffer_atr × atr14        # di bawah low terendah 10 bar
stop_atr    = entry_mid − atr_stop_mult × atr14               # 1,5 × ATR (aturan lama §6.2)
stop        = max(stop_struct, stop_atr)                      # yang lebih dekat ke entry
batas_bawah = entry_mid − plan.min_stop_atr × atr14           # lantai: jangan lebih ketat dari 1 × ATR
stop        = min(stop, batas_bawah)
stop_pct    = stop / entry_mid − 1
```
`stop_basis` = `struktur_swing_low` (kalau `stop_struct` yang menang) · `volatilitas_atr` (kalau `stop_atr`) · `lantai_atr` (kalau lantai yang berlaku).
Alasan (yang ditulis ke user, satu kalimat sesuai basis):
- `struktur_swing_low`: "Stop di bawah low terendah 10 bar ({level}) + penyangga 0,5 ATR — di situlah skenario naik batal."
- `volatilitas_atr`: "Low terdekat terlalu jauh ({x}%); stop ditaruh 1,5 × ATR di bawah entry supaya posisi tidak kebesaran."
- `lantai_atr`: "Stop di bawah struktur terlalu ketat (< 1 ATR) sehingga rawan kena noise intraday; dipakai lantai 1 × ATR."
`stop_pct < −plan.max_stop_pct` → `plan_ok = false` + catatan "stop lebih lebar dari 8% — terlalu lebar untuk swing harian".

#### 6.4.4 Target berjenjang (dan mengapa)
```
tp1 = resistance terdekat di atas entry_mid = min(x ∈ {don_high_f, swing_high_20} : x > entry_mid)
      kalau tidak ada → entry_mid + plan.tp1_fallback_atr × atr14
tp2 = max(don_high_s, entry_mid + rr_min_tp2_netto × (entry_mid − stop))
rr1 = (tp1 − entry_mid) / (entry_mid − stop)
rr2 = (tp2 − entry_mid) / (entry_mid − stop)
```
- TP1 = **supply nyata** di atas harga (puncak 20 hari / swing high) → di situ ambil sebagian, karena di situlah penjual menumpuk.
- TP2 = **target terukur** (puncak 40 hari / measured move) yang dipastikan memberi **R:R minimal** `plan.rr_min_tp2` → supaya satu kemenangan menutup ≥ 3 kekalahan.
- **RR wajib bersih biaya** (`plan.fee_buy_bps` + `plan.fee_sell_bps`, default 15 + 25 bps sesuai broker IDX — user menyesuaikan):
  ```
  biaya_pct = (fee_buy_bps + fee_sell_bps) / 10_000
  rr1_netto = (tp1 − entry_mid − biaya_pct × entry_mid) / (entry_mid − stop + biaya_pct × entry_mid)
  ```
  Alasan ditulis ke user: "R:R dihitung setelah biaya beli+jual {x}% — RR bruto membuat target dekat terlihat lebih baik daripada kenyataannya."
- `rr2_netto < plan.rr_min_tp2` → `plan_ok = false` + catatan "R:R TP2 setelah biaya hanya {x}:1 (< 3:1)".

#### 6.4.5 Ekspektasi lama tahan + hit rate per target (dari modul TA `§10`)
Dari `ta_breakout` per (ticker, MA20, `trend_filter` sesuai config) **pada server yang sama**:
```
n_events, win_rate, median_periods_win, median_periods_loss     # sudah ada
mfe_pct per event = (max adj_close sebelum hasil − entry_price) / entry_price   # kolom §10.9 (info tambahan)
hit_tp1 = share(event dengan +tp1% TERSENTUH LEBIH DULU daripada −stop%)   # first touch, bukan "pernah kena"
hit_tp2 = share(event dengan +tp2% tersentuh lebih dulu daripada −stop%)
first_touch(level) dihitung dengan menelusuri bar per event (entry_date → horizon `ta.timeout_periods`):
  bar pertama yang menyentuh level itu menentukan hasil; kalau tidak ada sampai horizon → tidak dihitung kena
  (event `open` = horizon belum selesai → dikeluarkan dari penyebut dan jumlahnya dilaporkan)
```
UI menampilkan `hit_tp1`/`hit_tp2` sebagai **peluang historis**, bukan janji; `n_events < plan.min_events_hold` → bagian ini `null` + catatan "belum cukup riwayat".
Alasan ditulis ke user: "Dari {n} breakout terakhir: +5% kena {x}% (median {m} bar); target ini ({tp2}) setara +{y}% dan historis kena {z}%."
`median_periods_win` juga dipakai sebagai ekspektasi lama tahan → "median 7 bar ≈ 1,5 minggu".

#### 6.4.6 Invalidasi (1 kalimat, wajib)
```
invalidation = "Batal bila tutup harian < SMA20 ({sma20}) atau < stop ({stop}); "
             + "pasar: IHSG tutup < {support_ihsg} → tunda entry baru."
```
`support_ihsg` = `don_low_f` IHSG (ticker `IHSG`). Alasan: aturan keluar harus level objektif, bukan perasaan; SMA20 = garis tren jangka menengah.

#### 6.4.7 Keluaran yang disimpan & disajikan
`signal_weekly` diperluas (migrasi 005, `docs/04` §4): `regime`, `entry_tool`, `confirm_tool`, `entry_mode`, `entry_zone_low`, `entry_zone_high`, `stop`, `stop_pct`, `stop_basis`, `tp1`, `tp2`, `rr_tp1`, `rr_tp2`, `target` (= `tp2`, kompatibel), `volume_ratio`, `hold_median_periods`, `hit_tp1`, `hit_tp2`, `invalidation`, `plan_ok`, `plan_json` (alasan per elemen + angka dasar + catatan).
`entry_tool` ∈ `pullback_ma20`, `breakout_donchian`, `sr_channel`, `pivot_level`, `none`; `confirm_tool` ∈ `volume`, `rsi_tepi_range`, `none`. Rencana yang memuat lebih dari satu konfirmasi **ditolak** di kode (assert saat compute).
`rationale` tetap ada (ringkasan 1 kalimat untuk daftar); `rule_hits` tidak berubah.
Semua nilai persen/uang diformat frontend lewat `lib/format.ts` — backend mengirim angka.

#### 6.4.8 Test yang wajib ada
1. `test_plan_breakout_butuh_volume`: close menembus puncak 20 hari tanpa volume → **bukan** `breakout`.
2. `test_plan_wait_pullback_saat_jauh`: `above_ma20_atr = 2,5` → `entry_mode = wait_pullback` + `chase_risk = true`.
3. `test_stop_pilih_yang_struktur`: swing low dekat (0,8 ATR) → `stop_basis` = `struktur_swing_low`; swing low jauh (3 ATR) → `volatilitas_atr`.
4. `test_stop_lantai_atr`: struktur 0,4 ATR dari entry → `stop` = 1,0 ATR (lantai), `stop_basis` = `lantai_atr`.
5. `test_rr_netto_biaya`: dengan `fee_*` naik, `rr1_netto` turun dan bisa membuat `plan_ok = false`.
6. `test_tp1_fallback`: tidak ada resistance di atas entry → TP1 = entry + 1,5 ATR.
7. `test_plan_alasan_pendek_dan_bahasa_indonesia`: setiap `reason` ≤ 140 char, tidak memuat `SMA20`/`ATR`/`R:R` sebagai istilah mentah di kalimat user (pakai "penyangga 20 hari", "volatilitas", "imbal hasil terhadap risiko").
8. `test_atr_null_plan_null`: `atr14` null → semua level `null`, tidak ada exception.
9. `test_hit_rate_dari_mfe`: fixture MFE 8% → `hit_tp1` = 1,0 untuk TP1 +5%, `hit_tp2` = 0 untuk TP2 +10%.
10. `test_regime_gate`: SMA20 ≈ SMA50 (selisih 1%) → `regime = range` dan `entry_tool = sr_channel` walau harga menembus puncak 20 bar (breakout ditolak di range).
11. `test_regime_tipis_menang`: volume-0 ≥ 20% bar terakhir → `regime = tipis`, `confirm_tool = none` (tanpa konfirmasi volume), stop pakai `thin_stop_mult`.
12. `test_regime_turun_no_trade`: close < SMA20 < SMA50 → `entry_mode = no_trade`, semua level `null`, tetap tampil di daftar dengan catatan.
13. `test_konfirmasi_maks_satu`: memaksa dua konfirmasi → assert gagal (rancangan ditolak).
14. `test_konflik_seri_no_trade`: resistance ditembus tapi RSI 55 di rezim range → `no_trade` + catatan alasan seri.

#### 6.4.9 Level pivot & kanal S/R (definisi yang dipakai plan **dan** grafik)

```
pivot_high(i) = high(i) adalah tertinggi di jendela [i − plan.pivot_bars, i + plan.pivot_bars]
pivot_low(i)  = low(i)  adalah terendah di jendela itu
kanal          = kelompok pivot sejenis yang jaraknya ≤ plan.channel_tol_pct × close
strength       = jumlah pivot dalam kelompok (kekuatan level; makin banyak, makin kuat)
kanal_bawah/atas = rata-rata level pivot di kelompok
```
- Hanya kanal dengan `strength ≥ chart.channel_min_strength` yang digambar/dipakai sebagai alat `sr_channel`.
- **Validitas**: kanal S/R adalah alat utama **hanya di rezim `range`** (`§6.4.0`); di rezim `tren_naik` ia bukan alat utama (harga cenderung menembusnya) — di grafik ditampilkan meredup/hilang, bukan dihapus dari data.
- Pivot memakai `high`/`low` **penyesuaian** (dikalikan `adj_close/close`, sama seperti §10/ADR-040) supaya level tidak melompat di hari aksi korporasi.
- Test: `test_pivot_butuh_bar_kiri_kanan` (bar di ujung data tidak jadi pivot), `test_kanal_kelompokkan_pivot_berdekatan` (dua pivot 0,5% terpisah → 1 kanal strength 2), `test_kanal_min_strength` (strength 1 → tidak dipakai).

### 6.5 Analisa per saham untuk **semua emiten** (`stock_plan`) — bukan hanya pick mingguan

`§6.4` dihitung untuk tiap pick mingguan (3 saham/sektor, disimpan di `signal_weekly`). Untuk halaman **detail saham**, user ingin melihat analisa yang sama pada **emiten mana pun** yang dia buka — jadi mesin yang sama dijalankan untuk **semua emiten aktif** dan disimpan di tabel `stock_plan` (`docs/04` §4, migrasi 006). **Satu mesin, satu kebenaran**: `plan.py` dipakai `signal_weekly` (pick mingguan) dan `stock_plan` (semua emiten) — jangan ada dua implementasi.

- Cakupan: `stock.is_active = 1` **dan** punya ≥ `ta.min_history` bar. Emiten tanpa data cukup → baris dengan `regime = "tidak_cukup_data"`, level `null`, `notes` menyebut jumlah bar yang ada (tetap tampil, bukan error).
- Dihitung pada bar terakhir yang tersedia (bukan hanya Jumat), jadi halaman detail selalu segar setelah ingest; disimpan per `as_of_date` (riwayat, retensi `retention.plan_days`).
- Dipicu dari **tombol 7** (`stage=ta`) dan ikut `stage=all` — tidak ada tombol baru (user tidak perlu tahu bedanya).

#### 6.5.1 Ringkasan (`summary_lines`, 1–3 kalimat, ≤ 140 char)
Disusun rule-based dari angka yang sudah ada, urut ini, bagian tanpa isi dilewati:
1. **Kondisi & rezim** — "Harga 4.210 di atas penyangga 20 hari (4.088) dan 50 hari (3.960); rezim: tren naik."
2. **Plan** (kalau `plan_ok`) — "Zona beli 4.088–4.135, batas rugi 3.991 (−2,85%), target 4.360 (+6,25%) dan 4.580 (+11,61%); imbal hasil terhadap risiko 4,07:1."
3. **Skenario historis** (kalau `n_events ≥ plan.min_events_scenario`) — "Dari 29 breakout sebelumnya: target pertama kena 62% (median 7 bar), batas rugi kena lebih dulu 24%."
   Kalau belum cukup: "Belum cukup riwayat untuk menaksir peluang pada level ini (baru 3 breakout)."
4. **Catatan** (kalau ada) — `notes[]` (mis. "stop lebih lebar dari 8%", "jangan chase: harga 2,4 ATR di atas penyangga").
Tanpa istilah mentah (`SMA20`, `ATR`, `R:R`, `RSI`, `breakout` sebagai kata asing → pakai "penyangga 20 hari", "volatilitas", "imbal hasil terhadap risiko", "tembus level").

#### 6.5.2 Skenario (`scenario`) — "prediksi" yang jujur
Bukan ramalan: **frekuensi historis pada level plan hari ini**, dihitung dengan `first_touch` (`§10.9`) atas seluruh event breakout MA20 ticker itu (`ta_breakout`, `trend_filter` sesuai config):
```
p_tp1_first  = share(event: +tp1 tersentuh lebih dulu)          # ke level TP1 plan SEKARANG
p_sl_first   = share(event: −stop tersentuh lebih dulu)
p_timeout    = share(event: tidak keduanya sampai horizon)
p_tp2_first  = share(event: +tp2 tersentuh lebih dulu)
median_periods_tp1, median_periods_sl, n_events, n_open_dikeluarkan
```
Wajib disertai `n_events` dan basis datanya di UI. `n_events < plan.min_events_scenario` → seluruh `scenario` `null` (UI: "belum cukup riwayat"), jangan menampilkan angka dari 2–3 sampel.
Kalau `regime = range`, `entry_tool = sr_channel` → skenario dihitung dari event **pantulan kanal** (sentuhan level kanal), bukan breakout; kalau jumlahnya kurang → `null` (dan itu jawaban yang sah).

#### 6.5.3 Keluaran `stock_plan` (per `as_of_date` × ticker)
`regime`, `entry_tool`, `confirm_tool`, `entry_mode`, `entry_zone_low/high`, `stop`, `stop_pct`, `stop_basis`, `tp1`, `tp2`, `rr_tp1`, `rr_tp2`, `volume_ratio`, `hold_median_periods`, `hit_tp1`, `hit_tp2`, `p_tp1_first`, `p_sl_first`, `p_timeout`, `median_periods_tp1`, `median_periods_sl`, `n_events`, `invalidation`, `summary_lines` (JSON), `plan_ok`, `notes` (JSON), `plan_json` (alasan per elemen, sama seperti §6.4.7), `computed_at`.

#### 6.5.4 Test wajib
1. `test_plan_semua_emiten`: fixture 5 emiten (2 likuid tren, 1 range, 1 tipis, 1 riwayat pendek) → 5 baris `stock_plan`, emiten pendek `regime = tidak_cukup_data`.
2. `test_scenario_first_touch_bukan_mfe`: seri yang menyentuh +tp1 di bar 3 lalu −stop di bar 5 → `p_tp1_first` = 1,0, `p_sl_first` = 0 (MFE akan menyesatkan di sini).
3. `test_scenario_null_kalau_sampel_kecil`: 2 event → `scenario` `null` + `summary_lines` memuat kalimat "belum cukup riwayat".
4. `test_summary_urut_dan_pendek`: maksimum 3 kalimat, tiap kalimat ≤ 140 char, tanpa istilah mentah.
5. `test_plan_idempoten_semua_emiten`: `stage=ta` 2× → jumlah baris `stock_plan` untuk `as_of_date` terakhir sama (upsert, bukan duplikat).
6. `test_stock_plan_sama_dengan_signal_weekly`: untuk ticker yang sama pada pekan yang sama, level & rezim di `stock_plan` = di `signal_weekly` (satu mesin).

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

### 10.9 MFE / MAE per event (dipakai trading plan §6.4)
```
mfe_pct = (max adj_close dari entry_date sampai exit_date/bar horizon − entry_price) / entry_price
mae_pct = (min adj_close dari entry_date sampai exit_date/bar horizon − entry_price) / entry_price
```
Keduanya **negatif/positif apa adanya** (MFE ≥ 0, MAE ≤ 0), disimpan per baris `ta_breakout` (migrasi 005) supaya
pertanyaan "berapa sering target +3%/+8% tersentuh" bisa dijawab tanpa menghitung ulang seluruh event:
`hit(target_pct) = share(mfe_pct ≥ target_pct)`.
Untuk event `open` (horizon belum selesai), MFE/MAE dihitung sampai bar terakhir yang ada dan **ditandai** (`result = open`) —
jangan dihitung sebagai kemenangan di `hit()`.
Test: `test_mfe_mae_dari_seri_naik_turun` (naik 8% lalu turun 3% → `mfe_pct` ≈ +0,08, `mae_pct` ≈ −0,03).

**First touch per level** (dipakai skenario & `hit_tp*`, `§6.4.5`): fungsi `first_touch(bars, entry_date, level_up_pct, level_down_pct, horizon)` menelusuri bar satu per satu dan mengembalikan mana yang kena lebih dulu (`up` | `down` | `timeout` | `open`) + jumlah bar ke sentuhan pertama. MFE/MAE **tidak** bisa dipakai untuk ini (MFE tidak tahu urutan). Test: `test_first_touch_urutan` (naik +3% di bar 2 lalu turun −5% di bar 4 dengan level +3%/−5% → hasil `up`, `periods` 2; dibalik → `down`).

## 11. Indikator & lapisan konteks tambahan (v2)

Semua di bawah dihitung **backend** dari `price_daily` (harga penyesuaian) — kecuali disebut lain — dan hanya **disajikan** untuk grafik/detail; **tidak** mengubah aturan plan §6.4 kecuali ditulis eksplisit. Setiap indikator punya **syarat valid** (skill `idx-ta-trading-plan`): memasang alat di luar rezimnya = sinyal palsu.

### 11.1 Ultimate RSI (`ursi`)
```
d(t)    = adj_close(t) − adj_close(t−1)
ursi(t) = 50 + 50 × MA(d, len, method)(t) / MA(|d|, len, method)(t)      # method ∈ rma|ema|sma|tma
signal  = SMA(ursi, plan? lihat config `chart.ursi.signal_len`)
```
Catatan jujur yang wajib ditulis di kode: dengan `method=rma` rumus ini **identik dengan RSI(14) klasik** (`100 × emaUp/(emaUp+emaDown)`), dan `metrics.rsi14` memakai Wilder/RMA. "Penekanan tren" pada versi ini berasal dari **pemilihan smoothing** (`sma`/`tma` lebih halus → bertahan lebih lama di area ekstrem, lebih sedikit whipsaw) — bukan indikator yang berbeda. Test: `test_ursi_rma_sama_dengan_rsi14` (bandingkan dengan `stock_metrics.rsi14` pada 3 tanggal, toleransi 1e-6).
Aturan pakai (bukan contrarian): `ursi > 50` = arah naik; menembus ambang `chart.ursi.ob` (default 70) = **tren kuat** (bukan sinyal jual); potong `signal` dari bawah = momentum menguat. Valid hanya di rezim `tren_naik`; di `range` pakai RSI klasik sebagai kontrarian (jangan dua-duanya).

### 11.2 VWAP + pita deviasi σ (`vwap`)
```
typical(t) = (high + low + close) / 3                      # kerangka penyesuaian
vwap_n(t)  = Σ_{i=t−n+1..t} typical(i)×volume(i) / Σ volume(i)          # n = chart.vwap.len (default 20)
dev(t)     = adj_close(t) − vwap_n(t)
pita atas/bawah = vwap_n(t) ± k × stdev(dev, n)             # k = chart.vwap.band (default 1,0 & 2,0)
```
- **Anchored VWAP** (`chart.vwap.anchor`): `rolling` (default) · `pivot_low` (dari pivot low terakhir §6.4.9) · `quarter` (awal kuartal). Anchor dicatat di respons (`anchor_date`) supaya angkanya bisa direplay.
- Syarat valid: **rezim `range`** (reversion di tepi pita) atau saham likuid; **dilarang** dipakai sebagai sinyal beli di `tren_naik` (harga menempel pita atas berhari-hari).
- Volume 0 → bar itu dilewati dari penyebut (jangan menganggap volume 0 sebagai harga).

### 11.3 POC / volume profile (`poc`)
```
profil = bucket harga (chart.poc.bins, default 24) atas jendela chart.poc.bars (default 60 bar)
POC    = titik tengah bucket dengan Σ volume terbesar
value area = bucket yang menampung chart.poc.value_area (default 0,7) dari total volume, mulai dari POC
```
- **Basis**: `daily` (default) = dari bar harian → **wajib dilabeli "perkiraan"** di UI, karena kita tidak tahu volume terjadi di harga mana di dalam 1 bar; `intraday` = dari `price_intraday` 5m (presisi lebih baik) dan **hanya tersedia selama bar intraday ada** (retensi `retention.intraday_days`; DB dev baru punya 2 hari). Respons memuat `basis` + `bars_used`.
- Syarat valid: saham likuid (`median_turnover_20d_idr` ≥ ambang) — di saham tipis POC jadi artefak (banyak bar volume 0).

### 11.4 SMC — struktur & zona (`smc`) — **lapisan konteks, bukan aturan plan**
```
swing pivot : high/low dengan plan.pivot_bars bar kiri & kanan lebih rendah/tinggi (sama seperti §6.4.9)
BOS         : close menembus swing high terakhir (tren naik) → struktur berlanjut
CHoCH       : close menembus swing low terakhir (tren naik) → watak berubah (kandidat pembalikan)
order block : candle berlawanan terakhir sebelum impuls yang memecah struktur (bullish OB = candle turun terakhir)
FVG         : celah 3 bar — bullish bila low(t) > high(t−2); bearish bila high(t) < low(t−2)
equal H/L   : dua pivot sejenis dalam toleransi plan.channel_tol_pct → magnet likuiditas
premium/discount : 50% dari rentang swing low↔swing high terakhir; di atas 50% = premium (mahal), di bawah = discount
mitigasi    : OB/FVG dianggap terpakai bila harga kembali menyentuhnya
```
Semua level dihitung dari `high`/`low` **penyesuaian**. Tampil hanya bila `chart.smc.enabled` **dan** rezim `range`/`tren_naik` (di `tipis` tidak digambar — pivot noise). **Tidak** dipakai untuk entry/stop/target plan: level plan tetap dari §6.4 (menghindari dua sistem level yang bertabrakan — skill: maksimum satu alat utama + satu konfirmasi).

### 11.5 Elliott Wave (`elliott`) — **kandidat, bukan aturan**
```
ZigZag   : pivot bergantian (§11.4) yang jaraknya ≥ chart.elliott.min_move (default 0,03 = 3%)
impuls 5 : pola 5 titik dengan aturan baku — wave2 tidak melewati awal wave1, wave4 tidak tumpang tindih wave1,
           wave3 bukan yang terpendek
koreksi 3: A-B-C setelah impuls; zona Fibonacci 0,382/0,5/0,618 dari wave terakhir
status   : "candidate" | "invalidated" (bila aturan di atas dilanggar oleh bar baru) — pola yang batal tetap dikirim
           dengan flag `invalidated=true` supaya bisa ditampilkan sebagai garis putus, bukan dihapus
```
Elliott **tidak boleh** menjadi syarat entry/stop/target apa pun (`plan` tetap dari §6.4) dan hasilnya tidak dipakai di backtest — penamaan wave berubah saat data baru masuk (tidak reproducible). UI wajib menulis "kandidat, bisa berubah".

### 11.6 Test wajib (semua §11)
1. `test_ursi_rma_sama_dengan_rsi14` (lihat §11.1).
2. `test_ursi_metode_sma_lebih_halus`: stdev selisih antar-bar `sma` < `rma` pada seri yang sama.
3. `test_vwap_volume_nol_dilewati`: bar volume 0 tidak menggeser VWAP (bandingkan dengan perhitungan manual).
4. `test_vwap_anchor_pivot_low`: `anchor_date` = tanggal pivot low terakhir dan VWAP dihitung dari tanggal itu.
5. `test_poc_dari_bar_harian_dilabeli_perkiraan`: respons memuat `basis: "daily"` dan `bars_used`.
6. `test_smc_fvg_bullish`: fixture 3 bar dengan celah → satu FVG bullish, level = batas celah.
7. `test_smc_bos_butuh_close`: high menembus swing high tapi close tidak → **bukan** BOS.
8. `test_elliott_invalidated_ditandai`: pola yang dilanggar bar baru → `invalidated=true`, tetap dikirim.
9. `test_lapisan_tidak_mengubah_plan`: dengan semua lapisan aktif, nilai `stock_plan`/`signal_weekly` identik dengan saat lapisan mati.

