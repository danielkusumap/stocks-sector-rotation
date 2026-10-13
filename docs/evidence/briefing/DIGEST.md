# Bukti: `summary_lines` + `watchlist` di `/briefing/morning` (docs/05 §3)

`GET /api/v1/briefing/morning` — `as_of` 2026-10-13, sinyal terakhir 2026-09-04, `api_version` 1.0, status data ok

**summary_lines (4 kalimat, maks 87 karakter):**

1. (87 char) IHSG turun 0,42% hari ini; 0 naik / 3 turun dari 3 sektor — pasar campur, pilih sektor.
2. (38 char) Turun paling dalam: Teknologi (−4,8%).
3. (70 char) Perhatikan minggu depan: Teknologi (Memimpin 4 minggu berturut-turut).
4. (80 char) Data intraday Yahoo belum sampai 11:30 WIB; angka midday = penutupan sebelumnya.

**watchlist (1 item):**

| kind | ref_id | name | quadrant | streak | reason |
|---|---|---|---|---|---|
| sector | IDXTECHNO | Teknologi | leading | 4 | Memimpin 4 minggu berturut-turut, kekuatan relatif masih naik. |

## Simulasi tanpa sinyal (`?as_of=2025-06-30`)

- `watchlist` = **[]** (tidak ada kandidat ≤ tanggal itu)
- `weekly_focus.week_end` = None · `summary_lines` tetap 4 kalimat:

  1. (87 char) IHSG turun 0,42% hari ini; 2 naik / 1 turun dari 3 sektor — pasar campur, pilih sektor.
  2. (92 char) Yang masih naik: Energi (+1,6%) dan Teknologi (+0,6%). Turun paling dalam: Keuangan (−0,0%).
  3. (51 char) Berpindah kuadran: Energi dari Memimpin ke Membaik.
  4. (80 char) Data intraday Yahoo belum sampai 11:30 WIB; angka midday = penutupan sebelumnya.

## Aturan yang dijaga test

- `test_summary_lines_panjang_maksimal` — 3–6 kalimat, ≤ 140 karakter, angka Indonesia (koma desimal),
  tanpa istilah mentah (`RS-Ratio`, `improving`, `quadrant`, `streak`), tanpa penanda markdown.
- `test_watchlist_maks_3` — maks 3 item, sektor dulu lalu saham, urut skor menurun, `reason` ≤ 140 karakter.
- `test_summary_kosong_bila_belum_ada_hasil` — DB tanpa hasil hitung → `summary_lines == []`, `watchlist == []`, HTTP 200.
- Dihitung saat endpoint dipanggil (tanpa tabel/kolom baru, tanpa LLM).

## Potongan respons

```json
{
  "summary_lines": [
    "IHSG turun 0,42% hari ini; 0 naik / 3 turun dari 3 sektor — pasar campur, pilih sektor.",
    "Turun paling dalam: Teknologi (−4,8%).",
    "Perhatikan minggu depan: Teknologi (Memimpin 4 minggu berturut-turut).",
    "Data intraday Yahoo belum sampai 11:30 WIB; angka midday = penutupan sebelumnya."
  ],
  "watchlist": [
    {
      "kind": "sector",
      "ref_id": "IDXTECHNO",
      "name": "Teknologi",
      "quadrant": "leading",
      "streak_weeks": 4,
      "reason": "Memimpin 4 minggu berturut-turut, kekuatan relatif masih naik."
    }
  ]
}
```
