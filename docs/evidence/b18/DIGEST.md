# B18 — trading plan TA di `weekly/picks`: bukti run nyata

Lingkungan (bukan `data/rotation.db` user): config salinan `E:/rotation-b18-test/config.yaml` (digenerate ulang dari
`config/default.yaml`, termasuk blok `weekly.plan`), DB `E:/rotation-b18-test/rotation.db` = `VACUUM INTO` dari
`data/rotation.db` (universe penuh — pick §6.1/§6.2 butuh sektor kandidat; **tidak ada ingest/backfill**).
`python -m backend.cli db-init` pada DB salinan dan DB user: `{"tables": 14, "user_version": 5}`,
`signal_weekly` +19 kolom plan, `ta_breakout` +`mfe_pct`/`mae_pct`.

## 1. Test

```
python -m pytest -q backend -n auto
196 passed, 1 warning          (20 test baru di backend/tests/test_b18_plan.py)
```
Nama test sesuai `docs/03` §6.4.8: `test_plan_breakout_butuh_volume`, `test_plan_wait_pullback_saat_jauh`,
`test_stop_pilih_yang_struktur`, `test_stop_lantai_atr`, `test_rr_netto_biaya`, `test_tp1_fallback`,
`test_plan_alasan_pendek_dan_bahasa_indonesia`, `test_atr_null_plan_null`, `test_hit_rate_dari_mfe`,
`test_regime_gate`, `test_regime_tipis_menang`, `test_regime_turun_no_trade`, `test_konfirmasi_maks_satu`,
`test_konflik_seri_no_trade`, `test_pivot_butuh_bar_kiri_kanan`, `test_kanal_kelompokkan_pivot_berdekatan`,
`test_kanal_min_strength`, `test_mfe_mae_dari_seri_naik_turun`, `test_plan_tersimpan_dan_idempoten`,
`test_weekly_picks_kirim_plan`.

## 2. Run nyata (`RUN-LOG.txt`)

```
db-init          : {"tables": 14, "user_version": 5}
compute_ta       : {"rows": 120614, "refs": 932, "refs_skipped_short_history": 41,
                    "ma_periods": [10,20,50], "variants": ["filter_off","filter_on"], "win_rate": 0.4621}
compute_signals  : {"rows": 109, "weeks": 91, "sector_rows": 75, "stock_rows": 34, "week_end": "2026-10-09",
                    "sectors": 3, "stocks": 5}
GET /weekly/picks: api_version 1.2 · week_end 2026-10-09 (5–9 Okt 2026) · is_final true · 3 sektor + 5 saham
store plan       : baris=50 · punya_plan=34 · tanpa_plan=16
```

16 baris tanpa plan = baris **lama** (dari run universe penuh sebelum B18) yang tidak ditulis ulang oleh run ini →
`plan: null` di respons (AC 7), endpoint tetap 200. Ketiganya (AYLS/MITI/SAPX) punya `atr14` dan 472 bar, jadi
bukan kasus "data kurang" — memang baris warisan.

## 3. Satu pick berplan (rezim `tren_naik`) — `pick_tren_naik.json`

MPXL (rank 1, skor 85,0, `entry_ref` 290):

| Elemen | Nilai |
|---|---|
| `regime` / `entry_tool` / `confirm_tool` | `tren_naik` / `pullback_ma20` / `volume` |
| `entry_tool_reason` | "Harga dekat penyangga 20 hari saat tren masih naik — beli di penyangga membuat batas rugi lebih dekat." |
| `confirm_reason` | "Volume bar terakhir 3,5 kali rata-rata 20 hari (minimal 1,5 kali)." |
| `entry_mode` | `wait_pullback` (harga 2,7 × volatilitas di atas penyangga → jangan chase) |
| `entry_zone` | 222,02 – 235,78 |
| `stop` | 202,53 · `pct` −11,52% · `basis` `struktur_swing_low` |
| `tp1` | 332,0 · RR netto **3,745** · `basis` `resistance_20` |
| `tp2` | 332,0 · RR netto **3,745** · `basis` `puncak_40` |
| `hold` | median 2 hari · 9 event · win rate 0,667 · `hit_tp1` 0,0 · `hit_tp2` 0,0 |
| `invalidation` | "…penyangga 20 hari (229) atau batas rugi (203); pasar: IHSG tutup di bawah 5.973 → tunda entry baru." |
| `plan_ok` | **false** + notes: "Batas rugi lebih lebar dari 8% — terlalu lebar untuk swing harian." (benar: −11,5%) |

