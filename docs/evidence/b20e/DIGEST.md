# B20e — `as_of_date` = cutoff yang diminta + kolom `last_bar_date`

Lingkungan: DB dev `data/rotation.db` (921 baris `stock_plan` per cutoff, 962 emiten aktif), migrasi **009**
diterapkan di tengah run bukti (`{"tables": 16, "user_version": 9}`).

## 1. SEBELUM → SESUDAH: satu run = satu keranjang (AC 1)

| | SEBELUM (run #51, cutoff 14 Okt) | SESUDAH (`plan_for_all(as_of=…)`) |
|---|---|---|
| `stock_plan` 2026-10-14 | **834** baris | **921** |
| `stock_plan` 2026-10-13 | **918** baris (termasuk 87 baris "bocor" dari run cutoff 14 Okt — emiten tanpa bar 14 Okt) | **921** (dari cutoff 13 Okt sendiri) |
| `stock_plan` 2026-10-12 | — | **921** |
| `stock_plan` 2026-10-09 | 88 baris (sisa run lama) | **921** |
| `stock_plan` 2026-10-08 | — | **921** |

`plan_days=5` (5 cutoff) → `SELECT as_of_date, COUNT(*) … GROUP BY 1` = **5 tanggal, masing-masing 921 baris**
(durasi 235,9 s ≈ 47 s per cutoff pada DB dev). Tidak ada lagi keranjang tanggal yang tidak diminta.

## 2. Emiten tanpa bar di cutoff tetap punya baris (AC 2)

Cutoff `2026-10-14`, lima contoh dari temuan user — **sebelum** kelimanya bocor ke keranjang 13 Okt,
**sesudah** punya baris di cutoff 14 Okt dengan `last_bar_date` = bar terakhir mereka sendiri:

```
ABBA: sebelum as_of_date 2026-10-13 → sesudah as_of_date 2026-10-14 · last_bar_date 2026-10-13 · regime tipis · stop 29,99
ADCP: sebelum 2026-10-13 → sesudah 2026-10-14 · last_bar_date 2026-10-13 · regime tipis · stop 50,00
ADHI: sebelum 2026-10-13 → sesudah 2026-10-14 · last_bar_date 2026-10-13 · regime tipis · stop 132,58
AIMS: sebelum 2026-10-13 → sesudah 2026-10-14 · last_bar_date 2026-10-13 · regime tipis · stop 630,51
ALMI: sebelum 2026-10-13 → sesudah 2026-10-14 · last_bar_date 2026-10-13 · regime tipis · stop 74,00
```

Kolom `last_bar_date` inilah yang dipakai UI untuk menulis "harga terakhir 13 Okt" tanpa salah label —
`as_of_date` tetap berarti "dihitung sampai cutoff ini".

## 3. `plan_pick` per cutoff (AC 3)

```
2026-10-14 → 1 pick   2026-10-13 → 5 pick   2026-10-12 → 13 pick   2026-10-09 → 13 pick   2026-10-08 → 8 pick
```

Lima tanggal, satu keranjang per cutoff. Yang dipilih (dipertahankan dari B20d): cutoff yang kandidatnya nol
→ **tanpa baris** di `plan_pick` ("tanggal ada" = "ada kandidat", bukan "ada hitungan"); `stock_plan` selalu
punya baris untuk setiap cutoff.

## 4. Tidak ada regresi nilai (AC 4)

| ticker | level sebelum | sesudah | identik |
|---|---|---|---|
| ASII | zona 4728,459 · stop 4606,754 · tp1 4976,0 · tp2 5317,985 | sama | ✅ (1e-9) |
| BBRI | `null` (rezim turun → tanpa level) | sama | ✅ |
| TLKM | `null` | sama | ✅ |

## 5. `/plan/picks?as_of=D` (AC 5)

```
2026-10-08 → as_of 2026-10-08 · screened 8   · picks 3
2026-10-09 → as_of 2026-10-09 · screened 13  · picks 3
2026-10-12 → as_of 2026-10-12 · screened 13  · picks 3
2026-10-13 → as_of 2026-10-13 · screened 5   · picks 3
2026-10-14 → as_of 2026-10-14 · screened 1   · picks 1
```

Tanggal yang diminta = tanggal yang dikembalikan, dan `screened` kini menyaring seluruh universe cutoff itu
(emiten yang tadinya jatuh ke keranjang tanggal lain tidak lagi hilang).

## 6. Catatan proses

- Migrasi 009 idempotent-safe (`ALTER TABLE … ADD COLUMN`, runner melewati `duplicate column name`); baris lama
  hasil run yang terbelah **tertimpa** oleh hitung ulang karena PK `(as_of_date, ticker)` — karena itu sekali
  `plan_days=5` dijalankan di DB dev seperti di atas.
- Test baru `backend/tests/test_b20e_as_of_cutoff.py` (2 test: satu cutoff satu keranjang + `last_bar_date`;
  level identik dua run) → **7 passed** bersama `test_b20d_plan_pick.py`.
- Gerbang penuh: lihat baris PROGRESS — 9 merah yang tersisa adalah test lama (4 jumlah tabel, 5 sudah merah
  sejak commit `c548b91`) dan tidak berhubungan dengan perubahan ini.
