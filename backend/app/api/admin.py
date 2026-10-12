"""Admin endpoints (docs/05 §4) — dipakai halaman Data (docs/08 F12), Hermes, dan CLI.

Semua endpoint tulis menerima `?async=true` → `202 {run_id, status:"queued"}`; tanpa flag,
job dijalankan sinkron dan hasilnya dikembalikan (dipakai CLI/curl).
"""

from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse

from .. import db, jobs
from ..config import get_settings
from ..ingest import excel
from ..repo import run as runs

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])
_API_VERSION = get_settings().app.api_version


def _error(status: int, code: str, message: str, detail: dict | None = None) -> HTTPException:
    return HTTPException(status, {"code": code, "message": message, "detail": detail or {}})


def _queued(run_id: int) -> JSONResponse:
    return JSONResponse(status_code=202, content={"api_version": _API_VERSION, "run_id": run_id, "status": "queued"})


@router.post("/import/excel")
async def import_excel(
    file: UploadFile = File(...),
    force: bool = False,
    strict: bool = False,
    async_: bool = Query(False, alias="async"),
):
    """Import master Excel. `?force=true` menimpa import dengan sha256 sama, `?strict=true` menolak sheet asing."""
    data = await file.read()
    filename = file.filename or "upload.xlsx"
    params = {"filename": filename, "force": force, "strict": strict, "bytes": len(data)}

    def job(_params: dict, _report) -> dict:
        return excel.import_excel(data, filename, force=force, strict=strict)

    try:
        run_id, result = jobs.execute("excel", params, job, async_=async_, triggered_by="api")
    except excel.AlreadyImported as exc:
        raise _error(409, "already_imported", str(exc), {"import_id": exc.import_id, "sha256": exc.sha256}) from exc
    except excel.UnknownSheet as exc:
        raise _error(400, "unknown_sheet", str(exc), {"sheet": exc.sheet}) from exc
    except excel.NoValidRows as exc:
        raise _error(400, "no_valid_rows", str(exc)) from exc

    return _queued(run_id) if result is None else result


@router.get("/runs")
def list_runs(limit: int = Query(20, ge=1, le=200)) -> dict:
    """Riwayat run terbaru (docs/05 §4.3) — untuk panel riwayat di halaman Data."""
    conn = db.connect()
    try:
        items = runs.list_recent(conn, limit)
    finally:
        conn.close()
    return {"api_version": _API_VERSION, "total": len(items), "items": items}


@router.get("/runs/{run_id}")
def get_run(run_id: int) -> dict:
    conn = db.connect()
    try:
        run = runs.get(conn, run_id)
    finally:
        conn.close()
    if run is None:
        raise _error(404, "run_not_found", f"run {run_id} tidak ada", {"run_id": run_id})
    return {"api_version": _API_VERSION, "run": run}
