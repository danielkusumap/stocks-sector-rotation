# 05 — API Contract (v1)

Kontrak ini **mengikat kedua sisi**. Base URL dev: `http://127.0.0.1:8000/api/v1`. Semua response `application/json; charset=utf-8`. Semua field `snake_case`. Semua waktu ISO-8601 dengan offset `+07:00`. Semua tanggal bisnis `YYYY-MM-DD` (WIB).

Konvensi:
- `api_version: "1.0"` dikirim di setiap response (field teratas).
- Query param yang tidak dikenal → **diabaikan**, tidak error (frontend boleh menambah param baru tanpa memecah backend).
- Nilai yang belum bisa dihitung → `null`, **bukan** 0 dan bukan string `"-"`.
- Error:
```json
{ "api_version": "1.0", "error": { "code": "invalid_timeframe", "message": "timeframe harus salah satu dari: d1, w1, w1_fri, midday", "detail": {"received": "x1"} } }
```
Status: `400` input salah, `404` tidak ada, `409` konflik (import duplikat), `422` validasi, `500` gagal server. Error **tidak pernah** mengembalikan stack trace.
- Setiap response data yang berasal dari hasil hitung menyertakan blok `data_status`:
```json
"data_status": {
  "as_of": "2026-10-12",
  "timeframe": "d1",
  "status": "ok",                 // ok | stale | partial
  "last_data_at": "2026-10-12T16:10:00+07:00",
  "computed_at": "2026-10-12T16:31:02+07:00",
  "range_from": "2026-07-15",     // awal rentang yang BENAR-BENAR dipakai hitungan ini
  "range_to": "2026-10-12",       // akhir rentang (= as_of untuk d1/w1/w1_fri/midday)
  "range_label": "15 Jul – 12 Okt 2026",
  "partial_sectors": []           // kode sektor dengan constituents_count < 3
}
```
Aturan `range_from`/`range_to`/`range_label` (dipakai UI untuk menampilkan "ambil dari periode berapa sampai berapa" — user tidak boleh menebak):

| timeframe | `range_from` | `range_to` | catatan |
|---|---|---|---|
| `d1` | hari bursa terakhir yang punya hasil (`as_of`) | sama | satu hari |
| `w1` | **Senin** minggu berjalan | hari bursa terakhir | minggu belum final |
| `w1_fri` | **Senin** | **Jumat** (final) | minggu lengkap |
| `midday` | hari ini | hari ini | jam terakhir bar intraday |

`range_label` **disusun backend** (Bahasa Indonesia, `d Mmm yyyy`, mis. `5–9 Okt 2026`, `15 Jul – 12 Okt 2026`) supaya frontend tidak menyusun sendiri rentang tanggal finansial. Kalau `window` dipakai untuk kolom return/ekor, `range_from` = bar terjauh yang dipakai untuk kolom itu (bukan awal seluruh riwayat). Kalau belum ada hasil hitung: ketiganya `null` — UI menampilkan "belum ada data".

Parameter umum (dipakai banyak endpoint):
`timeframe` = `d1|w1|w1_fri|midday` (default `d1`) · `as_of` = tanggal acuan (default: tanggal terakhir yang ada) · `window` = `1w|1m|3m|6m|1y|ytd` (default `3m`, hanya panjang ekor & kolom return) · `weighting` = `equal|turnover|captier` (default dari config) · `format` = `json` (default).

**Parameter bernilai banyak** (`sector`, `quadrant`): diterima dalam dua bentuk dan keduanya wajib jalan —
`?sector=IDXFINANCE&sector=IDXBASIC` (diulang) **dan** `?sector=IDXFINANCE,IDXBASIC` (satu nilai dipisah koma).
Backend memisah koma lebih dulu, trim spasi, uppercase, lalu dedupe. Nilai kosong (`?sector=`) diabaikan (dianggap tidak memfilter).

---

## 1. Meta

### `GET /health`
```json
{ "api_version": "1.0", "status": "ok", "db": "ok", "tables": 14, "uptime_s": 812 }
```

### `GET /api/v1/meta/sectors`
Daftar 11 sektor + warna token (dipakai frontend untuk legenda & heatmap).
```json
{ "api_version": "1.0", "items": [
  { "code": "IDXFINANCE", "name_id": "Keuangan", "name_en": "Financials",
    "color_token": "sector-finance", "color_hex": "#3B82F6", "sort_order": 7,
    "constituents_active": 47 }
] }
```

### `GET /api/v1/meta/config`
Semua ambang batas yang **dipakai** server, supaya UI bisa menampilkan ("filter aktif: turnover ≥ Rp 1 M"). Sumber: `config/default.yaml`.
```json
{ "api_version": "1.0",
  "universe": { "min_turnover_idr": 1000000000, "min_price_idr": 100, "max_rsi": 75 },
  "rrg": { "ema_span": 14, "roc_lag": 10, "weekly": { "ema_span": 14, "roc_lag": 4 },
           "min_points": { "d1": 60, "w1": 30, "w1_fri": 30, "midday": 60 } },
  "timeframes": ["d1", "w1", "w1_fri", "midday"],
  "windows": ["1w", "1m", "3m", "6m", "1y", "ytd"],
  "midday_gate_min_bar_time": "11:30",
  "last_ingest": { "prices_daily": "2026-10-12T16:31:02+07:00", "intraday": "2026-10-12T16:31:40+07:00",
                   "signals_weekly": "2026-10-09T17:02:11+07:00" } }
```

### `GET /api/v1/meta/dates`
Tanggal yang **benar-benar punya hasil hitung** — dipakai `AsOfPicker` untuk menandai & menonaktifkan hari tanpa data (libur bursa). Sumber: `SELECT DISTINCT as_of_date FROM rrg_daily WHERE timeframe = ?` (fallback ke `sector_metrics` bila `rrg_daily` kosong).
Query: `timeframe` (default `d1`), `limit` (default 120, maks 400).
```json
{ "api_version": "1.1",
  "timeframe": "d1",
  "latest": "2026-10-12",
  "dates": ["2026-10-12", "2026-10-09", "2026-10-08", "2026-10-07"] }
```
Aturan:
- Urut **menurun** (terbaru dulu). Tanggal yang tidak ada di daftar = hari tanpa data (libur/suspend pasar) → UI menonaktifkannya, tidak mengirim request.
- Daftar kosong bukan error: `{"dates": [], "latest": null}` → UI memakai `<input type="date">` biasa dan membiarkan backend memilih tanggal terakhir (`data_status.as_of`) — jangan blokir user.
- Cache 60 s seperti endpoint berat lain; kolom `as_of_date` sudah terindeks lewat `idx_rrg_lookup`.

### `GET /api/v1/meta/market`
Kutipan **IHSG** untuk kartu di halaman Overview. Endpoint ringan yang dipanggil berulang (poll 60 s) — jangan pakai `/briefing/morning` untuk ini.
**Hanya benchmark IHSG.** Tidak ada jalur kutipan live untuk emiten atau sektor lain — sektor/saham tetap dari hasil hitung di DB. Jangan memperluas endpoint ini jadi kutipan multi-ticker.
Query: `live` (default `false`).

