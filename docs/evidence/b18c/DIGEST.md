# B18c — kalibrasi `plan_ok` (stop lebar = peringatan, ambang adaptif ATR)

Lingkungan: config salinan `E:/rotation-b18-test/config.yaml` (**digenerate ulang** dari `config/default.yaml`
supaya `weekly.plan.max_stop_atr` ikut — percobaan pertama gagal `KeyError: 'max_stop_atr'` karena salinan lama),
DB `E:/rotation-b18-test/rotation.db` (universe penuh, `VACUUM INTO`, tanpa backfill).

## Distribusi `plan_ok` (34 pick berplan, semua minggu)

| | SEBELUM B18c | SESUDAH B18c |
|---|---|---|
| `plan_ok = true` | 5 | **16** |
| `plan_ok = false` | **29** (semuanya `stop_pct < −8%`) | **18** — semuanya `entry_mode = no_trade` |
| gagal karena RR | 0 | 0 |
| baris ber-stop > 8% | 10 | 10 (tidak lagi menggagalkan plan) |

```
compute_signals (kode B18c): {"rows": 109, "weeks": 91, "sector_rows": 75, "stock_rows": 34, "week_end": "2026-10-09"}
distribusi: baris=50 · punya_plan=34 · ok=16 · tidak_ok=18 · gagal_no_trade=18 · gagal_rr=0 · stop_di_atas_8pct=10
```

## Dua plan yang berubah (`plan_MPXL_2026-10-09.json`, `plan_SMDR_2026-10-09.json`)

```
MPXL @ 2026-10-09: plan_ok=1 · stop=200.71 (−9.97%) · rr_tp2=4.676 · risk_pct=0.0997 · notes=[]
SMDR @ 2026-10-09: plan_ok=1 · stop=375.73 (−5.93%) · rr_tp2=3.000 · risk_pct=0.0593 · notes=[]
```

Sebelumnya MPXL `plan_ok = false` hanya karena stop −9,97% (di atas 8%). Sekarang peringatan itu **tidak** muncul
karena ambang efektifnya = `max(8%, 3 × ATR/harga)` = `max(8%, 29%)` = 29% — stop 10% masih di bawahnya.

## Catatan jujur

1. **Peringatan "stop lebar" belum pernah terpicu di data nyata**: rumus §6.4.3 membatasi `|stop_pct|` pada
   1–1,5 × ATR/harga, sedangkan ambang efektif = 3 × ATR/harga (untuk ATR/harga > 2,67%) → peringatan hanya bisa
   muncul kalau `weekly.atr_stop_mult` > `max_stop_atr` (mis. 3,25 atau 7,0 — seperti di test B18c).
2. **`plan_ok = false` dari cek RR juga tidak mungkin terpicu** selama `tp2 = max(puncak 40 hari, level RR minimum)`
   (§6.4.4) — TP2 selalu dinaikkan ke level minimum, jadi `rr_tp2 ≥ rr_min_tp2` secara konstruksi. Guard-nya tetap
   ada sebagai penjaga bila konstruksi target berubah. Karena level TP2 dihitung **tepat** di ambang, perbandingan
   memakai toleransi `1e-9` (`2.9999999999999996` tetap dianggap memenuhi 3:1).
3. 18 `no_trade` dari 34 pick adalah rezim `turun` pada pekan-pekan lama — jawaban yang sah, bukan bug.

## Test

`python -m pytest backend/tests/test_b18_plan.py -q` → **27 passed** (3 test baru: `test_plan_ok_hanya_untuk_rr_dan_no_trade`,
`test_stop_lebar_adaptif_atr`, `test_rr_tp2_selalu_penuhi_minimum` — yang terakhir menggantikan bentuk AC no. 3 yang
secara konstruksi tak bisa terjadi, lihat ADR-048).
