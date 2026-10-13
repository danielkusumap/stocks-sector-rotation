# Gladi bersih end-to-end (DB terpisah, jalur HTTP seperti UI)

- DB uji: `C:\Users\ACER\AppData\Local\Temp\gladi\rotation_rehearsal.db`, config `C:\Users\ACER\AppData\Local\Temp\gladi\config-gladi.yaml` — **`data/rotation.db` user tidak disentuh**.
- Fixture: `saham_gladi.xlsx` — 20 emiten / 3 sektor (IDXFINANCE 7, IDXENERGY 7, IDXTECHNO 6); campur likuid (BBCA/BBRI/TLKM/PTBA) & tipis (BUMI/WIFI/DMMX/BBYB).
- Semua langkah tulis lewat `?async=true` + poll `GET /api/v1/admin/runs/{run_id}` tiap 1 detik (replika UI).

## 1. Pipeline (HTTP)

- `GET /health` → **200** — tables 13
- `POST /admin/import/excel` → **202** — kind import_excel status ok rows 20 poll 2x inserted 20
- `POST /admin/compute (sebelum ingest)` → **409** — {"code": "prereq_no_prices", "message": "jalankan 'Ambil harga harian' dulu: baru 0% emiten aktif punya bar harga (minimum 50%)", "detail": {"coverage
- `POST /admin/ingest/prices (daily 2 thn)` → **202** — status ok rows 9934 poll 5x failed []
- `POST /admin/compute (all)` → **202** — status ok rows 25145 tf ['d1', 'w1', 'w1_fri'] durasi 15.66s
- `POST /admin/compute (signals w1_fri)` → **409** — {"code": "gate_weekly_not_final", "message": "sinyal mingguan (w1_fri) dihitung setelah penutupan Jumat (Sabtu/Minggu juga boleh)", "detail": {"gate": "not_final", "weekd
- `POST /admin/compute (rrg d1 ulang)` → **202** — status ok rows 16312

## 2. Verifikasi endpoint

| endpoint | status | item / catatan |
|---|---|---|
| `GET /health` | 200 | tables 13 |
| `POST /admin/import/excel` | 202 | kind import_excel status ok rows 20 poll 2x inserted 20 |
| `POST /admin/compute (sebelum ingest)` | 409 | {"code": "prereq_no_prices", "message": "jalankan 'Ambil harga harian' dulu: baru 0% emiten aktif punya bar harga (minimum 50%)", "detail": {"coverage |
| `POST /admin/ingest/prices (daily 2 thn)` | 202 | status ok rows 9934 poll 5x failed [] |
| `POST /admin/compute (all)` | 202 | status ok rows 25145 tf ['d1', 'w1', 'w1_fri'] durasi 15.66s |
| `POST /admin/compute (signals w1_fri)` | 409 | {"code": "gate_weekly_not_final", "message": "sinyal mingguan (w1_fri) dihitung setelah penutupan Jumat (Sabtu/Minggu juga boleh)", "detail": {"gate": "not_final", "weekd |
| `POST /admin/compute (rrg d1 ulang)` | 202 | status ok rows 16312 |
| `GET /api/v1/meta/sectors` | 200 | items 11 |
| `GET /api/v1/meta/config` | 200 |  |
| `GET /api/v1/meta/dates` | 200 | dates 120 |
| `GET /api/v1/freshness` | 200 |  |
| `GET rrg?d1` | 200 | items 3 | as_of 2026-10-13 status ok computed_at ada |
| `GET rrg?w1_fri` | 200 | items 3 | as_of 2026-10-09 status ok computed_at ada |
| `GET rrg?scope=stock` | 200 | items 5 | as_of 2026-10-13 status ok computed_at ada |
| `GET sectors/summary?w1_fri` | 200 | items 3 | as_of 2026-10-09 status ok computed_at ada |
| `GET sectors/summary?filter` | 200 | items 1 | as_of 2026-10-13 status ok computed_at ada |
| `GET sectors/IDXENERGY` | 200 | as_of 2026-10-13 status ok computed_at ada |
| `GET /api/v1/stocks` | 200 | items 20 | as_of 2026-10-13 status ok computed_at ada |
| `GET stocks/PTBA` | 200 |  |
| `GET rotation/matrix` | 200 | changes 0 |
| `GET /api/v1/heatmap` | 200 | rows 11 |
| `GET series/sector/IDXENERGY` | 200 | points 64 |
| `GET /api/v1/weekly/picks` | 200 | sectors 1 |
| `GET /api/v1/briefing/morning` | 200 | as_of 2026-10-13 status ok computed_at ada |
| `GET /api/v1/heatmap` | 200 | rows 0 |

## 3. Checklist

| checklist | hasil |
|---|---|
| status 200 & tanpa 500 | PASS |
| data_status terisi | PASS |
| array utama tidak kosong | PASS |
| /rrg w1_fri tail >= 2 titik | PASS |
| tail[-1] == rs_ratio item | PASS |
| streak_weeks terisi pada item beriwayat | 1/3 item > 0 |
| rs_ratio_change_1p terisi | 3/3 item (baris pertama tiap seri memang null) |
| weekly_focus briefing terisi | PASS |

## 4. Jalur gagal

- compute sebelum ingest → HTTP 409 `prereq_no_prices`: "jalankan 'Ambil harga harian' dulu: baru 0% emiten aktif punya bar harga (minimum 50%)"
- signals w1_fri di hari kerja → HTTP 409 `gate_weekly_not_final`: "sinyal mingguan (w1_fri) dihitung setelah penutupan Jumat (Sabtu/Minggu juga boleh)" (detail {'gate': 'not_final', 'weekday': 'Tuesday', 'checked_at': '2026-10-13T12:14:12+07:00'})

- `/rotation/matrix`: `changes` 0, `cells` 0 (hari itu tidak ada perubahan kuadran — wajar).
- Rincian jumlah item: {"rrg?d1": 3, "rrg?w1_fri": 3, "rrg?scope=stock": 5, "sectors/summary?w1_fri": 3, "stocks": 20, "weekly/picks": 1, "heatmap": 11}

## 5. Potongan respons

`/api/v1/rrg?timeframe=w1_fri` item pertama (dengan ekor):
```json
{
  "ref_id": "IDXENERGY",
  "name": "Energi",
  "color_hex": "#B45309",
  "rs_ratio": 105.79693448465504,
  "rs_momentum": 100.19374501544566,
  "rs_ratio_change_1p": 0.26931316657844206,
  "rs_momentum_change_1p": 0.09751195328183826,
  "quadrant": "leading",
  "quadrant_prev": "leading",
  "transition": null,
  "quadrant_age_periods": 2,
  "score": 73.6,
  "rank_score": 1,
  "streak_weeks": 0,
  "ret_1w": 0.029379889641651502,
  "median_turnover_20d_idr": 730552023200,
  "tail": [
    {
      "as_of": "2026-07-17",
      "rs_ratio": 104.02385244855134,
      "rs_momentum": 98.08448910424627
    },
    {
      "as_of": "2026-07-24",
      "rs_ratio": 104.17764187415555,
      "rs_momentum": 97.98507116559733
    },
    {
      "as_of": "2026-07-31",
      "rs_ratio": 103.83984877062223,
      "rs_momentum": 98.03767316323135
    },
    {
      "as_of": "2026-08-07",
      "rs_ratio": 103.54287470782937,
      "rs_momentum": 98.14614776536217
    },
    {
      "as_of": "2026-08-14",
      "rs_ratio": 103.24560066075482,
      "rs_momentum": 98.29357507147881
    },
    {
      "as_of": "2026-08-21",
      "rs_ratio": 103.15260440310838,
      "rs_momentum": 98.38990742152991
    },
    {
      "as_of": "2026-08-28",
      "rs_ratio": 103.18937722930802,
      "rs_momentum": 98.52106402718489
    },
    {
      "as_of": "2026-09-04",
      "rs_ratio": 103.96089911481866,
      "rs_momentum": 98.7720849669107
    },
    {
      "as_of": "2026-09-11",
      "rs_ratio": 104.92857423740888,
      "rs_momentum": 99.15314938150871
    },
    {
      "as_of": "2026-09-18",
      "rs_ratio": 105.26390563167307,
      "rs_momentum": 99.53896606727754
    },
    {
      "as_of": "2026-09-25",
      "rs_ratio": 105.34668078044761,
      "rs_momentum": 99.87918734015534
    },
    {
      "as_of": "2026-10-02",
      "rs_ratio": 105.5276213180766,
      "rs_momentum": 100.09623306216382
    },
    {
      "as_of": "2026-10-09",
      "rs_ratio": 105.79693448465504,
      "rs_m
```

`/api/v1/briefing/morning`:
```json
{
  "api_version": "1.0",
  "generated_at": "2026-10-13T12:14:19+07:00",
  "data_status": {
    "as_of": "2026-10-13",
    "timeframe": "d1",
    "status": "ok",
    "last_data_at": "2026-10-13T12:13:54+07:00",
    "computed_at": "2026-10-13T12:14:14+07:00",
    "partial_sectors": []
  },
  "market": {
    "ihsg_close": 5911.462890625,
    "ihsg_ret_1d": -0.004158266657640519,
    "ihsg_ret_1w": -0.04544924850474419,
    "sectors_up": 0,
    "sectors_down": 3,
    "breadth": {
      "advancers": 2,
      "decliners": 18,
      "unchanged": 0
    },
    "regime": "mixed",
    "regime_note": "0 naik / 3 turun dari 3 sektor — pasar campur, pilih sektor."
  },
  "leaders": [
    {
      "code": "IDXENERGY",
      "name_id": "Energi",
      "quadrant": "weakening",
      "score": 65.2,
      "ret_1w": -0.016238829248705677,
      "streak_weeks": 0,
      "series": null
    },
    {
      "code": "IDXFINANCE",
      "name_id": "Keuangan",
      "quadrant": "lagging",
      "score": 50.0,
      "ret_1w": -0.02476231313708699,
      "streak_weeks": 0,
      "series": null
    },
    {
      "code": "IDXTECHNO",
      "name_id": "Teknologi",
      "quadrant": "lagging",
      "score": 21.7,
      "ret_1w": -0.06082331584004452,
      "streak_weeks": 4,
      "series": null
    }
  ],
  "laggards": [
    {
      "code": "IDXTECHNO",
      "name_id": "Teknologi",
      "quadrant": "lagging",
      "score": 21.7,
      "ret_1w": -0.06082331584004452,
      "streak_weeks": 4,
      "series": null
    },
    {
      "code": "IDXFINANCE",
      "name_id": "Keuangan",
      "quadrant": "lagging",
      "score": 50.0,
      "ret_1w": -0.02476231313708699,
      "streak_weeks": 0,
      "series": null
    },
    {
      "code": "IDXENERGY",
      "name_id": "Energi",
      "quadrant": "weakening",
      "score": 65.2,
      "ret_1w": -0.016238829248705677,
      "streak_weeks": 0,
      "series": null
    }
  ],
  "changes": [],
  "weekly_focus": {
    "week_end": "2026-09-04",
    "sectors": [
      {
        "code": "IDXTECHNO",
        "streak_weeks": 4,
        "rationale": "Teknologi bertahan 16 periode di kuadran Memimpin dengan momentum relatif 100,4 (>100) yang masih naik."
      }
    ],
    "stocks": []
  },
  "midday": {
    "available": false,
    "as_of": null,
    "gate": "stale",
    "moves": []
  },
  "watch": [
    {
      "level": "warning",
      "message": "Data intraday Yahoo belum sampai 11:30 WIB (bar terakhir belum ada bar); angka midday = penutupan sebelumnya."
    },
    {
      "level": "info",
      "message": "Angka tengah hari belum tersedia — jalankan tombol 'Tengah hari'."
    }
  ],
  "notes_for_report": "Susun 5–8 paragraf: kondisi pasar, sektor kuat/lemah, perubahan kuadran, fokus mingguan (sebut streak), risiko & catatan data."
}
```

`/api/v1/weekly/picks` (sector pertama):
```json
{
  "ref_id": "IDXTECHNO",
  "name": "Teknologi",
  "rank": 1,
  "score": 0.0,
  "streak_weeks": 4,
  "rule_hits": {
    "quadrant": "leading",
    "quadrant_ok": true,
    "age_ok": true,
    "momentum_ok": true,
    "ret_4w_ok": true,
    "constituents_ok": true,
    "rs_momentum": 100.39505657104444,
    "rs_momentum_change_1p": 0.03372539322103307,
    "ret_4w": 0.02809270533340058,
    "constituents_count": 6,
    "quadrant_age_periods": 16
  },
  "rationale": "Teknologi bertahan 16 periode di kuadran Memimpin dengan momentum relatif 100,4 (>100) yang masih naik."
}
```

## 6. Endpoint yang kosong / aneh (dan dugaan penyebabnya)

Tidak ada endpoint yang gagal atau kosong total. Yang perlu dicatat:

| endpoint | gejala | dugaan penyebab & status |
|---|---|---|
| `/rotation/matrix?timeframe=d1` | `cells` 0, `changes` 0 | Tidak ada sektor yang berpindah kuadran antara 2026-10-09 dan 2026-10-13 (universe 3 sektor) — wajar; di DB user versi 11 sektor endpoint ini mengembalikan 1 perubahan |
| `/weekly/picks` | `week_end 2026-09-04` (bukan minggu final terakhir 2026-10-09) | Minggu tanpa kandidat tidak menulis baris `signal_weekly` (ADR-022), jadi endpoint menampilkan minggu terakhir **yang punya** kandidat; `is_final true` dan `week_end` selalu dikirim sehingga UI bisa memberi label. Di universe kecil ini hanya 2026-09-04 dst. yang punya kandidat |
| `/weekly/picks` | `stocks: []` | Tidak ada saham sektor kandidat (IDXTECHNO) yang lolos delapan aturan `docs/03` §6.2 — mis. DMMX close 160 < SMA20 177, RSI 29,7, median turnover ~Rp 142 juta. Dengan `weekly.require_sektor_kandidat: false` 1 saham lolos → pipa saham sehat, yang membatasi adalah ketatnya aturan + universe 20 emiten |
| `/weekly/picks` | `score 0.0` pada pick lama | Skor hanya dihitung untuk `as_of` terakhir (ADR-021); pick dari minggu lama tidak punya snapshot skor sehingga tersimpan 0,0. Kalau UI menampilkan "skor 0,0" untuk kandidat, lebih baik sembunyikan saat `score == 0` atau simpan `NULL` — perlu keputusan kontrak (`docs/05` §3) sebelum diubah |
| `/sectors/summary?quadrant=leading,improving` | 0 item (uji pertama) | Universe uji hanya 3 sektor dan hari itu semuanya `weakening`/`lagging`; filter bekerja benar (dibuktikan filter `sector=IDXENERGY&sort=rs_ratio` → 1 item) |
| `/api/v1/stocks/PTBA`, `/sectors/IDXENERGY` | tanpa `data_status` | Sesuai `docs/05` §3 (endpoint detail tidak membawa `data_status`) |

`/rrg?timeframe=w1_fri` → `tail` 13 titik per item; titik terakhir sama dengan `rs_ratio`/`rs_momentum` item,
jadi ekor RRG di UI akan tergambar penuh (§3 poin khusus terpenuhi).