```json
{ "api_version": "1.1",
  "benchmark": "IHSG",
  "symbol": "^JKSE",
  "close": 5936.15,
  "prev_close": 6093.76,
  "ret_1d": -0.0259,
  "ret_1w": -0.0204,
  "ret_intraday": -0.0134,
  "open": 6010.2, "high": 6021.7, "low": 5920.4, "volume": 11840000000,
  "as_of": "2026-10-13",
  "last_bar_at": "2026-10-13T14:35:00+07:00",
  "session": "open",
  "source": "live",
  "delayed": true,
  "cached": false,
  "cache_age_s": 0,
  "data_status": { "...": "lihat konvensi; range_from/range_to = hari ini" } }
```

Aturan:
- `live=false` (default) → baca dari DB (`price_daily` ticker `IHSG`); `source: "db"`.
- `live=true` → ambil bar terakhir `^JKSE` dari yfinance (interval 1d + 1m/5m bila jam bursa), **tidak** menulis ke DB (kutipan read-only), lalu simpan di cache selama `config.market.live_ttl_seconds` (default 60). Respons berikutnya dalam jendela itu → `cached: true` + `cache_age_s`. Ini yang mencegah N tab browser membanjiri Yahoo.
- `delayed: true` selalu (feed Yahoo untuk IDX punya delay); UI **wajib** menampilkan "per <waktu>" dan kata "delay" — jangan tampilkan seolah realtime.
- `session`: `open` (09:00–12:00 / 13:30–16:00 WIB) · `break` (12:00–13:30) · `closed`. Diluar jam bursa, `ret_intraday` = `null`.
- Kalau fetch live gagal → jangan error: kembali ke nilai DB dengan `source: "db"`, `delayed: true`, dan `data_status.status = "stale"`, plus `detail: "live gagal, memakai data tersimpan"`.
- Wajib ada test: poll berulang dalam TTL → 1× fetch Yahoo saja (`cached: true` pada respons kedua).

### `GET /api/v1/freshness`
```json
{ "api_version": "1.0",
  "midday_gate": { "status": "stale", "as_of_date": "2026-10-13", "last_bar_at": "2026-10-13T11:05:00+07:00",
                   "required_bar_time": "11:30", "probes": [ { "ticker": "BBCA", "last_bar_at": "2026-10-13T11:05:00+07:00" } ] },
  "daily_ingest": { "status": "ok", "last_data_at": "2026-10-12T16:10:00+07:00" } }
```

---

## 2. Diagram & tabel

### `GET /api/v1/rrg`
Titik + ekor untuk diagram RRG. `scope=sector` (default) atau `scope=stock&sector=IDXFINANCE`.
Query: `timeframe, as_of, scope, sector, window, weighting, tail_points` (default `tail_points` = jumlah periode dalam `window`, maks 60).
```json
{ "api_version": "1.1",
  "timeframe": "w1_fri", "as_of": "2026-10-09", "window": "3m", "weighting": "equal",
  "quadrants": { "leading": 3, "weakening": 2, "lagging": 3, "improving": 3 },
  "items": [
    { "ref_id": "IDXFINANCE", "name": "Keuangan", "color_hex": "#3B82F6",
      "rs_ratio": 102.31, "rs_momentum": 100.84,
      "rs_ratio_change_1p": 0.42, "rs_momentum_change_1p": 0.31,
      "quadrant": "leading", "quadrant_prev": "improving", "transition": "improving→leading",
      "quadrant_age_periods": 2, "score": 87.4, "rank_score": 1, "streak_weeks": 2,
      "ret_1w": 0.0181, "median_turnover_20d_idr": 1180000000000,
      "tail": [ { "as_of": "2026-09-25", "rs_ratio": 99.4, "rs_momentum": 99.1 }, { "as_of": "2026-10-02", "rs_ratio": 100.2, "rs_momentum": 100.6 },
                { "as_of": "2026-10-09", "rs_ratio": 102.31, "rs_momentum": 100.84 } ] }
  ],
  "data_status": { "...": "lihat konvensi" } }
```
Aturan: `tail` urut lama→baru, panjang ≤ `tail_points`, sudah dibatasi `min_points` (titik warmup dibuang). Titik terakhir **selalu** sama dengan `rs_ratio`/`rs_momentum` di atas.

**Field wajib di setiap item** (dipakai `PointCard`, `docs/06 §5` — angkanya harus identik dengan baris `sectors/summary` untuk `ref_id` yang sama):

| Field | Sumber DB | Kalau tidak ada |
|---|---|---|
| `rs_ratio`, `rs_momentum`, `quadrant`, `quadrant_prev`, `transition`, `quadrant_age_periods` | `rrg_daily` | — |
| `rs_ratio_change_1p`, `rs_momentum_change_1p` | `rrg_daily` | `null` (jangan 0) |
| `score`, `rank_score` | `rrg_daily` / `sector_metrics` (hanya `scope=sector`) | `null` untuk `scope=stock` |
| `streak_weeks` | `signal_weekly` terakhir untuk `ref_id` (0 bila tidak pernah muncul) | `0` |
| `ret_1w`, `median_turnover_20d_idr` | `sector_metrics` / `stock_metrics` | `null` |
| `color_hex` | `sector.color_hex` (untuk `scope=stock`: warna sektornya) | token netral |

Field baru ini **aditif** (naik ke `api_version` 1.1); frontend lama yang tidak membacanya tetap jalan. Backend **wajib** mengirim `streak_weeks` (boleh `0`) dan `rs_*_change_1p` bila `rrg_daily` memilikinya — `PointCard` menampilkannya sebagai "Δ1p" dan badge streak.

### `GET /api/v1/sectors/summary`
Baris tabel di bawah diagram — inilah tabel yang difilter user. Query filter (semua opsional, semua dikerjakan di SQL):
`sector` (multi), `quadrant` (multi: `leading,weakening,lagging,improving`), `transition` (mis. `improving→leading`), `min_streak` (int), `min_turnover_idr`, `ret_positive_only` (bool, default `false` — hanya sektor dengan nilai kolom return jendela aktif > 0), `only_partial` (bool), `sort` = `score|rs_ratio|rs_momentum|ret_1w|ret_1m|turnover|rank_score` (default `score`), `dir` = `desc|asc`, `limit`, `offset`, plus `timeframe/as_of/window/weighting`.
```json
{ "api_version": "1.0", "total": 11, "limit": 50, "offset": 0,
  "items": [
    { "code": "IDXFINANCE", "name_id": "Keuangan", "color_hex": "#3B82F6",
      "quadrant": "leading", "quadrant_label": "Memimpin", "quadrant_desc": "Tren relatif naik dan masih dipercepat.",
      "quadrant_prev": "improving", "transition": "improving→leading", "quadrant_age_periods": 2,
      "rs_ratio": 102.31, "rs_momentum": 100.84,
      "rs_ratio_change_1p": 0.42, "rs_momentum_change_1p": 0.31,
      "ret_1w": 0.0181, "ret_1m": 0.0412, "ret_3m": 0.0903, "ret_6m": null, "ret_ytd": 0.1533,
      "turnover_idr": 1180000000000, "median_turnover_20d_idr": 980000000000, "turnover_growth": 0.21,
      "advancers": 31, "decliners": 12, "unchanged": 4, "constituents_count": 47, "partial": false,
      "score": 87.4, "rank_score": 1,
      "streak_weeks": 2,
      "top_stock": { "ticker": "BBRI", "stock_score": 92.1 } }
  ],
  "data_status": { "...": "lihat konvensi" } }
```
`streak_weeks` dibaca dari `signal_weekly` terakhir (0 bila tidak pernah muncul).

