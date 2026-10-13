# B16 — bukti `as_of` benar-benar dipakai (`/stocks` + cache `/rrg` & `/sectors/summary`)

Server dev `:8000`, DB `data/rotation.db` (922 emiten, `price_daily` 429.581 baris),
tanggal uji `2026-10-09` (ada baris di `rrg_daily` **dan** `stock_metrics`).

## SEBELUM (HEAD `cf60f4d`, tanpa patch)

```
GET /stocks?timeframe=d1&sector=IDXFINANCE&limit=2
   total=99 first=POLA close=90.0 rs_ratio=115.652 score=89.1 | data_status.as_of=2026-10-13
GET /stocks?timeframe=d1&sector=IDXFINANCE&limit=2&as_of=2026-10-09
   total=99 first=POLA close=90.0 rs_ratio=115.652 score=89.1 | data_status.as_of=2026-10-09   <-- badan identik
GET /rrg?scope=sector&timeframe=d1
   as_of=2026-10-13 first=IDXHEALTH rs_ratio=103.0426 score=74.4
GET /rrg?scope=sector&timeframe=d1&as_of=2026-10-09
   as_of=2026-10-13 first=IDXHEALTH rs_ratio=103.0426 score=74.4                              <-- cache tanpa as_of
GET /sectors/summary?timeframe=d1&sector=IDXFINANCE
   IDXFINANCE rs_ratio=101.3652 score=46.1 | data_status.as_of=2026-10-13
GET /sectors/summary?timeframe=d1&sector=IDXFINANCE&as_of=2026-10-09
   IDXFINANCE rs_ratio=101.3652 score=46.1 | data_status.as_of=2026-10-13                     <-- cache tanpa as_of
```

## SESUDAH (patch yang di-commit)

```
GET /stocks?timeframe=d1&sector=IDXFINANCE&limit=2
   total=99 first=POLA close=90.0 rs_ratio=115.652 score=89.1 | data_status.as_of=2026-10-13
GET /stocks?timeframe=d1&sector=IDXFINANCE&limit=2&as_of=2026-10-09
   total=44 first=BHAT close=1770.0 rs_ratio=100.9055 score=None | data_status.as_of=2026-10-09
GET /rrg?scope=sector&timeframe=d1
   as_of=2026-10-13 first=IDXHEALTH rs_ratio=103.0426 score=74.4
GET /rrg?scope=sector&timeframe=d1&as_of=2026-10-09
   as_of=2026-10-09 first=IDXBASIC rs_ratio=102.0722 score=None
GET /sectors/summary?timeframe=d1&sector=IDXFINANCE
   IDXFINANCE rs_ratio=101.3652 score=46.1 | data_status.as_of=2026-10-13
GET /sectors/summary?timeframe=d1&sector=IDXFINANCE&as_of=2026-10-09
   IDXFINANCE rs_ratio=101.2388 score=None | data_status.as_of=2026-10-09
```

Catatan: `score=None` pada `2026-10-09` bukan regresi — skor hanya dihitung untuk `as_of` terakhir
(ADR-021), dan itu memang isi DB untuk tanggal itu. `total` 99 → **44** membuktikan `items`,
`total`, dan filter dihitung dari snapshot tanggal yang diminta, bukan dari snapshot terakhir.

## Test

- Baru: `backend/tests/test_b8_read.py::test_as_of_dipakai_dan_cache_per_tanggal` — tiga endpoint,
  dua panggilan berurutan dengan `as_of` berbeda (docs/07 B16 AC3).
- `pytest -q backend` → **162 passed** (sebelum patch: 161 passed).