Baris pick yang sama: `target` = `plan.tp2.level` = 332,0 · `stop` = `plan.stop.level` = 202,53 · `lots_hint` 228
(dihitung ulang dari stop plan, `risk_per_trade_idr` 2 juta).

SMDR (rank 2): `pullback`, zona 395,46–404,94, stop 376,50 (`volatilitas_atr`), tp1 434,0 (RR 1,27), tp2 477,71
(RR netto 3,00), `hit_tp1` 0,083 · `hit_tp2` 0,0 · `hold_median_periods` 5,5.

Rezim yang muncul pada pick minggu itu hanya `tren_naik`. `range`/`tipis`/`turun` **tidak** ada → contoh `range`
dibuat sintetis dan disebut apa adanya (`pick_range_sintetis.json`): `sr_channel` + `rsi_tepi_range`, zona 98,9–100,1,
stop 97,5, tp1 100,5, tp2 107,092, `plan_ok` true.

## 4. Uji silang

- **stock_plan vs signal_weekly:** belum ada `stock_plan` di B18 (tabelnya migrasi 006 → task **B20**). Yang sudah
  diuji mesin yang sama: `test_plan_tersimpan_dan_idempoten` (recompute 2× → `plan_json`, `tp2`, `rr_tp2`, `hit_tp1`
  identik) + `test_weekly_picks_kirim_plan` (`plan_json` tersimpan == `plan` yang dikirim endpoint).
- **Hit rate nyata dari MFE** (`ta_breakout` MA20, `trend_filter=1`) vs blok `hold` plan:

  ```
  ref_id=TOOL · n_events=42 · hit_3pct=0.619 · hit_5pct=0.548 · mfe_max=0.2703 · mae_min=-0.1176
  ref_id=TYRE · n_events=36 · hit_3pct=0.444 · hit_5pct=0.417 · mfe_max=0.0811 · mae_min=-0.084
  ref_id=BACA · n_events=34 · hit_3pct=0.529 · hit_5pct=0.529 · mfe_max=0.2308 · mae_min=-0.0571
  ref_id=GDYR · n_events=34 · hit_3pct=0.324 · hit_5pct=0.206 · mfe_max=0.0747 · mae_min=-0.0833
  ref_id=KUAS · n_events=34 · hit_3pct=0.618 · hit_5pct=0.529 · mfe_max=0.3600 · mae_min=-0.2121
  ```
  MPXL: 9 event, `hit_tp1` 0,0 padahal TP1 = +45% — konsisten (`mfe_max` MPXL jauh di bawah 45%).
- **Replay manual MFE/MAE** (`docs/03` §10.9): `test_mfe_mae_dari_seri_naik_turun` memakai seri naik 8% lalu turun
  3% → `mfe_pct` = +0,08, `mae_pct` = −0,03 (dibaca dari `reference_rows` yang sama dengan yang menulis tabel).
- **Arah biaya** (`test_rr_netto_biaya`): `fee_*` 15+25 → 150+150 bps menaikkan `tp2.level` (target minimal ikut
  naik) dan menurunkan `tp1.rr`; `plan_ok` bisa jadi false dengan catatan yang menyebut angkanya.

## 5. Berkas

| Berkas | Isi |
|---|---|
| `RUN-LOG.txt` | log run (db-init, compute_ta, compute_signals, ringkasan pick, agregat SQL) |
| `weekly_picks.json` | `GET /api/v1/weekly/picks` (api_version 1.2) apa adanya |
| `pick_tren_naik.json` | baris pick MPXL lengkap (plan penuh) |
| `pick_range_sintetis.json` | contoh plan rezim `range` (sintetis, disebut di §3) |
| `_run_evidence.py` | skrip repro bukti ini |
