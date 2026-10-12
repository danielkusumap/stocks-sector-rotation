"""Admin endpoints (docs/05 §4) — dipakai halaman Data (docs/08 F12), Hermes, dan CLI.

Semua endpoint tulis menerima `?async=true` → `202 {run_id, status:"queued"}`; tanpa flag,
job dijalankan sinkron dan hasilnya dikembalikan (dipakai CLI/curl).
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .. import db, jobs
from ..compute import signals
from ..config import get_settings
from ..ingest import excel, prices
from ..repo import run as runs
from ..repo import stock as stocks

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])
_API_VERSION = get_settings().app.api_version


class PricesBody(BaseModel):
    mode: str = "daily"
    from_: date | None = Field(None, alias="from")
    to: date | None = None
    sectors: list[str] | None = None
    tickers: list[str] | None = None
    refresh_info: bool = False  # `.info` per emiten (cross-check yahoo_sector) — mahal, default mati


class ComputeBody(BaseModel):
    stage: str = "all"
    timeframe: str = "d1"
    as_of: date | None = None


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


@router.post("/ingest/prices")
def ingest_prices(body: PricesBody, async_: bool = Query(False, alias="async")):
    """Unduh bar harian (`mode=daily`) untuk seluruh/ sebagian universe. Butuh tabel `stock` terisi."""
    if body.mode not in ("daily", "intraday"):
        raise _error(400, "invalid_mode", "mode harus 'daily' atau 'intraday'", {"received": body.mode})

    conn = db.connect()
    try:
        has_universe = stocks.active_count(conn) > 0
    finally:
        conn.close()
    if not has_universe:
        raise _error(409, "prereq_no_universe", "tabel stock kosong — jalankan 'Import sektor' dulu")

    params = {
        "mode": body.mode,
        "from": body.from_.isoformat() if body.from_ else None,
        "to": body.to.isoformat() if body.to else None,
        "sectors": body.sectors,
        "tickers": body.tickers,
        "refresh_info": body.refresh_info,
    }

    def job(p: dict, report) -> dict:
        if p["mode"] == "intraday":
            return prices.ingest_intraday(sectors=p["sectors"], tickers=p["tickers"], report=report)
        return prices.ingest_daily(
            from_date=p["from"],
            to_date=p["to"],
            sectors=p["sectors"],
            tickers=p["tickers"],
            refresh_info=p["refresh_info"],
            report=report,
        )

    run_id, result = jobs.execute(f"prices_{body.mode}", params, job, async_=async_, triggered_by="api")
    return _queued(run_id) if result is None else result


@router.post("/compute")
def compute(body: ComputeBody, async_: bool = Query(False, alias="async")):
    """Stage hitung (`index` sekarang; `rrg`/`signals` menyusul). Prasyarat: `price_daily` cukup terisi."""
    cfg = get_settings()
    if body.stage not in ("index", "rrg", "signals", "all"):
        raise _error(400, "invalid_stage", "stage harus index | rrg | signals | all", {"received": body.stage})
    if body.timeframe not in cfg.timeframes["allowed"]:
        raise _error(
            400,
            "invalid_timeframe",
            f"timeframe harus salah satu dari: {', '.join(cfg.timeframes['allowed'])}",
            {"received": body.timeframe},
        )
    if body.stage == "signals" or body.timeframe == "w1_fri":
        gate = signals.gate_final_week(cfg)
        if gate["gate"] != "ok":
            raise _error(
                409,
                "gate_weekly_not_final",
                "sinyal mingguan (w1_fri) dihitung setelah penutupan Jumat (Sabtu/Minggu juga boleh)",
                gate,
            )

    conn = db.connect()
    try:
        coverage = stocks.prices_coverage(conn)
    finally:
        conn.close()
    if coverage < cfg.universe["min_prices_coverage"]:
        raise _error(
            409,
            "prereq_no_prices",
            "jalankan 'Ambil harga harian' dulu: baru "
            f"{coverage * 100:.0f}% emiten aktif punya bar harga (minimum {cfg.universe['min_prices_coverage'] * 100:.0f}%)",
            {"coverage": round(coverage, 3), "min_coverage": cfg.universe["min_prices_coverage"]},
        )

    params = {"stage": body.stage, "timeframe": body.timeframe, "as_of": body.as_of.isoformat() if body.as_of else None}
    run_id, result = jobs.execute(f"compute_{body.stage}", params, jobs.compute, async_=async_, triggered_by="api")
    return _queued(run_id) if result is None else result


@router.post("/midday")
def midday(async_: bool = Query(False, alias="async")):
    """Gate kesegaran sesi 1 → kalau lolos: ingest intraday + hitung ulang. Gate gagal = **200** `stale`."""
    run_id, result = jobs.execute("midday", {"mode": "midday"}, jobs.midday, async_=async_, triggered_by="api")
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
