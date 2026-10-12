# AGENTS.md — backend

Kamu bekerja di `backend/` (FastAPI + SQLite). Aturan lengkap ada di `../AGENTS.md`, task di `../docs/07-TASKS-BACKEND.md`.

Baca berurutan: `../docs/07-TASKS-BACKEND.md` → `../docs/05-API-CONTRACT.md` → `../docs/04-DATABASE-SCHEMA.md` → `../docs/03-METHODOLOGY.md` → `../docs/02-DATA-SOURCES.md` → `../config/default.yaml`.

Ringkas:
- Pakai skill **ponytail** (full).
- Stack: FastAPI, uvicorn, `sqlite3` stdlib (tanpa SQLAlchemy), pandas, numpy, yfinance, openpyxl, pydantic-settings, pytest.
- Semua angka ambang dari `../config/default.yaml`. Query SQL selalu pakai parameter binding.
- Selesai satu task → tulis bukti di `../docs/PROGRESS.md`, keputusan di `../docs/DECISIONS.md`.
- Jalankan: `python -m backend.cli --help` (lihat perintah yang tersedia di `docs/07`).