### `GET /api/v1/sectors/{code}`
Detail satu sektor: metrik + seri indeks + konstituen (tabel drill-down) + RRG sahamnya ringkas.
Query: `timeframe, window, weighting, as_of, constituents_limit` (default 50), `constituent_sort` (default `stock_score`), `min_turnover_idr`, `min_price_idr`.
```json
{ "api_version": "1.0",
  "sector": { "code": "IDXFINANCE", "name_id": "Keuangan", "color_hex": "#3B82F6" },
  "metrics": { "quadrant": "leading", "rs_ratio": 102.31, "rs_momentum": 100.84, "ret_1w": 0.0181,
               "score": 87.4, "streak_weeks": 2, "constituents_count": 47, "advancers": 31, "decliners": 12 },
  "series": [ { "date": "2026-10-08", "index_close": 104.31, "ret_1d": 0.0021 }, { "date": "2026-10-09", "index_close": 105.12, "ret_1d": 0.0078 } ],
  "constituents": { "total": 47, "items": [
    { "ticker": "BBRI", "name": "Bank Rakyat Indonesia", "close": 4250, "ret_1d": 0.012, "ret_1w": 0.031,
      "median_turnover_20d_idr": 210000000000, "rs_ratio": 103.1, "rs_momentum": 101.2, "quadrant": "leading",
      "stock_score": 92.1, "rsi14": 62.4, "atr14": 78.5 } ] },
  "data_status": { "...": "lihat konvensi" } }
```

### `GET /api/v1/stocks`
Tabel semua saham (halaman "Saham"). Query: `timeframe, as_of, sector` (multi), `quadrant` (multi), `ret_positive_only` (bool, default `false`) — **acuan tetap `ret_1w`** karena endpoint ini tidak punya parameter `window`: artinya "hanya saham dengan `ret_1w > 0`" —, `q` (cari ticker/nama, min 1 char), `min_turnover_idr`, `min_price_idr`, `sort` = `stock_score|rs_ratio|ret_1d|ret_1w|turnover|ticker` (default `stock_score`), `dir`, `limit` (default 50, maks 500), `offset`.
```json
{ "api_version": "1.0", "total": 612, "limit": 50, "offset": 0,
  "items": [ { "ticker": "BBRI", "name": "Bank Rakyat Indonesia", "sector_code": "IDXFINANCE",
               "close": 4250, "ret_1d": 0.012, "ret_1w": 0.031, "ret_1m": 0.055,
               "median_turnover_20d_idr": 210000000000, "rs_ratio": 103.1, "rs_momentum": 101.2,
               "quadrant": "leading", "quadrant_label": "Memimpin", "stock_score": 92.1,
               "rsi14": 62.4, "atr14": 78.5 } ],
  "data_status": { "...": "lihat konvensi" } }
```

### `GET /api/v1/stocks/{ticker}`
Detail saham: metrik + seri harga + RRG vs sektornya + snapshot pick terakhir.
```json
{ "api_version": "1.0",
  "stock": { "ticker": "BBRI", "name": "Bank Rakyat Indonesia", "sector_code": "IDXFINANCE", "yahoo_symbol": "BBRI.JK" },
  "metrics": { "close": 4250, "sma20": 4110, "sma50": 3980, "rsi14": 62.4, "atr14": 78.5,
               "ret_1d": 0.012, "ret_1w": 0.031, "ret_1m": 0.055, "median_turnover_20d_idr": 210000000000,
               "rs_ratio": 103.1, "rs_momentum": 101.2, "quadrant": "leading", "stock_score": 92.1,
               "margin_to_min_turnover": 210.0 },
  "series": [ { "date": "2026-10-12", "close": 4250, "volume": 91200000 } ],
  "last_pick": { "week_end": "2026-10-09", "rank": 1, "streak_weeks": 3, "entry_ref": 4250, "stop": 4132, "target": 4486, "rationale": "..." } }
```

### `GET /api/v1/ta/summary`
Ringkasan backtest MA **tanpa buka detail** (dipakai kolom tabel & badge). Satu baris per entitas.
Query: `scope` = `sector|stock` (default `sector`), `timeframe` (default `d1`), `weighting`, `ma_period` (default `config.ta.ma_default`; nilai sah = `config.ta.ma_periods`), `trend_filter` (bool, default `config.ta.trend_filter`), `sector` (multi, untuk `scope=stock`), `q`, `min_events` (int, default 0 — baris dengan event lebih sedikit tetap tampil tapi angkanya `null`), `sort` = `win_rate|median_periods|events|last_breakout|gain_since_breakout|ref_id` (default `win_rate`), `dir`, `limit` (default 50, maks 500), `offset`.
```json
{ "api_version": "1.0", "scope": "stock", "timeframe": "d1", "ma_period": 20, "trend_filter": true,
  "total": 612, "limit": 50, "offset": 0,
  "items": [
    { "ref_id": "BBRI", "name": "Bank Rakyat Indonesia", "sector_code": "IDXFINANCE",
      "close": 4250, "ma": 4110, "above_ma": true,
      "n_events": 9, "win": 5, "loss": 3, "expired": 1, "open": 0,
      "win_rate": 0.625, "median_periods_win": 9, "median_periods_loss": 6,
      "last_breakout": { "signal_date": "2026-10-06", "entry_date": "2026-10-07", "entry_price": 4012.5,
                         "entry_basis": "open", "periods_since": 5, "gain_since": 0.0592,
                         "result": "open", "exit_date": null, "exit_price": null, "periods": null } } ],
  "coverage": { "refs_tested": 916, "refs_skipped_short_history": 6,
                "bars_from": "2024-10-14", "bars_to": "2026-10-13", "price_basis": "adj_close" },
  "data_status": { "...": "lihat konvensi" } }
```
Aturan: `win_rate = win / (win + loss)` — `expired` & `open` **bukan** kekalahan dan dilaporkan sendiri; `median_periods_*` = median, bukan rata-rata; `coverage` **wajib** ada (UI menulis jumlah emiten dilewati karena riwayat kurang + `price_basis`); baris tanpa event → `win_rate`/`median_periods_*` = `null` (UI menampilkan `—`, jangan 0%).

