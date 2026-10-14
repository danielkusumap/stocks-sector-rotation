"""FastAPI app — B0: /health + CORS untuk dev frontend (localhost:5173)."""

from __future__ import annotations

import secrets
import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import db
from .api import admin, briefing, meta, plan, rrg, sectors, stocks, ta, weekly
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
app.include_router(meta.router)
app.include_router(weekly.router)
app.include_router(rrg.router)
app.include_router(sectors.router)
app.include_router(stocks.router)
app.include_router(ta.router)
app.include_router(plan.router)
app.include_router(briefing.router)


@app.middleware("http")
async def admin_key_guard(request: Request, call_next):
    """docs/05 §4.5 — bila `config.api.api_key` diisi, semua `/api/v1/admin/*` wajib header `X-API-Key`.

    Dibaca per request (`get_settings()` sudah di-cache) supaya nilai dari environment deployment
    langsung berlaku tanpa menulis ulang config. Kosong = terbuka (pemakaian lokal single-user).
    """
    key = get_settings().api.api_key
    if key and request.url.path.startswith("/api/v1/admin"):
        provided = request.headers.get("x-api-key", "")
        if not secrets.compare_digest(provided, key):
            return JSONResponse(
                status_code=401,
                content={
                    "api_version": _settings.app.api_version,
                    "error": {"code": "unauthorized", "message": "header X-API-Key tidak sah", "detail": {}},
                },
            )
    return await call_next(request)


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
    """Bentuk error sesuai docs/05 §1 — tanpa stack trace."""
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "http_error", "message": str(exc.detail)}
    return JSONResponse(
        status_code=exc.status_code,
        content={"api_version": _settings.app.api_version, "error": detail},
    )


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """422 validasi query/body juga memakai envelope kontrak (docs/05 konvensi error)."""
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(p) for p in first.get("loc", []) if p != "query")
    return JSONResponse(
        status_code=422,
        content={
            "api_version": _settings.app.api_version,
            "error": {
                "code": "validation_error",
                "message": first.get("msg", "parameter tidak valid"),
                "detail": {"field": where, "errors": exc.errors()[:3]},
            },
        },
    )


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    """500 juga memakai envelope kontrak (tanpa stack trace ke klien)."""
    return JSONResponse(
        status_code=500,
        content={
            "api_version": _settings.app.api_version,
            "error": {"code": "internal_error", "message": f"{type(exc).__name__}: {exc}"[:200], "detail": {}},
        },
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
