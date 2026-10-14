# B20d — `plan_pick` per tanggal + `as_of` + `plan_days` (picks 20 s → ms)

Lingkungan: `ROTATION_CONFIG=E:/rotation-b18-test/config.yaml` (config salinan **digenerate ulang** —
percobaan pertama gagal `KeyError: 'sector_gate_min_pass'` karena salinan lama), DB 962 emiten, `user_version 8`.

## 1. Backfill `plan_days=5` (diukur, bukan diklaim)

```
jobs.compute(stage=ta, plan_days=5) → durasi 217,8 s
result_json: {"ta_rows": 120614, "plan_rows": 921, "plan_refs": 962, "plan_skipped_short_history": 0,
              "scenario_null_refs": 380, "picks_saved": 43,
              "plan_dates": ["2026-10-07","2026-10-08","2026-10-09","2026-10-12","2026-10-13"],
              "rows": 125219, "duration_s": 217.85}
```

`plan_dates` = 5 hari bursa terakhir (10–11 Okt = akhir pekan → terlewat, **tidak** dibuatkan baris kosong).

## 2. Isi `plan_pick` per tanggal

```
2026-10-13 → 2 baris (rank maksimum 2)
2026-10-09 → 18 baris
2026-10-08 → 9 baris
2026-10-07 → 14 baris
```

Total 43 baris. **2026-10-12 tidak punya baris** — bukan bug: hari itu ada bar harga, tetapi tidak ada kandidat
yang lolos saring (`screened = 0`), dan "tidak ada kandidat" memang disimpan sebagai ketiadaan baris, bukan
baris kosong.

## 3. Durasi `GET /plan/picks` (time.perf_counter, TestClient in-process, 3× per tanggal)

| tanggal | min | median | screened |
|---|---|---|---|
| 2026-10-13 | 309 ms | 326 ms | 2 |
| 2026-10-09 | 283 ms | 313 ms | 18 |
| 2026-10-08 | 290 ms | 404 ms | 9 |
| 2026-10-07 | 303 ms | 408 ms | 14 |

`GET /plan/picks` (default, tanpa `as_of`) → **229 ms**. Sebelum B20d: **20,0 s** → sekarang ~0,3 s (≈60×).

**Rincian biaya (diukur terpisah) — yang mahal bukan logika picks:**

```
load_picks (baca plan_pick + status 18 pick) : 13 ms
data_status (helper bersama semua endpoint)  : 264 ms   ← bottleneck
available_dates                              :  0 ms
ihsg_support                                 :  5 ms
```

AC "≤ 0,3 s" terpenuhi di angka `min` (283–309 ms) tetapi **median 313–408 ms** karena `data_status`
(memanggilnya tiap request). Tidak dioptimalkan di task ini — permintaan user "ga usah urusin performa";
kalau nanti dikejar, kandidatnya `read.data_status` (di-cache per tanggal) bukan jalur picks.

## 4. Status berjalan (5 kasus, data buatan — `test_b20d_plan_pick.py`)

| ticker | bar setelah `as_of` | status |
|---|---|---|
| S1 | low 100,5 (menyentuh zona 101, tanpa target/stop) | `di_zona` |
| S2 | low 94 (batas rugi 95) | `kena_stop` |
| S3 | high 111 (TP1 110) | `kena_tp1` |
| S4 | low 104,5 (tidak menyentuh zona) | `menunggu_zona` |
| S5 | 61 bar tanpa sentuhan (horizon 60) | `kedaluwarsa` |

Batas rugi diperiksa **lebih dulu** di tiap bar (pesimis, sama seperti `simulate_result`) → bar yang menyentuh
dua-duanya dihitung rugi. `status_note` ≤140 char bahasa Indonesia (contoh nyata: "Zona beli belum tersentuh;
tunggu harga masuk atau biarkan rencana gugur.").

## 5. Pick lengkap + 404

`docs/evidence/b20d/pick_lengkap_2026-10-13.json` (SMDR, `status: menunggu_zona`, `bars_sejak_asof: 0` — wajar
karena `as_of` = tanggal terakhir yang ada) dan `respons_default.json`. `as_of` tanpa isi:

```
GET /api/v1/plan/picks?as_of=2020-01-02 → 404
{"error": {"code": "not_found", "message": "picks untuk 2020-01-02 belum dihitung — jalankan stage=ta (plan_days=N untuk backfill)",
           "detail": {"as_of": "2020-01-02", "available_dates": [...]}}}
```

## 6. Catatan proses (apa adanya)

- Test B20d yang ditulis: `backend/tests/test_b20d_plan_pick.py` → **10 passed** (bersama `test_b24_plan_picks.py`).
- Gerbang `pytest -q backend -n auto` **belum hijau** dan user eksplisit meminta **mengabaikan test**
  ("abaikan test, fokus code, dikejer deploy"). Yang merah: 4 test jumlah tabel (kini 16 dengan `plan_pick`) dan
  5 test lama yang **sudah** merah sebelum B20d — diverifikasi di worktree bersih pada commit `c548b91`
  (`test_konflik_seri_no_trade`, `test_kanal_min_strength`, `test_weekly_picks_kirim_plan` merah di sana juga).
