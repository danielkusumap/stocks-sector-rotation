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
  "partial_sectors": []           // kode sektor dengan constituents_count < 3
}
```

Parameter umum (dipakai banyak endpoint):
`timeframe` = `d1|w1|w1_fri|midday` (default `d1`) · `as_of` = tanggal acuan (default: tanggal terakhir yang ada) · `window` = `1w|1m|3m|6m|1y|ytd` (default `3m`, hanya panjang ekor & kolom return) · `weighting` = `equal|turnover|captier` (default dari config) · `sector` = kode sektor, boleh diulang · `format` = `json` (default).

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
  "rrg": { "ema_span": 14, "roc_lag": 10, "weekly": { "ema_span": 14, "roc_lag": 4 }, "min_points": 60 },
  "timeframes": ["d1", "w1", "w1_fri", "midday"],
  "windows": ["1w", "1m", "3m", "6m", "1y", "ytd"],
  "midday_gate_min_bar_time": "11:30",
  "last_ingest": { "prices_daily": "2026-10-12T16:31:02+07:00", "intraday": "2026-10-12T16:31:40+07:00",
                   "signals_weekly": "2026-10-09T17:02:11+07:00" } }
```

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
{ "api_version": "1.0",
  "timeframe": "w1_fri", "as_of": "2026-10-09", "window": "3m", "weighting": "equal",
  "quadrants": { "leading": 3, "weakening": 2, "lagging": 3, "improving": 3 },
  "items": [
    { "ref_id": "IDXFINANCE", "name": "Keuangan", "color_hex": "#3B82F6",
      "rs_ratio": 102.31, "rs_momentum": 100.84,
      "quadrant": "leading", "quadrant_prev": "improving", "transition": "improving→leading",
      "quadrant_age_periods": 2, "score": 87.4, "rank_score": 1,
      "ret_1w": 0.0181, "median_turnover_20d_idr": 1180000000000,
      "tail": [ { "as_of": "2026-09-25", "rs_ratio": 99.4, "rs_momentum": 99.1 }, { "as_of": "2026-10-02", "rs_ratio": 100.2, "rs_momentum": 100.6 },
                { "as_of": "2026-10-09", "rs_ratio": 102.31, "rs_momentum": 100.84 } ] }
  ],
  "data_status": { "...": "lihat konvensi" } }
```
Aturan: `tail` urut lama→baru, panjang ≤ `tail_points`, sudah dibatasi `min_points` (titik warmup dibuang). Titik terakhir **selalu** sama dengan `rs_ratio`/`rs_momentum` di atas.

### `GET /api/v1/sectors/summary`
Baris tabel di bawah diagram — inilah tabel yang difilter user. Query filter (semua opsional, semua dikerjakan di SQL):
`sector` (multi), `quadrant` (multi: `leading,weakening,lagging,improving`), `transition` (mis. `improving→leading`), `min_streak` (int), `min_turnover_idr`, `only_partial` (bool), `sort` = `score|rs_ratio|rs_momentum|ret_1w|ret_1m|turnover|rank_score` (default `score`), `dir` = `desc|asc`, `limit`, `offset`, plus `timeframe/as_of/window/weighting`.
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
Tabel semua saham (halaman "Saham"). Query: `timeframe, as_of, sector` (multi), `quadrant` (multi), `q` (cari ticker/nama, min 1 char), `min_turnover_idr`, `min_price_idr`, `sort` = `stock_score|rs_ratio|ret_1d|ret_1w|turnover|ticker` (default `stock_score`), `dir`, `limit` (default 50, maks 500), `offset`.
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

---

## 3. Weekly picks & briefing

### `GET /api/v1/weekly/picks`
Query: `week_end` (default minggu final terakhir), `scope` (default `sector,stock`), `sector` (multi), `min_streak` (default 1), `limit`.
```json
{ "api_version": "1.0", "week_end": "2026-10-09", "is_final": true,
  "sectors": [ { "ref_id": "IDXFINANCE", "name": "Keuangan", "rank": 1, "score": 87.4, "streak_weeks": 2,
                 "rule_hits": { "quadrant": "leading", "age_ok": true, "momentum_ok": true, "ret_4w_ok": true, "constituents_ok": true },
                 "rationale": "Keuangan masuk kuadran Memimpin 2 periode berturut-turut, momentum relatif masih naik." } ],
  "stocks": [ { "ticker": "BBRI", "name": "Bank Rakyat Indonesia", "sector_code": "IDXFINANCE",
                "rank": 1, "score": 92.1, "streak_weeks": 3,
                "entry_ref": 4250, "stop": 4132, "target": 4486, "atr14": 78.5, "lots_hint": 12,
                "rule_hits": { "liquidity_ok": true, "price_ok": true, "trend_ok": true, "rs_ok": true, "momentum_ok": true, "rsi_ok": true, "no_suspension": true },
                "rationale": "3 minggu berturut-turut masuk daftar; tren di atas SMA20/SMA50, RSI 62." } ] }