### `GET /api/v1/ta/{scope}/{ref_id}`
Detail satu entitas (`scope` = `sector|stock`; `ref_id` = kode sektor atau ticker). Query: `timeframe`, `ma_period` (default config), `trend_filter` (bool, default config), `window` (panjang deret MA, default `3m`), `as_of`, `events` (jumlah event terakhir, default 20, maks 200).
```json
{ "api_version": "1.0", "scope": "stock", "ref_id": "BBRI", "name": "Bank Rakyat Indonesia",
  "ma_period": 20, "trend_filter": true, "price_basis": "adj_close",
  "ma_series": [ { "date": "2026-10-12", "close": 4210.0, "ma": 4088.4 } ],
  "stats": {
    "filter_on":  { "n_events": 9, "win": 5, "loss": 3, "expired": 1, "open": 0, "win_rate": 0.625, "median_periods_win": 9, "median_periods_loss": 6 },
    "filter_off": { "n_events": 14, "win": 6, "loss": 7, "expired": 1, "open": 0, "win_rate": 0.462, "median_periods_win": 11, "median_periods_loss": 5 } },
  "latest": { "signal_date": "2026-10-06", "entry_date": "2026-10-07", "entry_price": 4012.5, "entry_basis": "open",
              "periods_since": 5, "gain_since": 0.0592, "result": "open", "exit_date": null, "exit_price": null, "periods": null },
  "events": [ { "signal_date": "2026-08-11", "entry_date": "2026-08-12", "entry_price": 3890.0, "result": "win",
                "periods": 7, "exit_date": "2026-08-21", "exit_price": 4095.5 } ],
  "coverage": { "refs_tested": 916, "refs_skipped_short_history": 6, "bars_from": "2024-10-14", "bars_to": "2026-10-13", "price_basis": "adj_close" },
  "data_status": { "...": "lihat konvensi" } }
```
Aturan: `stats` **selalu** memuat kedua varian (`filter_on` & `filter_off`) supaya perbandingan "dengan/tanpa filter" tidak butuh dua permintaan; `latest` = event terbaru pada `trend_filter` yang dipilih; `ma_series` hanya memuat bar yang punya MA (warmup dibuang) dan urut lama→baru; entitas tanpa event → `latest: null`, `events: []` (HTTP 200, bukan error).

### `GET /api/v1/plan/stock/{ticker}`
**Analisa lengkap satu saham** untuk halaman detail (`docs/06` §5.3, rumus `docs/03` §6.5) — berlaku untuk **semua emiten**, bukan hanya pick mingguan. Membaca baris `stock_plan` (satu sumber kebenaran; `/series/stock/{ticker}` memakai baris yang sama untuk legendanya).
Query: `as_of` (default bar terakhir yang ada).
```json
{ "api_version": "1.0", "as_of": "2026-10-13",
  "stock": { "ticker": "BBRI", "name": "Bank Rakyat Indonesia", "sector_code": "IDXFINANCE", "board": "Utama" },
  "price": { "close": 4210.0, "prev_close": 4184.0, "ret_1d": 0.0062, "price_basis": "adj_close" },
  "regime": { "code": "tren_naik", "label": "Tren naik",
               "reason": "Harga di atas penyangga 20 & 50 hari dan sektornya Memimpin — alat utama pantulan ke penyangga.",
               "active_tools": ["pullback_ma20", "volume"] },
  "summary_lines": [ "Harga 4.210 di atas penyangga 20 hari (4.088) dan 50 hari (3.960); rezim: tren naik.",
                      "Zona beli 4.088–4.135, batas rugi 3.991 (−2,85%), target 4.360 (+6,25%) dan 4.580 (+11,61%); imbal hasil terhadap risiko 4,07:1.",
                      "Dari 29 breakout sebelumnya: target pertama kena 62% (median 7 bar), batas rugi kena lebih dulu 24%." ],
  "plan": { "entry_mode": "pullback", "entry_zone": { "low": 4088.0, "high": 4135.0, "reason": "…" },
             "stop": { "level": 3991.0, "pct": -0.0285, "basis": "struktur_swing_low", "reason": "…" },
             "tp1": { "level": 4360.0, "pct": 0.0625, "rr": 2.19, "basis": "resistance_20", "reason": "…" },
             "tp2": { "level": 4580.0, "pct": 0.1161, "rr": 4.07, "basis": "donchian_40", "reason": "…" },
             "hold": { "median_periods": 7, "n_events": 29, "win_rate": 0.34, "hit_tp1": 0.62, "hit_tp2": 0.34, "reason": "…" },
             "invalidation": "Batal bila tutup harian di bawah penyangga 20 hari (4.110) atau batas rugi 3.991.",
             "plan_ok": true, "notes": [] },
  "scenario": { "p_tp1_first": 0.62, "p_sl_first": 0.24, "p_timeout": 0.14,
                "p_tp2_first": 0.34, "median_periods_tp1": 7, "median_periods_sl": 4,
                "n_events": 29, "n_open_dikeluarkan": 1, "basis": "event breakout MA20 (filter tren aktif), horizon 60 bar" },
  "levels_table": [ { "label": "Zona beli", "low": 4088.0, "high": 4135.0 }, { "label": "Batas rugi", "level": 3991.0 },
                     { "label": "Target 1", "level": 4360.0 }, { "label": "Target 2", "level": 4580.0 },
                     { "label": "Penyangga 20 hari", "level": 4088.4 }, { "label": "Penyangga 50 hari", "level": 3960.1 },
                     { "label": "Puncak 20 hari", "level": 4360.0 }, { "label": "Puncak 40 hari", "level": 4580.0 },
                     { "label": "Terendah 10 hari", "level": 3980.0 } ],
  "coverage": { "bars_available": 473, "bars_from": "2024-10-14", "bars_to": "2026-10-13",
                 "n_events": 29, "price_basis": "adj_close" },
  "data_status": { "...": "lihat konvensi" } }
```
Aturan:
- Ticker tanpa riwayat cukup → `regime.code = "tidak_cukup_data"`, `plan`/`scenario` `null`, `summary_lines` memuat alasannya, HTTP **200** (bukan 404/500).
- Ticker tidak ada di `stock` → `404 not_found` (sama seperti `/stocks/{ticker}`).
- `scenario` `null` bila `n_events < weekly.plan.min_events_scenario` — UI menampilkan "belum cukup riwayat", bukan angka dari sampel kecil.
- `plan.plan_ok = false` → tetap 200 + `notes[]`; UI menandai "perlu ditinjau".
- Semua angka harga penyesuaian; label UI "harga penyesuaian". Frontend tidak menghitung apa pun (R:R, %, peluang semua dari sini).
- `levels_table` disediakan supaya UI tidak perlu merakit ulang daftar level dari banyak blok (satu tempat, urutan tetap).

### `GET /api/v1/rotation/matrix`
Matriks transisi kuadran (untuk panel "apa yang berubah").
Query: `timeframe, window`, `scope` (default `sector`).
```json
{ "api_version": "1.0", "timeframe": "w1_fri", "from": "2026-10-02", "to": "2026-10-09",
  "cells": [ { "from": "improving", "to": "leading", "count": 2, "refs": ["IDXFINANCE", "IDXENERGY"] } ],
  "changes": [ { "ref_id": "IDXFINANCE", "name": "Keuangan", "from": "improving", "to": "leading", "as_of": "2026-10-09" } ] }
```

### `GET /api/v1/heatmap`
Grid performa sektor per periode (kolom: `1d,1w,1m,3m`), nilai return.
```json
{ "api_version": "1.0", "columns": ["1d","1w","1m","3m"],
  "rows": [ { "code": "IDXFINANCE", "name_id": "Keuangan", "values": { "1d": 0.002, "1w": 0.018, "1m": 0.041, "3m": 0.09 } } ] }
```

