"""Admin endpoints (docs/05 §4) — dipakai user/Hermes lewat curl/CLI, bukan frontend."""

from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile

from ..ingest import excel

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


def _error(status: int, code: str, message: str, detail: dict | None = None) -> HTTPException:
    return HTTPException(status, {"code": code, "message": message, "detail": detail or {}})


@router.post("/import/excel")
async def import_excel(
    file: UploadFile = File(...),
    force: bool = False,
    strict: bool = False,
) -> dict:
    """Import master Excel. `?force=true` menimpa import dengan sha256 sama, `?strict=true` menolak sheet asing."""
    data = await file.read()
    try:
        return excel.import_excel(data, file.filename or "upload.xlsx", force=force, strict=strict)
    except excel.AlreadyImported as exc:
        raise _error(
            409,
            "already_imported",
            str(exc),
            {"import_id": exc.import_id, "sha256": exc.sha256},
        ) from exc
    except excel.UnknownSheet as exc:
        raise _error(400, "unknown_sheet", str(exc), {"sheet": exc.sheet}) from exc
    except excel.NoValidRows as exc:
        raise _error(400, "no_valid_rows", str(exc)) from exc