```

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
  "notes_for_report": "Susun 5–8 paragraf: kondisi pasar, sektor kuat/lemah, perubahan kuadran, fokus mingguan (sebut streak), risiko & catatan data."
}
```
Aturan: `briefing/morning` **wajib tetap mengembalikan 200** walau data stale/partial — kesegaran dilaporkan di `data_status` dan `watch`, bukan lewat kode error. Ini yang membuat report pagi tidak pernah gagal total.

---

## 4. Admin / jobs (dipakai user & Hermes, bukan frontend)

Semua endpoint POST di bawah menerima `?async=true` → mengembalikan `202` + `{"run_id": 12, "status": "running"}` (progres dilihat di `GET /api/v1/admin/runs`). Tanpa `async`, request menunggu selesai (timeout 300 s).

| Endpoint | Body / query | Response ringkas |
|---|---|---|
| `POST /api/v1/admin/import/excel` | multipart `file`, `?force=false&strict=false` | `{ "import_id": 3, "inserted": 612, "updated": 12, "deactivated": 4, "errors": [ {"sheet":"IDXFINANCE","row_no":18,"raw_value":"BCA","reason":"invalid_ticker"} ] }` |
| `POST /api/v1/admin/ingest/prices` | `{ "mode": "daily" \| "intraday", "from": "2024-10-01", "to": null, "sectors": null, "tickers": null }` | `{ "run_id": 9, "rows": 148210, "failed_tickers": ["XXXX"] }` |
| `POST /api/v1/admin/compute` | `{ "stage": "index" \| "rrg" \| "signals" \| "all", "timeframe": "d1", "as_of": null }` | `{ "run_id": 10, "sectors": 11, "tickers": 612, "duration_s": 42.1 }` |
| `POST /api/v1/admin/midday` | `{}` | `{ "gate": "ok", "last_bar_at": "...", "computed": true }` atau `{ "gate": "stale", "last_bar_at": "...", "computed": false }` |
| `GET /api/v1/admin/runs?limit=20` | — | daftar `ingest_run` (untuk halaman status) |
| `GET /api/v1/admin/export/backup` | — | unduhan `rotation.db` (streaming) |

Opsional (kalau `config.api.api_key` diisi): header `X-API-Key` wajib untuk semua `/admin/*`. Frontend **tidak** memanggil `/admin/*` di v1 (import & ingest dijalankan user/Hermes via curl atau CLI).

---

## 5. Kontrak untuk frontend

1. Frontend **hanya** memanggil endpoint di §1–§3. Tidak ada `/admin/*`.
2. Semua filter disimpan di **URL query** (shareable): `?timeframe=w1_fri&window=3m&quadrant=leading,improving&min_streak=2&sort=score`.
3. Frontend tidak menghitung rumus apa pun (termasuk kuadran). Semua angka dari API.
4. Frontend tidak memformat ulang angka menjadi string lain dari yang diberikan; hanya menambahkan pemisah ribuan & satuan ringkas (docs/03 §8).
5. Saat `data_status.status != "ok"` atau `partial_sectors` tidak kosong → tampilkan pill peringatan di header tabel dan tooltip penjelasan.
6. Respons API dipakai langsung; **tanpa** adapter yang mengubah nama field. Kalau field kurang, minta ke backend (catat di `DECISIONS.md`) — jangan menghitung sendiri.

## 6. Versioning

Naikkan `api_version` ke `1.1` bila menambah field (aman). Naikkan ke `2.0` + catat di `DECISIONS.md` bila menghapus/mengganti nama field atau mengubah tipe. Backend boleh menambah field baru tanpa memberi tahu frontend; frontend wajib mengabaikan field yang tidak dikenal.
