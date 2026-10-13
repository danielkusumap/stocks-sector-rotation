# B17 — analisa teknikal & backtest MA: bukti run nyata

Lingkungan (bukan `data/rotation.db` user):

- config salinan: `E:/rotation-b17-test/config.yaml` (digenerate ulang dari `config/default.yaml`, blok `ta` ikut)
- DB uji: `E:/rotation-b17-test/rotation.db` — `VACUUM INTO` dari `data/rotation.db`, lalu
  `UPDATE stock SET is_active = 0` untuk semua di luar 15 emiten uji (**tidak ada ingest/backfill**)
- emiten aktif: **15** — IDXFINANCE 5 (BBCA, BBRI, BMRI, BBNI, BNGA) · IDXENERGY 5 (PTBA, ADRO, MEDC, ITMG, PGAS) ·
  IDXINFRA 4 (TLKM, EXCL, TOWR, JSMR) · IDXBASIC 1 (ANTM); BBRI 473 bar `2024-10-14 … 2026-10-13`
- server: `uvicorn backend.app.main:app --port 8100` dengan `ROTATION_CONFIG` ke config salinan
- `python -m backend.cli db-init` (DB asli): `{"tables": 14, "user_version": 4}` — migrasi `004_ta_breakout.sql` jalan

## 1. Test

```
.venv/Scripts/python.exe -m pytest -q backend
176 passed, 1 warning in 76.48s
```

`backend/tests/test_b17_ta.py` (14 test) memuat nama wajib `docs/03` §10.8:
`test_ma_warmup` · `test_breakout_sekali_per_transisi` · `test_entry_pakai_bar_d_plus_1` · `test_win_loss_same_bar` ·
`test_expired_timeout` · `test_open_horizon_belum_selesai` · `test_median_bukan_mean` · `test_trend_filter_mengurangi_event`
· `test_ta_recompute_idempoten`, plus kontrak endpoint, 400/409, `stage=ta` lewat HTTP, dan `stage=all` menyertakan TA.

## 2. `POST /api/v1/admin/compute?async=true {"stage":"ta"}` (AC 8)

```
HTTP 202 {"api_version": "1.0", "run_id": 43, "status": "queued"}
polling 10x: [{"status":"queued","phase":null,"rows":0,"percent":null,"message":null},
              {"status":"running","phase":null,"rows":0,"percent":null,"message":null}]
          … {"status":"ok","phase":"compute_ta","rows":3144,"percent":100.0,"message":"26/26 entitas · 3144 event"}
result_json: {"stage":"ta","timeframe":"d1","sectors":11,"tickers":15,"ta_rows":3144,"ta_refs":26,
              "events":3144,"refs":26,"ma_periods":[10,20,50],"variants":["filter_off","filter_on"],
              "win_rate":0.5148,"rows":3144,"duration_s":0.25}
```

## 3. `{"stage":"all"}` menyertakan TA (AC 9) + potongan `ingest_run`

```
POST /admin/compute?async=true {"stage":"all"} -> 202 run_id 44
polling 780x … {"status":"ok","phase":"compute_ta","rows":58427,"percent":100.0,"message":"26/26 entitas · 3144 event"}
result_json: {"stage":"all",…,"ta_rows":3144,"ta_refs":26,"rows":58427,"duration_s":66.57}

ingest_run #44 kind=compute_all status=ok rows=58427 percent=100.0
ingest_run #43 kind=compute_ta  status=ok rows=3144  percent=100.0
ingest_run #42 kind=compute_all status=ok rows=58427 percent=100.0
ingest_run #41 kind=compute_ta  status=ok rows=2978  percent=100.0   ← sebelum perbaikan entry open (ADR-040)
ingest_run #40 kind=compute_all status=ok rows=502180 percent=100.0
ingest_run #39 kind=compute_all status=failed rows=0     percent=None
```

## 4. Dump endpoint (`ta_*.json` di folder ini)

`/ta/summary?scope=stock&ma_period=20&trend_filter=false` → `total 15`, `coverage {refs_tested 15, refs_skipped_short_history 0, bars_from 2024-10-14, bars_to 2026-10-13, price_basis adj_close}`;
baris BBRI: `close 3080 · ma 3173 · above_ma false · n_events 29 · win 10 · loss 19 · expired 0 · open 0 · win_rate 0.3448 ·
median_periods_win 7 · median_periods_loss 7 · last_breakout {signal 2026-02-20, entry 2026-02-23, entry_price 3644.27,
entry_basis open, periods_since 150, gain_since −0.1548, result loss, exit_date 2026-03-06, exit_price 3447.03, periods 9}`.

