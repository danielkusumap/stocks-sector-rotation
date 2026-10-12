# Backend — Sector Rotation IDX

FastAPI + SQLite + CLI untuk rotasi sektor IDX. **Angka muncul hanya lewat pipeline**, bukan
dihitung di frontend: `import Excel → ingest harga → compute → serve`.

Kontrak API beku: `docs/05-API-CONTRACT.md`. Rumus: `docs/03-METHODOLOGY.md`. Ambang batas:
`config/default.yaml` (satu-satunya tempat angka ambang, tidak ada yang di-hardcode).

## 1. Pasang

Dari **root repo** (bukan dari `backend/`):

```bash
python -m venv .venv
.venv/Scripts/python.exe -m pip install -e backend                 # Windows (git-bash/PowerShell)
.venv/Scripts/python.exe -m pip install -e "backend[dev]"         # + pytest & httpx untuk test
# .venv/bin/python -m pip install -e "backend[dev]"               # Linux/macOS
```

Dependensi: `fastapi`, `uvicorn[standard]`, `pydantic-settings`, `pyyaml`, `pandas`, `numpy`,
`yfinance`, `openpyxl`, `python-multipart`; `backend[dev]` menambah `pytest` + `httpx`.

Semua perintah CLI dijalankan dari root repo: `.venv/Scripts/python.exe -m backend.cli <perintah>`.

## 2. Alur dari terminal (urut)

```bash
# 1) Skema + 11 sektor master (idempoten, aman diulang)
python -m backend.cli db-init

# 2) Universe dari Excel (default: config.universe.excel_path = saham_sektoral.xlsx)
python -m backend.cli import-excel                  # file dari config
python -m backend.cli import-excel --path lain.xlsx --force --strict

# 3) Harga harian (Yahoo). Backfill penuh 962 emiten ± 1,5 menit — jalankan untuk SUBSET saat uji:
#    RRG butuh riwayat minimal `rrg.min_points` (d1: 60 bar ≈ 3 bulan bursa); jendela lebih pendek
#    menghasilkan tabel kosong, bukan error.
python -m backend.cli ingest-prices --mode daily --from 2025-06-01 --to 2026-10-13 --tickers BMHS,RSGK

# 4) Turunan: indeks sektor → RRG (+metrik & skor) → sinyal mingguan
python -m backend.cli compute --stage index                       # sector_index_daily (3 bobot)
python -m backend.cli compute --stage rrg   --timeframe d1        # rrg_daily + metrics + scores
python -m backend.cli compute --stage rrg   --timeframe w1
python -m backend.cli compute --stage signals --timeframe w1_fri  # hanya Jumat ≥ 16:15 / Sabtu / Minggu
python -m backend.cli compute --stage all                          # semua di atas (d1 + w1 + sinyal)

# 5) Tengah hari: gate kesegaran → ingest intraday → RRG/metrik timeframe 'midday'
python -m backend.cli midday

# 6) Perawatan: pangkas bar intraday & baris midday lama, VACUUM bila berkas besar
python -m backend.cli retention

# 7) Sajikan API (host/port dari config.api)
python -m backend.cli serve
```

Override config tanpa mengedit YAML:

```bash
python -m backend.cli --config C:/path/ke/config.yaml compute --stage index
ROTATION_CONFIG=C:/path/ke/config.yaml python -m backend.cli compute --stage index
```

**Kenapa `compute` bisa ditolak:** `409 prereq_no_prices` bila `price_daily` belum terisi untuk
sebagian besar emiten aktif (`universe.min_prices_coverage`), dan `409 gate_weekly_not_final` untuk
timeframe `w1_fri` di luar penutupan Jumat. Saat development, pakai salinan config dengan ambang
prasyarat dikecilkan — mis. 2 emiten dari 962 = 0,2% sehingga butuh
`universe.min_prices_coverage: 0.001` — **jangan** mengubah `config/default.yaml` yang di-commit:

```bash
python - <<'PY'
import yaml, pathlib
cfg = yaml.safe_load(pathlib.Path('config/default.yaml').read_text(encoding='utf-8'))
cfg['universe']['min_prices_coverage'] = 0.001
pathlib.Path('cfg-uji.yaml').write_text(yaml.safe_dump(cfg), encoding='utf-8')
PY
ROTATION_CONFIG=cfg-uji.yaml python -m backend.cli compute --stage index
```

## 3. Contoh `curl` (server sedang jalan)

