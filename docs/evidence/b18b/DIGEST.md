# Bukti B18b

```
db-init: {"path": "E:\\rotation-b18-test\\rotation.db", "tables": 14, "user_version": 5}
stock_metrics (d1) di DB uji: {"2026-10-09": 256, "2026-10-13": 833}
1) BNBA (bar terakhir <= 2026-10-09: 2026-10-09) — basis lama vs baru:
   LAMA (stock_metrics terakhir): {"as_of_date": "2026-10-13", "sma20": 814.75, "sma50": 778.1, "rsi14": 45.256333, "atr14": 39.516058}
   BARU (bar <= week_end):        {"sma20": 814.75, "sma50": 777.2, "rsi14": 51.612584, "atr14": 39.478832, "vol20": 534695.0}
   selisih: atr14 -0.037226 · sma20 +0.000000 · rsi14 +6.356251
2) MPXL — snapshot terakhir 2026-10-13 != week_end -> angka berubah: atr14 22.935205 vs 22.237913 · sma20 228.9 vs 222.95
3) MPXL pekan lama 2026-06-19: baris stock_metrics=0 (tak ada) tapi dari bar -> atr14 9.2538 · sma20 149.8500 (riwayat 394 bar)
4) plan pekan lama 2026-06-19 (replay): ABBA regime tipis · stop 26.336448107659763 (lantai_atr) · tp1 37.0 · tp2 47.0 · plan_ok True
5) potongan `signal_weekly` (max week_end), sesudah B18b:
   week_end=2026-10-09 · ref_id=AYLS · regime=None · stop=156.91 · tp1=None · tp2=None · stop_pct=None · rr_tp2=None · plan_ok=None
   week_end=2026-10-09 · ref_id=MITI · regime=None · stop=303.32 · tp1=None · tp2=None · stop_pct=None · rr_tp2=None · plan_ok=None
   week_end=2026-10-09 · ref_id=MPXL · regime=tren_naik · stop=200.71 · tp1=332.0 · tp2=332.0 · stop_pct=-0.0997 · rr_tp2=4.676 · plan_ok=0
   week_end=2026-10-09 · ref_id=SAPX · regime=None · stop=334.53 · tp1=None · tp2=None · stop_pct=None · rr_tp2=None · plan_ok=None
   week_end=2026-10-09 · ref_id=SMDR · regime=tren_naik · stop=375.73 · tp1=434.0 · tp2=476.81 · stop_pct=-0.0593 · rr_tp2=3.0 · plan_ok=1
   store plan (semua minggu): baris=50 · punya_plan=34 · tanpa_plan=16
```