### `GET /api/v1/series/sector/{code}`
Seri untuk chart garis/area. Query: `from, to, timeframe, weighting`.
```json
{ "api_version": "1.0", "code": "IDXFINANCE",
  "points": [ { "date": "2026-10-08", "index_close": 104.31, "bench_close": 6031.28, "rs": 103.0, "turnover_idr": 950000000000 } ] }
```

### `GET /api/v1/series/stock/{ticker}`
Bahan **grafik candle + overlay analisa teknikal** di halaman detail saham (docs/06 §6.5). Semua overlay dihitung backend dari harga penyesuaian (`docs/03` §6.4.9 & §10) — frontend tidak menghitung satu pun indikator.
Query: `window` (default `6m`), `bars` (default `config.chart.window_bars`, maks 400), `ma` (daftar periode, default `config.ta.ma_periods`), `events` (default `config.chart.events`, maks 100), `weighting` (untuk rezim sektor saham), **`layers`** (daftar lapisan tambahan, default = `indicators`; nilai sah: `indicators` (Ultimate RSI + VWAP + POC), `smc`, `elliott`; kosong = hanya MA/Donchian/kanal/level/event).
```json
{ "api_version": "1.0", "ticker": "BBRI", "name": "Bank Rakyat Indonesia", "price_basis": "adj_close",
  "regime": "tren_naik", "active_tools": ["pullback_ma20", "volume"], "regime_reason": "Harga di atas penyangga 20 & 50 hari dan sektornya Memimpin — alat utama pantulan ke penyangga.",
  "candles": [ { "date": "2026-10-12", "open": 4188.0, "high": 4260.0, "low": 4170.0, "close": 4210.0, "volume": 91200000 } ],
  "overlays": {
    "ma": { "20": [ { "date": "2026-10-12", "value": 4088.4 } ], "50": [ { "date": "2026-10-12", "value": 3960.1 } ] },
    "donchian": { "fast": { "high": [ {"date":"2026-10-12","value":4360.0} ], "low": [ {"date":"2026-10-12","value":3910.0} ] },
                   "slow": { "high": [ … ], "low": [ … ] } },
    "channels": [ { "low": 3980.0, "high": 4020.0, "strength": 3, "kind": "support", "from": "2026-08-14", "to": null } ],
    "volume_ma": [ { "date": "2026-10-12", "value": 51200000 } ] },
  "levels": { "week_end": "2026-10-09", "entry_zone": { "low": 4088.0, "high": 4135.0 },
               "stop": 3991.0, "tp1": 4360.0, "tp2": 4580.0, "rr_tp2": 4.07, "plan_ok": true },
  "events": [ { "signal_date": "2026-10-06", "entry_date": "2026-10-07", "entry_price": 4012.5,
                 "result": "open", "periods": null, "mfe_pct": 0.049, "mae_pct": -0.011 } ],
  "volume_confirm_mult": 1.5,
  "layers": ["indicators"],
  "indicators": {
    "ursi": { "len": 14, "method": "sma", "ob": 70, "os": 30,
               "points": [ { "date": "2026-10-12", "value": 71.2, "signal": 68.4 } ] },
    "vwap": { "len": 20, "anchor": "rolling", "anchor_date": "2026-09-14",
               "points": [ { "date": "2026-10-12", "vwap": 4090.2, "upper1": 4210.5, "lower1": 3969.9, "upper2": 4330.8, "lower2": 3849.6 } ] },
    "poc": { "basis": "daily", "bars_used": 60, "bins": 24,
              "poc": 4060.0, "value_area": { "low": 3960.0, "high": 4180.0 } } },
  "smc": { "bos": [ { "date": "2026-09-30", "direction": "up", "level": 4320.0 } ],
            "choch": [ { "date": "2026-08-21", "direction": "down", "level": 3980.0 } ],
            "order_blocks": [ { "kind": "bullish", "from": "2026-09-12", "to": "2026-09-13", "low": 3995.0, "high": 4060.0, "mitigated": false } ],
            "fvg": [ { "kind": "bullish", "date": "2026-09-25", "low": 4110.0, "high": 4155.0, "mitigated": true } ],
            "equal_levels": [ { "kind": "high", "level": 4360.0, "count": 2 } ],
            "range": { "low": 3910.0, "high": 4360.0, "premium_from": 4135.0, "discount_to": 4135.0 } },
  "elliott": { "status": "candidate", "invalidated": false,
                "zigzag": [ { "date": "2026-06-02", "price": 3800.0, "kind": "low" } ],
                "waves": [ { "label": "1", "from": "2026-06-02", "to": "2026-07-14", "price_from": 3800.0, "price_to": 4300.0 } ],
                "fib_zones": [ { "ratio": 0.618, "level": 3990.0 } ],
                "note": "kandidat, bisa berubah saat bar baru masuk" },
  "data_status": { "...": "lihat konvensi" } }
```
Aturan:
- `candles` urut lama→baru, maks `bars`, dan **setiap** field memakai harga penyesuaian (ADR-040) — `open` sudah diskalakan ke kerangka `adj_close`.
- `overlays.ma` berkunci **periode sebagai string** (`"20"`); nilai `null` dibuang (warmup), bukan dikirim 0.
- `channels` **selalu** dikirim (data mentah untuk grafik), tetapi UI hanya menggambarnya saat `regime = range|tipis` (docs/03 §6.4.9) — jadi keputusan tampilan tetap di frontend, sedangkan angkanya di backend.
- `levels` = plan pick terakhir untuk ticker itu; `null` bila belum ada pick (UI menyembunyikan garis level, bukan error).
- `events` = baris `ta_breakout` (MA20, `trend_filter` sesuai config) untuk ticker itu, urut lama→baru; `mfe_pct`/`mae_pct` dari `docs/03` §10.9.
- `active_tools` + `regime_reason` dipakai legenda grafik: **overlay yang tampil harus cocok dengan rezim** (skill `idx-ta-trading-plan`) — VWAP/POC, SMC, Elliott **tidak** dikirim di v1.
- Ticker tanpa bar → `200` dengan `candles: []` (bukan 404); ticker tidak ada di `stock` → `404 not_found` (sama seperti `/stocks/{ticker}`).
- **Lapisan `layers` (v2, docs/03 §11)**: `indicators` selalu boleh; `smc` dan `elliott` **hanya** dikirim bila diminta eksplisit (`layers=indicators,smc,elliott`) — default mati karena keduanya lapisan konteks, bukan aturan plan. `poc.basis` wajib ikut (`daily` → UI menulis "perkiraan") + `bars_used`. `elliott.status` ∈ `candidate|invalidated`; pola yang batal tetap dikirim dengan `invalidated=true` (UI menggambar garis putus), dan `elliott.note` wajib memuat "kandidat, bisa berubah". Lapisan **tidak** mengubah `levels`/`regime`/`plan` — ada test yang memaksanya (`docs/03` §11.6 no. 9).

---

## 3. Weekly picks & briefing