```bash
curl -s http://127.0.0.1:8000/health
curl -s http://127.0.0.1:8000/api/v1/meta/config
curl -s http://127.0.0.1:8000/api/v1/meta/sectors
curl -s 'http://127.0.0.1:8000/api/v1/rrg?timeframe=w1&window=3m'
curl -s 'http://127.0.0.1:8000/api/v1/rrg?scope=stock&sector=IDXTRANS&limit=25'
curl -s 'http://127.0.0.1:8000/api/v1/sectors/summary?timeframe=w1&quadrant=leading,improving&min_streak=1&sort=score'
curl -s http://127.0.0.1:8000/api/v1/sectors/IDXTRANS
curl -s 'http://127.0.0.1:8000/api/v1/stocks?sector=IDXTRANS&limit=10'
curl -s http://127.0.0.1:8000/api/v1/stocks/MPXL
curl -s http://127.0.0.1:8000/api/v1/rotation/matrix
curl -s http://127.0.0.1:8000/api/v1/heatmap
curl -s 'http://127.0.0.1:8000/api/v1/series/sector/IDXTRANS?from=2026-09-01'
curl -s http://127.0.0.1:8000/api/v1/weekly/picks
curl -s http://127.0.0.1:8000/api/v1/briefing/morning          # satu panggilan untuk report pagi
curl -s http://127.0.0.1:8000/api/v1/freshness

# pipeline (tanpa ?async=true → menunggu selesai, bentuk hasil sama seperti CLI)
curl -s -X POST http://127.0.0.1:8000/api/v1/admin/compute -H 'content-type: application/json' \
     -d '{"stage":"rrg","timeframe":"d1"}'
# pipeline async (dipakai tombol UI): 202 {run_id} → poll tiap 1 detik
curl -s -X POST 'http://127.0.0.1:8000/api/v1/admin/ingest/prices?async=true' \
     -H 'content-type: application/json' -d '{"mode":"daily","tickers":["BMHS","RSGK"]}'
curl -s http://127.0.0.1:8000/api/v1/admin/runs/7
curl -s 'http://127.0.0.1:8000/api/v1/admin/runs?limit=20'

# perawatan
curl -s -X POST http://127.0.0.1:8000/api/v1/admin/retention
curl -s -o rotation-backup.db http://127.0.0.1:8000/api/v1/admin/export/backup
sqlite3 rotation-backup.db "PRAGMA integrity_check"     # harus 'ok'
```

Semua `POST /api/v1/admin/*` juga tersedia dari halaman **Data** di frontend (7 tombol:
import → harga harian → intraday → hitung semua → hitung mingguan → tengah hari → refresh).

## 4. Test

```bash
.venv/Scripts/python.exe -m pytest -q          # 128 test, tanpa jaringan (Yahoo dipalsukan)
```

Test wajib `docs/03` §9 ada dengan nama persis: `test_index_equal_weight`, `test_rrg_quadrant`,
`test_rrg_warmup`, `test_resample_wfri`, `test_weekly_rules`, `test_streak`
(`pytest -k test_weekly_rules`).

## 5. Peta folder

```
backend/
  cli.py                 CLI (semua perintah di atas)
  app/
    main.py              FastAPI + envelope error (400/404/409/422/500)
    config.py            loader config/default.yaml (+ env ROTATION_CONFIG)
    db.py                koneksi, PRAGMA, db-init, runner migrasi
    db/schema.sql        DDL docs/04 (13 tabel) + seed_sectors.sql + migrations/NNN_*.sql
    jobs.py              SATU jalur job untuk CLI + API (kind baku docs/05 §4.6)
    maintenance.py       retention (pangkas intraday/midday + VACUUM)
    ingest/              excel.py, prices.py, freshness.py (Yahoo hanya di sini)
    compute/             index.py, indicators.py, rrg.py, metrics.py, signals.py, midday.py
    repo/                query baca/tulis (stock.py, run.py, read.py)
    api/                 admin.py, meta.py, rrg.py, sectors.py, stocks.py, weekly.py, briefing.py, schemas.py
  tests/                 pytest + fixtures.py (data kecil, Yahoo dipalsukan)
```

## 6. Hal yang perlu diketahui saat membaca angka

- Zona waktu tunggal **Asia/Jakarta (UTC+7)**; tanggal bisnis `YYYY-MM-DD` WIB.
- Angka di UI/`rationale` berformat Indonesia (titik ribuan, koma desimal).
- Data development baru sebagian universe (mis. 185 dari 962 emiten) sehingga skor, kuadran, dan
  regime akan bergeser setelah backfill penuh dijalankan user.
- Keputusan yang menyimpang dari dokumen planning dicatat di `docs/DECISIONS.md` (ADR) dan status
  tiap task + bukti nyata ada di `docs/PROGRESS.md`.