`/ta/stock/BBRI?ma_period=20` → `stats.filter_on {n_events 7, win 2, loss 5, expired 0, open 0, win_rate 0.2857,
median_periods_win 10.5, median_periods_loss 12.0}` · `stats.filter_off {n_events 29, win 10, loss 19, win_rate 0.3448,
median_periods_win 7.0, median_periods_loss 7.0}` · `ma_series` berakhir `2026-10-13 close 3080 ma 3173` (bar warmup dibuang).

`/ta/sector/IDXFINANCE?ma_period=20` → `stats.filter_on {n_events 18, win 8, loss 9, expired 1, win_rate 0.4706,
median_periods_win 20.5, median_periods_loss 12.0}` · `filter_off {n_events 45, win 18, loss 26, expired 1, win_rate 0.4091}`;
`/ta/summary?scope=sector&ma_period=20&trend_filter=false` → 11 sektor.

## 5. `400` dan `409`

```
GET /api/v1/ta/summary?scope=stock&ma_period=7 -> HTTP 400
{"api_version":"1.0","error":{"code":"invalid_ma_period","message":"ma_period harus salah satu dari: 10, 20, 50",
 "detail":{"received":7,"allowed":[10,20,50]}}}

# server :8101 dengan config salinan ke DB kosong (db-init saja, tanpa harga)
GET /api/v1/ta/summary?scope=stock -> HTTP 409
{"api_version":"1.0","error":{"code":"prereq_no_prices","message":"belum ada bar harga — jalankan 'Ambil harga harian' dulu","detail":{}}}
GET /api/v1/ta/stock/BBRI   -> HTTP 404 {"error":{"code":"not_found","message":"stock BBRI tidak ada",…}}
GET /api/v1/ta/stock/EXCL?ma_period=20 -> HTTP 200 (BBRI-tanpa-event: `latest: null`, `events: []`, `n_events 0`)
```

## 6. Replay manual satu event (`REPLAY.txt`)

BBRI, `ma_period=20`, `trend_filter=0`, sinyal **2025-09-03**:

```
MA20 2025-09-02 close 3584.6030  ma20 3623.5269     → close <= MA  (syarat "sebelumnya di bawah")
MA20 2025-09-03 close 3647.9673  ma20 3636.6523     → close >  MA  (transisi → 1 event)
entry D+1 2025-09-04: open_mentah 3980, close 4000, adj_close 3620.8113 → entry_price 3602.7072 (open × adj_close / close)
telusuri maju: +1 bar 3530.2910 (−2,01%) · +2 3430.7188 (−4,77%) · +3 3512.1870 (−2,51%) · +4 3693.2275 (+2,51%) ·
               +5 3783.7478 (+5,03%)  ← kena target 5% → win, exit_date 2025-09-12, periods 5
baris tersimpan: result=win exit_date=2025-09-12 exit_price=3783.7478 periods=5  ← identik
```

Statistik SQL untuk entitas yang sama: `trend_filter=0 → n_events 29, win 10, loss 19, win_rate 0.3448`;
`trend_filter=1 → n_events 7, win 2, loss 5, win_rate 0.2857` — sama dengan respons `/ta/stock/BBRI`.

## 7. Temuan nyata saat run (→ ADR-040)

`price_daily.open` **mentah** (`auto_adjust=False`, docs/02 §1) sedangkan semua harga TA `adj_close`. Versi pertama
memakai `open` mentah sebagai harga entry → entry seolah langsung −5% dan seluruh 7 event BBRI (`filter_on`) tercatat
`loss` `periods 0`:

```
sebelum: BBRI filter_on {n_events 7, win 0, loss 7, median_periods_loss 0.0} · stage=ta win_rate 0.3072
sesudah: BBRI filter_on {n_events 7, win 2, loss 5, median_periods_win 10.5} · stage=ta win_rate 0.5148
```

## 8. Berkas di folder ini

| Berkas | Isi |
|---|---|
| `RUN-LOG.txt` | log mentah `_run_evidence.py` (HTTP + polling + result_json + ingest_run) |
| `ta_summary_stock_ma20.json` | `/ta/summary?scope=stock&ma_period=20&trend_filter=false` |
| `ta_summary_sector_ma20.json` | `/ta/summary?scope=sector&ma_period=20&trend_filter=false` |
| `ta_stock_BBRI_ma20.json` | `/ta/stock/BBRI?ma_period=20` |
| `ta_sector_IDXFINANCE_ma20.json` | `/ta/sector/IDXFINANCE?ma_period=20` |
| `admin_runs.json` | `GET /admin/runs?limit=6` |
| `REPLAY.txt` | replay manual + SQL mentah (bagian 6) |
| `_run_evidence.py`, `_replay.py` | skrip yang menghasilkan berkas di atas (jalankan ulang untuk repro) |
