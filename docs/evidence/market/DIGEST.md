# Bukti: `GET /api/v1/meta/market` (kutipan IHSG, cache TTL, fallback DB)

## `live=false` (default) → `source: db`

- `source` = **db** · `session` = **open** · `close` = 5911.46 · `prev_close` = 5936.15
- `ret_1d` = -0.0042 · `ret_intraday` = **-0.004158266657640519** (di luar jam bursa → `null`) · `as_of` = 2026-10-13 · `last_bar_at` = 2026-10-13T16:00:00+07:00 · `delayed` = True
- `data_status`: status ok, range 2026-10-13..2026-10-13 ("13 Okt 2026")
- waktu respons 118 ms

## `live=true` dua kali dalam TTL → Yahoo sekali

| poll | source | cached | cache_age_s | close | waktu |
|---|---|---|---|---|---|
| 1 | live | **False** | 0 | 5902.3818359375 | 5543 ms |
| 2 | live | **True** | 0 | 5902.3818359375 | 4 ms |

- `api_version` = 1.1 · `symbol` = ^JKSE · `benchmark` = IHSG · `delayed` = True (feed Yahoo IDX selalu delay)
- `session` = open → `ret_intraday` = -0.0056880560529047886; `last_bar_at` = 2026-10-13T15:05:00+07:00
- poll 2 tidak menghubungi Yahoo: `cached: true`, `cache_age_s: 0` s (TTL `config.market.live_ttl_seconds`)

## `GET /api/v1/meta/config`

```json
{
  "live_enabled": true,
  "live_ttl_seconds": 60,
  "poll_seconds": 60,
  "move_flat_pct": 0.0005
}
```

## Potongan respons penuh

```json
{
  "api_version": "1.1",
  "benchmark": "IHSG",
  "symbol": "^JKSE",
  "close": 5902.3818359375,
  "prev_close": 5936.14697265625,
  "ret_1d": -0.0056880560529047886,
  "ret_1w": -0.046915607633898126,
  "ret_intraday": -0.0056880560529047886,
  "open": 5914.98388671875,
  "high": 5927.125,
  "low": 5828.67919921875,
  "volume": 0,
  "as_of": "2026-10-13",
  "last_bar_at": "2026-10-13T15:05:00+07:00",
  "session": "open",
  "source": "live",
  "delayed": true,
  "cached": false,
  "cache_age_s": 0,
  "data_status": {
    "as_of": "2026-10-13",
    "timeframe": "d1",
    "status": "ok",
    "last_data_at": "2026-10-13T12:13:54+07:00",
    "computed_at": "2026-10-13T12:14:14+07:00",
    "range_from": "2026-10-13",
    "range_to": "2026-10-13",
    "range_label": "13 Okt 2026",
    "partial_sectors": [],
    "detail": null
  }
}
```

## Fallback saat fetch gagal

Diuji di `backend/tests/test_b15_market.py::test_market_fallback_db_saat_gagal` (Yahoo dipalsukan gagal):
HTTP **200**, `source: db`, `data_status.status: "stale"`, `data_status.detail: "live gagal, memakai data tersimpan"`,
nilai tersimpan tetap dikirim — UI tidak pernah kena 500 karena kutipan live.