### `GET /api/v1/weekly/picks`
Query: `week_end` (default minggu final terakhir), `scope` (default `sector,stock`), `sector` (multi), `min_streak` (default 1), `limit`.
```json
{ "api_version": "1.1", "week_end": "2026-10-09", "week_start": "2026-10-05", "week_label": "5–9 Okt 2026", "is_final": true,
  "sectors": [ { "ref_id": "IDXFINANCE", "name": "Keuangan", "rank": 1, "score": 87.4, "streak_weeks": 2,
                 "rule_hits": { "quadrant": "leading", "age_ok": true, "momentum_ok": true, "ret_4w_ok": true, "constituents_ok": true },
                 "rationale": "Keuangan masuk kuadran Memimpin 2 periode berturut-turut, momentum relatif masih naik." } ],
  "stocks": [ { "ticker": "BBRI", "name": "Bank Rakyat Indonesia", "sector_code": "IDXFINANCE",
                "rank": 1, "score": 92.1, "streak_weeks": 3,
                "entry_ref": 4250, "stop": 4132, "target": 4486, "atr14": 78.5, "lots_hint": 12,
                "rule_hits": { "liquidity_ok": true, "price_ok": true, "trend_ok": true, "rs_ok": true, "momentum_ok": true, "rsi_ok": true, "no_suspension": true },
                "rationale": "3 minggu berturut-turut masuk daftar; tren di atas SMA20/SMA50, RSI 62.",
                "plan": {
                  "regime": "tren_naik",
                  "entry_tool": "pullback_ma20", "entry_tool_reason": "Harga dekat penyangga 20 hari saat tren masih naik — beli di penyangga membuat batas rugi lebih dekat.",
                  "confirm_tool": "volume", "confirm_reason": "Volume bar terakhir 1,8 kali rata-rata 20 hari (minimal 1,5 kali).",
                  "entry_mode": "pullback",
                  "entry_zone": { "low": 4088.0, "high": 4135.0, "reason": "Zona di sekitar penyangga 20 hari (4.110); beli di penyangga membuat batas rugi lebih dekat." },
                  "stop": { "level": 3991.0, "pct": -0.0285, "basis": "struktur_swing_low", "reason": "Batas rugi di bawah titik terendah 10 hari (3.980) ditambah penyangga 0,5× volatilitas — di situ skenario naik batal." },
                  "tp1": { "level": 4360.0, "pct": 0.0625, "rr": 2.19, "basis": "resistance_20", "reason": "Puncak 20 hari terakhir adalah tempat penjual menumpuk — ambil sebagian di situ." },
                  "tp2": { "level": 4580.0, "pct": 0.1161, "rr": 4.07, "basis": "donchian_40", "reason": "Target terukur dari puncak 40 hari; R:R setelah biaya 0,40% masih 4,07:1." },
                  "hold": { "median_periods": 7, "n_events": 29, "win_rate": 0.34, "hit_tp1": 0.62, "hit_tp2": 0.34,
                            "reason": "Dari 29 breakout terakhir: median 7 bar sampai +5%, +6,3% historis kena 62%." },
                  "invalidation": "Batal bila tutup harian di bawah penyangga 20 hari (4.110) atau batas rugi 3.991; IHSG tutup di bawah 5.780 → tunda entry baru.",
                  "plan_ok": true, "notes": [] } } ] }
```
Aturan baru (`api_version` **1.2**, aditif — klien lama tetap jalan):
- `plan` menggantikan peran `stop`/`target` sebagai **sumber kebenaran plan**; `stop`, `target`, `entry_ref`, `lots_hint` tetap dikirim untuk kompatibilitas (`target` = `plan.tp2.level`).
- `plan.regime` ∈ `tren_naik|range|turun|tipis` dan `plan.entry_tool` ∈ `pullback_ma20|breakout_donchian|sr_channel|pivot_level|none` — **wajib** ikut supaya UI bisa menjelaskan *kenapa* plan-nya begitu (docs/03 §6.4.0). `confirm_tool` maksimum satu nilai (`volume|rsi_tepi_range|none`).
- `rr` pada `tp1`/`tp2` sudah **bersih biaya** (`weekly.plan.fee_*`). Jangan menghitung ulang di frontend.
- `hit_tp1`/`hit_tp2` = peluang historis dari MFE event TA (`docs/03` §10.9); `null` bila jumlah event < `weekly.plan.min_events_hold` (UI menampilkan "belum cukup riwayat").
- `plan_ok=false` (mis. R:R < 3:1 atau stop > 8%) → pick **tetap dikirim** dengan `notes[]` berisi alasan; UI menandainya, bukan menyembunyikannya.
- `entry_mode=no_trade` (rezim `turun`) → semua level `null`, `plan_ok=false`, `notes` menyebut alasannya.
- Setiap `reason` ≤ 140 char, Bahasa Indonesia, tanpa istilah mentah (`RSI`, `SMA20`, `R:R`, `ATR` tidak boleh muncul di kalimat user).

### `GET /api/v1/briefing/morning` ← **endpoint untuk Hermes**
Satu panggilan, semua yang dibutuhkan untuk report pagi. Query: `as_of` (opsional), `include_series=false` (default), `top_n=3`.
```json
{ "api_version": "1.0",
  "generated_at": "2026-10-13T06:30:00+07:00",
  "data_status": { "...": "lihat konvensi" },
  "market": { "ihsg_close": 5936.15, "ihsg_ret_1d": -0.0259, "ihsg_ret_1w": -0.0204,
              "sectors_up": 2, "sectors_down": 9, "breadth": { "advancers": 120, "decliners": 380, "unchanged": 45 },
              "regime": "risk_off", "regime_note": "9 dari 11 sektor turun; uang keluar dari siklikal." },
  "leaders": [ { "code": "IDXFINANCE", "name_id": "Keuangan", "quadrant": "leading", "score": 87.4, "ret_1w": 0.018, "streak_weeks": 2 } ],
  "laggards": [ { "code": "IDXENERGY", "name_id": "Energi", "quadrant": "lagging", "score": 12.1, "ret_1w": -0.043, "streak_weeks": 0 } ],
  "changes": [ { "ref_id": "IDXINFRA", "name": "Infrastruktur", "from": "lagging", "to": "improving", "as_of": "2026-10-09" } ],
  "weekly_focus": { "week_end": "2026-10-09",
                    "sectors": [ { "code": "IDXFINANCE", "streak_weeks": 2, "rationale": "..." } ],
                    "stocks":  [ { "ticker": "BBRI", "entry_ref": 4250, "stop": 4132, "target": 4486, "streak_weeks": 3, "rationale": "..." } ] },
  "midday": { "available": true, "as_of": "2026-10-13", "gate": "ok",
              "moves": [ { "code": "IDXFINANCE", "ret_intraday": 0.006, "direction": "naik", "projected_quadrant": "leading" } ] },
  "watch": [ { "level": "warning", "message": "Data intraday Yahoo belum sampai 11:30 WIB; angka midday = penutupan sebelumnya." } ],
  "notes_for_report": "Susun 5–8 paragraf: kondisi pasar, sektor kuat/lemah, perubahan kuadran, fokus mingguan (sebut streak), risiko & catatan data.",
  "summary_lines": [
    "IHSG turun 0,45% hari ini; 9 dari 11 sektor ikut turun — pasar sedang menghindari risiko.",
    "Yang masih naik: Keuangan (+1,8%) dan Kesehatan (+0,9%). Turun paling dalam: Energi (−4,3%).",
    "Berpindah kuadran: Infrastruktur dari Tertinggal ke Membaik.",
    "Perhatikan minggu depan: Keuangan (Memimpin 2 minggu berturut-turut) — BRI (3 minggu masuk daftar, entry 4.250, stop 4.132)."
  ],
  "watchlist": [
    { "kind": "sector", "ref_id": "IDXFINANCE", "name": "Keuangan", "quadrant": "leading",
      "streak_weeks": 2, "reason": "Memimpin 2 minggu berturut-turut, kekuatan relatif masih naik." },
    { "kind": "stock", "ref_id": "BBRI", "name": "Bank Rakyat Indonesia", "quadrant": "leading",
      "streak_weeks": 3, "reason": "3 minggu berturut-turut masuk daftar; tren di atas rata-rata 20 & 50 hari, harga masih wajar." }
  ] }
```

