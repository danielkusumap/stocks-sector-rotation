# syntax=docker/dockerfile:1
# Backend FastAPI + SQLite (Sector Rotation IDX).
# Build context = ROOT repo (butuh `config/` + `saham_sektoral.xlsx`), lihat docker-compose.yml.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=Asia/Jakarta \
    ROTATION_CONFIG=/app/config/default.yaml \
    DATABASE__PATH=/app/data/rotation.db \
    API__HOST=0.0.0.0 \
    API__PORT=8000

# tzdata: `zoneinfo.ZoneInfo("Asia/Jakarta")` dipakai api/meta.py, compute/plan.py, compute/midday.py.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Editable install, bukan copy ke site-packages: `backend/app/config.py` menghitung root repo dari
# lokasi file (`Path(__file__).parents[2]`) → kode harus tetap di /app/backend agar config/ & data/ ketemu.
COPY backend/ ./backend/
RUN pip install --no-cache-dir -e ./backend

COPY config/ ./config/
COPY saham_sektoral.xlsx ./
RUN mkdir -p /app/data

# SQLite + hasil ingest hidup di sini; pasang volume (docker-compose.yml) agar tidak hilang saat redeploy.
VOLUME ["/app/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

# `db-init` idempotent (skema + migrasi) lalu serve. Satu worker wajib: job ingest berjalan di thread
# proses ini (`app/jobs.py`), multi-worker akan menggandakan run dan menulis SQLite bersamaan.
CMD ["sh", "-c", "python -m backend.cli db-init && exec uvicorn backend.app.main:app --host ${API__HOST:-0.0.0.0} --port ${API__PORT:-8000} --workers 1"]
