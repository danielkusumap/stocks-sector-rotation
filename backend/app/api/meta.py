"""Endpoint baca meta & kesegaran data (docs/05 §1)."""

from __future__ import annotations

from fastapi import APIRouter

from .. import db
from ..config import get_settings
from ..ingest import freshness

router = APIRouter(prefix="/api/v1", tags=["meta"])
_API_VERSION = get_settings().app.api_version


@router.get("/freshness")
def get_freshness() -> dict:
    """Status gate `midday` + kesegaran bar harian. Selalu 200 — kesegaran ada di body."""
    conn = db.connect()
    try:
        data = freshness.read(conn)
    finally:
        conn.close()
    return {"api_version": _API_VERSION, **data}
