"""FastAPI app — B0: /health + CORS untuk dev frontend (localhost:5173)."""

from __future__ import annotations

import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import db
from .api import admin
from .config import get_settings

_settings = get_settings()
_started_at = time.monotonic()

app = FastAPI(title=_settings.app.name, version=_settings.app.api_version)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.api.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(admin.router)


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
    """Bentuk error sesuai docs/05 §1 — tanpa stack trace."""
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "http_error", "message": str(exc.detail)}
    return JSONResponse(
        status_code=exc.status_code,
        content={"api_version": _settings.app.api_version, "error": detail},
    )


@app.get("/health")
def health() -> dict:
    """Selalu 200 — kesegaran data dilaporkan di body, bukan lewat kode error."""
    status, tables, detail = "ok", 0, None
    try:
        conn = db.connect()
        try:
            tables = db.table_count(conn)
        finally:
            conn.close()
    except Exception as exc:  # DB hilang/terkunci: lapor, jangan lempar stack trace
        status, detail = "error", str(exc)[:200]
    return {
        "api_version": _settings.app.api_version,
        "status": status,
        "db": status,
        "tables": tables,
        "detail": detail,
        "uptime_s": int(time.monotonic() - _started_at),
    }
