# Bukti: run `already_imported` = skipped · `data_status.range_*` · `week_start`/`week_label`

## A. Import ulang = `skipped`, file rusak = `failed`
- `POST /admin/import/excel` (file sama) → HTTP **409**, `error.code` = `already_imported`

| run | kind | status | percent | message |
|---|---|---|---|---|
| 6 | import_excel | **failed** | None | BadZipFile: File is not a zip file |
| 5 | import_excel | **skipped** | None | file sudah pernah diimport (import_id=1) |
| 4 | compute_all | **ok** | 100.0 | sektor d1 |
| 3 | compute_all | **ok** | 100.0 | minggu 80/91 |
- POST import file **rusak** → HTTP 500 (error openpyxl belum dipetakan ke 400; run tetap `failed`)

## B. `data_status.range_from` / `range_to` / `range_label`

| endpoint | as_of | range_from | range_to | range_label |
|---|---|---|---|---|
| `/api/v1/rrg?timeframe=w1_fri&window=3m` | 2026-10-09 | 2026-10-05 | 2026-10-09 | 5–9 Okt 2026 |
| `/api/v1/rrg?timeframe=d1&window=1y` | 2026-10-13 | 2025-10-12 | 2026-10-13 | 12 Okt 2025 – 13 Okt 2026 |
| `/api/v1/rrg?timeframe=d1&window=3m` | 2026-10-13 | 2026-07-13 | 2026-10-13 | 13 Jul – 13 Okt 2026 |
| `/api/v1/sectors/summary?timeframe=w1_fri` | 2026-10-09 | 2026-10-05 | 2026-10-09 | 5–9 Okt 2026 |
| `/api/v1/heatmap` | 2026-10-13 | 2026-07-13 | 2026-10-13 | 13 Jul – 13 Okt 2026 |
| `/api/v1/rotation/matrix` | 2026-10-13 | 2026-07-13 | 2026-10-13 | 13 Jul – 13 Okt 2026 |
| `/api/v1/stocks?limit=1` | 2026-10-13 | 2026-10-13 | 2026-10-13 | 13 Okt 2026 |
| `/api/v1/stocks/PTBA` | 2026-10-13 | 2026-07-13 | 2026-10-13 | 13 Jul – 13 Okt 2026 |
| `/api/v1/briefing/morning` | 2026-10-13 | 2026-10-13 | 2026-10-13 | 13 Okt 2026 |
| `/api/v1/series/sector/IDXENERGY` | (tanpa data_status) | 2026-07-13 | 2026-10-13 | 13 Jul – 13 Okt 2026 |

## C. `/weekly/picks`

- `api_version` = **1.1** · `week_start` = **2026-08-31** · `week_end` = 2026-09-04 · `week_label` = **"31 Agu – 4 Sep 2026"** · `is_final` = True

```json
{
  "api_version": "1.1",
  "week_end": "2026-09-04",
  "week_start": "2026-08-31",
  "week_label": "31 Agu – 4 Sep 2026",
  "is_final": true
}
```

## Potongan respons

`/api/v1/rrg?timeframe=w1_fri&window=3m` →
```json
{
  "as_of": "2026-10-09",
  "timeframe": "w1_fri",
  "status": "ok",
  "last_data_at": "2026-10-13T12:13:54+07:00",
  "computed_at": "2026-10-13T12:14:05+07:00",
  "range_from": "2026-10-05",
  "range_to": "2026-10-09",
  "range_label": "5–9 Okt 2026",
  "partial_sectors": []
}
```

`/api/v1/rrg?timeframe=d1&window=1y` →
```json
{
  "as_of": "2026-10-13",
  "timeframe": "d1",
  "status": "ok",
  "last_data_at": "2026-10-13T12:13:54+07:00",
  "computed_at": "2026-10-13T12:14:14+07:00",
  "range_from": "2025-10-12",
  "range_to": "2026-10-13",
  "range_label": "12 Okt 2025 – 13 Okt 2026",
  "partial_sectors": []
}
```

`/api/v1/heatmap` →
```json
{
  "as_of": "2026-10-13",
  "timeframe": "d1",
  "status": "ok",
  "last_data_at": "2026-10-13T12:13:54+07:00",
  "computed_at": "2026-10-13T12:14:14+07:00",
  "range_from": "2026-07-13",
  "range_to": "2026-10-13",
  "range_label": "13 Jul – 13 Okt 2026",
  "partial_sectors": []
}
```