**`summary_lines`** (ringkasan singkat untuk panel Ringkasan Pasar):
- 3–6 kalimat, masing-masing **≤ 140 karakter**, Bahasa Indonesia, angka sudah diformat Indonesia (`1,8%`, `4.250`).
- **Tanpa istilah teknis**: jangan tulis "RS-Ratio"/"kuadran improving" mentah — pakai "kekuatan relatif", "Membaik/Memimpin", dst.
- Susunan baku: (1) kondisi pasar hari ini + regime → (2) sektor naik & turun teratas (angka) → (3) perubahan kuadran yang terjadi → (4) fokus mingguan + streak → (5) catatan data/peringatan (sektor tipis, data stale, tengah hari belum ada).
- Kalimat (3)/(4)/(5) **dilewati** kalau tidak ada isinya. Minimal 1 kalimat selama ada hasil hitung; kalau belum ada hasil hitung → `[]` dan UI menampilkan "belum ada hasil hitung".
- **Disusun backend dengan template + angka yang sudah ada — TIDAK memakai LLM.** Frontend hanya menampilkan; tidak menyusun kalimat finansial sendiri.

**`watchlist`** (sektor/saham yang menarik dipantau):
- Maks **3 item**. Sumber: kandidat `signal_weekly` terakhir (sektor dulu, lalu saham), urut `score` menurun.
- `reason` = **1 kalimat** (≤ 140 karakter), menyebut alasan konkret: streak, perubahan kuadran, atau level harga (`entry`/`stop`).
- Kalau tidak ada kandidat (belum Jumat / belum ada sinyal) → `[]`; UI menyembunyikan blok ini, jangan tampilkan blok kosong.
- `streak_weeks` dan `quadrant` dipakai UI untuk badge.

**Simpan juga ke DB** sebagai bagian briefing? Tidak — dihitung ulang saat endpoint dipanggil (`summary_lines` dan `watchlist` murni turunan, murah). Jangan menambah tabel.

Aturan: `briefing/morning` **wajib tetap mengembalikan 200** walau data stale/partial — kesegaran dilaporkan di `data_status` dan `watch`, bukan lewat kode error. Ini yang membuat report pagi tidak pernah gagal total.

---

## 4. Admin / jobs — dipicu dari UI (dan dari Hermes/CLI)

Endpoint ini **dipakai halaman Data di frontend** (lihat `docs/08` F12), juga oleh Hermes dan CLI. CLI (`backend/cli.py`) dan API **wajib memanggil fungsi Python yang sama** — jangan ada logika ingest/compute yang cuma hidup di CLI atau cuma di API.

**Semua endpoint tulis di bawah WAJIB mendukung pola async** (ingest 962 emiten makan ~95 detik; UI tidak boleh nge-block):
```
POST ...?async=true  →  202 { "run_id": 12, "status": "queued" }     # default untuk semua tombol di UI
POST ...             →  200 menunggu selesai (timeout 300s)          # dipakai CLI/curl/Hermes
```
Progres dibaca dari `GET /api/v1/admin/runs/{run_id}` (§4.3) — dipoll UI tiap 1 s, atau SSE opsional (§4.4).

| Endpoint | Body / query | Response ringkas |
|---|---|---|
| `POST /api/v1/admin/import/excel` | multipart `file`, `?force=false&strict=false` | `{ "import_id": 3, "inserted": 612, "updated": 12, "deactivated": 4, "errors": [ {"sheet":"IDXFINANCE","row_no":18,"raw_value":"BCA","reason":"invalid_ticker"} ] }` |
| `POST /api/v1/admin/ingest/prices` | `{ "mode": "daily" \| "intraday", "from": "2024-10-01", "to": null, "sectors": null, "tickers": null }` | `{ "run_id": 9, "rows": 148210, "failed_tickers": ["XXXX"] }` |
| `POST /api/v1/admin/compute` | `{ "stage": "index" \| "rrg" \| "signals" \| "all", "timeframe": "d1", "as_of": null }` | `{ "run_id": 10, "sectors": 11, "tickers": 612, "duration_s": 42.1 }` |
| `POST /api/v1/admin/midday` | `{}` | `{ "gate": "ok", "last_bar_at": "...", "computed": true }` atau `{ "gate": "stale", "last_bar_at": "...", "computed": false }` |
| `GET /api/v1/admin/runs?limit=20` | — | daftar `ingest_run` (untuk halaman status) |
### 4.1 Pipeline yang bisa dipicu user dari UI (urut, tombol per tombol)

| Tombol UI | Endpoint | Isi | Estimasi durasi |
|---|---|---|---|
| **1. Import sektor (Excel)** | `POST /api/v1/admin/import/excel?async=true` (multipart `file`) | pilih file `saham_sektoral.xlsx` dari komputer | 1–3 s |
| **2. Ambil harga harian** | `POST /api/v1/admin/ingest/prices?async=true` `{"mode":"daily","from":"2024-10-14"}` | backfill/update semua emiten aktif | ~1,5 menit (sekali), ~10 s harian |
| **3. Ambil harga intraday** | `POST /api/v1/admin/ingest/prices?async=true` `{"mode":"intraday"}` | bar 5m/60m hari ini | ~30 s |
| **4. Hitung semua** | `POST /api/v1/admin/compute?async=true` `{"stage":"all","timeframe":"d1"}` | indeks → RRG → metrik → sinyal | ~30–60 s |
| **5. Hitung mingguan** | `POST /api/v1/admin/compute?async=true` `{"stage":"signals","timeframe":"w1_fri"}` | sinyal + streak | ~10 s |
| **6. Tengah hari** | `POST /api/v1/admin/midday?async=true` | gate kesegaran + hitung ulang intraday | ~40 s |
| **7. Hitung analisa teknikal (MA & backtest)** | `POST /api/v1/admin/compute?async=true` `{"stage":"ta"}` | SMA 10/20/50 + deteksi breakout + hasil ±5% (2 varian filter) | ~60–120 s (922 emiten × 3 MA × 2 varian) |
| **8. Refresh data tampilan** | (tidak ada endpoint baru) | frontend invalidate cache TanStack Query | — |

