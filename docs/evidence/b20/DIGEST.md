# B19–B22 — bukti run nyata (config salinan + DB di luar repo, tanpa backfill)

Lingkungan: `ROTATION_CONFIG=E:/rotation-b18-test/config.yaml`, DB `E:/rotation-b18-test/rotation.db`
(962 emiten aktif), `user_version` 7 setelah migrasi 007.

## 1. Sapu semua error sekali jalan (`docs/evidence/SWEEP-ERRORS.txt`)

`plan_for_all` dijalankan **per emiten** (jalur kode asli, `ACTIVE_STOCKS_SQL` ditukar ke satu ticker) di dalam
`try/except`, lalu sampel endpoint 40 ticker × 4 varian + kasus tepi:

```
… 200/962 emiten, gagal 0 · … 962 ok, 0 gagal, 32.0 s
(tanpa kegagalan)
RINGKASAN: {"emiten": 962, "kegagalan": 0}
```

Kasus tepi yang ikut disapu: `layers=` (kosong), `bars=400` + `indicators,smc,elliott`, ticker tak ada (`404`),
`bars=500` / `events=200` / `layers=foo` (`422`) → semua sesuai kontrak.

## 2. `plan_for_all` pada universe penuh (durasi apa adanya)

```
{"rows": 921, "refs": 962, "skipped_short_history": 0, "scenario_null_refs": 485} · durasi 31,4 s
rezim tersedia: range, tipis, tren_naik, turun
```

921 dari 962 emiten menghasilkan baris plan (41 emiten tanpa bar `adj_close` → dilewati), 485 emiten belum punya
sampel cukup untuk skenario (`n_events < min_events_scenario` → `scenario: null`, jawaban yang sah).
`tidak_cukup_data` tidak muncul di DB uji karena semua emiten di sana punya > `ta.min_history` bar —
jalur itu ditutup test `test_plan_semua_emiten` (emiten 30 bar → `regime = tidak_cukup_data`).

## 3. Dump respons nyata

| rezim | ticker | `/plan/stock` | `/series/stock` |
|---|---|---|---|
| `tren_naik` | AYLS | `plan_ok=true`, skenario ada, 3 kalimat, 9 baris level (`b20/plan_tren_naik_AYLS.json`) | 120 candle, MA20 120 titik, 2 kanal, 16 event (`b19/series_tren_naik_AYLS.json`) |
| `range` | AADI | `plan_ok=false` (`sr_channel`), skenario `null` (`b20/plan_range_AADI.json`) | 120 candle, 1 kanal, 12 event (`b19/series_range_AADI.json`) |
| `tipis` | ABBA | `plan_ok=true`, skenario `null` (4 event) (`b20/plan_tipis_ABBA.json`) | 120 candle, 4 kanal, 4 event (`b19/series_tipis_ABBA.json`) |

Lapisan v2 (semua aktif, AYLS): `b21/indicators_AYLS.json` (ursi 122 titik · vwap 122 titik · POC 211,94) dan
`b22/smc_elliott_AYLS.json` (9 BOS · 69 FVG · status Elliott `invalidated` — pola batal tetap dikirim).
`stop_grafik = sama_dengan_plan: True` → `levels` di grafik = angka `/plan/stock` (satu sumber).

## 4. Uji silang `stock_plan` vs `signal_weekly`

Di run bukti ini hasilnya **0/0 baris** — bukan kegagalan, tapi tanggalnya tidak bertaut: `signal_weekly`
memakai `week_end` Jumat (2026-10-09) sedangkan `stock_plan` memakai bar terakhir (2026-10-13).
Jaminan satu-mesin dikerjakan test `test_stock_plan_sama_dengan_signal_weekly`, yang menyamakan tanggalnya
(bar setelah `week_end` dihapus di fixture) dan membandingkan `regime`/`stop`/`tp1`/`tp2` → lulus.

## 5. Catatan proses apa adanya

- **Perf `/series/stock`**: 467 ms (400 bar, semua lapisan) dan 309 ms (tanpa lapisan) — AC `docs/07` B22 no. 8
  minta < 300 ms, jadi **belum terpenuhi**. Tidak dikejar: permintaan user "ga usah urusin performa". Angka diukur
  3× (median), bukan diklaim.
- **Bug yang hanya muncul di run nyata** (semua sudah diperbaiki, lihat ADR-055/056): `ZeroDivisionError` saat
  `atr14 == 0` (emiten harga datar/suspend) dan `KeyError: 'p_tp2_first'` (kolom ada di kontrak `docs/03` §6.5.2,
  hilang dari DDL `docs/04` → migrasi 007).
- Gerbang akhir: `python -m pytest -q backend -n auto` → **229 passed / 31,69 s**; `python -m backend.cli db-init`
  → `{"tables": 15, "user_version": 7}`.