Aturan: tombol 2–6 **terkunci (disabled) sampai prasyaratnya terpenuhi**, dan backend **juga** menolak dengan `409` kalau dipaksa (jangan cuma mengandalkan UI):
- tombol 2 butuh tabel `stock` terisi (`SELECT COUNT(*) FROM stock WHERE is_active=1 > 0`);
- tombol 4/5 butuh `price_daily` terisi untuk sebagian besar emiten aktif (tombol 7 memakai prasyarat yang sama: `prereq_no_prices`);
- `stage=all` (tombol 4) **ikut** menghitung analisa teknikal — user tidak boleh harus ingat klik tombol 7 setelah ambil harga baru;
- tombol 5 (`w1_fri`) hanya jalan setelah penutupan Jumat (kalau dipaksa di hari lain → `409 gate_weekly_not_final`);
- tombol 6 mengikuti gate kesegaran `docs/02 §5` (kalau gagal → `200` dengan `{"gate":"stale", "computed":false}`, bukan error).
Respons `409` memuat `error.code` yang spesifik: `prereq_no_universe`, `prereq_no_prices`, `gate_weekly_not_final`, `gate_midday_stale`.

### 4.2 Konfirmasi wajib di UI

Sebelum menjalankan **tombol 2** (ingest harga) pertama kali, UI menampilkan dialog konfirmasi yang menyebut jumlah emiten aktif + perkiraan durasi. Alasannya: itu satu-satunya operasi berat (≈1,5 menit, ratusan request ke Yahoo). Tombol lain tidak perlu konfirmasi.

### 4.3 Status & progres run

`GET /api/v1/admin/runs/{run_id}`
```json
{ "api_version": "1.0",
  "run": { "run_id": 9, "kind": "prices_daily", "status": "running",
           "started_at": "2026-10-13T07:02:11+07:00", "finished_at": null,
           "phase": "ingest", "rows": 184320, "rows_total": 455026, "percent": 40.5,
           "message": "batch 9/20 (emiten 401–450)", "failed_tickers": ["MAP"] } }
```
`status`: `queued | running | ok | partial | failed | skipped`. Kalau `running`, `percent` wajib > 0 dalam 5 detik pertama (UI menampilkan progress bar; kalau `rows_total` belum diketahui → kirim `percent: null` dan UI pakai spinner + `message`).

`GET /api/v1/admin/runs?limit=20` → 20 run terakhir (kolom sama), untuk halaman Status.

### 4.4 (opsional, kalau cepat) Server-Sent Events

`GET /api/v1/admin/runs/{run_id}/events` → stream `text/event-stream` berisi baris progres. Boleh dilewati di v1; **polling 1 s sudah cukup**. Jangan bangun SSE sebelum polling-nya jalan.

### 4.5 Backup & keamanan

| Endpoint | Body / query | Response ringkas |
|---|---|---|
| `GET /api/v1/admin/export/backup` | — | unduhan `rotation.db` (streaming) |

Opsional (kalau `config.api.api_key` diisi): header `X-API-Key` wajib untuk semua `/admin/*`. Karena sekarang UI ikut memanggil `/admin/*`, kalau `api_key` diisi maka frontend membacanya dari `localStorage` (diisi manual oleh user sekali) — **jangan** taruh kunci di kode frontend atau di `VITE_*` env.

---

### 4.6 Bentuk yang baku (jangan ditawar lagi)

**Nama `run.kind`** — hanya enam nilai ini, persis (dipakai UI untuk chip status & prasyarat tombol; beda satu huruf = tombol selalu "belum pernah"):

```
import_excel | prices_daily | prices_intraday | compute_all | compute_signals | compute_ta | midday
```
`compute_index` dan `compute_rrg` **bukan** kind yang berdiri sendiri: keduanya bagian dari `compute_all` (stage `index|rrg|all` tetap diterima sebagai parameter, tapi `kind` yang tersimpan = `compute_all`). Kolom `kind` di `ingest_run` (`docs/04` §4) memakai daftar yang sama.

**Amplop daftar run** — `GET /api/v1/admin/runs`:
```json
{ "api_version": "1.1", "runs": [ { "run_id": 9, "kind": "prices_daily", "status": "ok", "started_at": "...", "finished_at": "...", "rows": 455026, "rows_total": 455026, "percent": 100.0, "phase": null, "message": "selesai", "failed_tickers": ["MAP"] } ] }
```
Kuncinya **`runs`**, bukan `items`. `GET /admin/runs/{run_id}` tetap memakai `{ "run": {...} }` (§4.3).

**Bentuk `result_json` per kind** (dipakai panel riwayat di halaman Data):

| kind | `result_json` |
|---|---|
| `import_excel` | `{ "import_id": 3, "inserted": 962, "updated": 0, "deactivated": 0, "errors": [ {"sheet":"IDXFINANCE","row_no":18,"raw_value":"BCA","reason":"invalid_ticker"} ] }` |
| `prices_daily` / `prices_intraday` | `{ "rows": 148210, "batches": 20, "failed_tickers": ["MAP"] }` |
| `compute_ta` | `{ "events": 8421, "refs": 916, "ma_periods": [10, 20, 50], "variants": ["filter_off", "filter_on"], "win_rate": 0.58, "duration_s": 84.2 }` |
| `compute_all` | `{ "timeframe": "d1", "sectors": 11, "tickers": 962, "duration_s": 42.1 }` |
| `compute_signals` | `{ "week_end": "2026-10-09", "sectors": 3, "stocks": 7 }` |
| `midday` | `{ "gate": "ok", "last_bar_at": "2026-10-13T11:35:00+07:00", "computed": true }` |

## 5. Kontrak untuk frontend

1. Frontend memanggil §1–§3 untuk **membaca**, dan **§4 untuk memicu pipeline** (halaman Data). Halaman lain tidak memanggil `/admin/*`.
   - Mutasi admin selalu dikirim sebagai `POST ...?async=true` → dapat `run_id` → poll `GET /admin/runs/{run_id}` tiap 1 s → saat `status` jadi `ok|partial|failed|skipped`, `invalidateQueries` untuk data terkait (`rrg`, `sectorSummary`, `stocks`, `freshness`, `runs`).
   - Tombol pipeline harus punya state jelas: `idle → mengirim → jalan (progress %) → selesai/gagal`, plus toast hasil dan tombol "Coba lagi" saat gagal. Jangan biarkan tombol tampak selesai padahal run-nya gagal.
2. Semua filter disimpan di **URL query** (shareable): `?timeframe=w1_fri&window=3m&quadrant=leading,improving&min_streak=2&sort=score`.
3. Frontend tidak menghitung rumus apa pun (termasuk kuadran). Semua angka dari API.
4. Frontend tidak memformat ulang angka menjadi string lain dari yang diberikan; hanya menambahkan pemisah ribuan & satuan ringkas (docs/03 §8).
5. Saat `data_status.status != "ok"` atau `partial_sectors` tidak kosong → tampilkan pill peringatan di header tabel dan tooltip penjelasan.
6. Respons API dipakai langsung; **tanpa** adapter yang mengubah nama field. Kalau field kurang, minta ke backend (catat di `DECISIONS.md`) — jangan menghitung sendiri.

## 6. Versioning

Naikkan `api_version` ke `1.1` bila menambah field (aman). Naikkan ke `2.0` + catat di `DECISIONS.md` bila menghapus/mengganti nama field atau mengubah tipe. Backend boleh menambah field baru tanpa memberi tahu frontend; frontend wajib mengabaikan field yang tidak dikenal.
