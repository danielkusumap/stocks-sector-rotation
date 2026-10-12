"""CLI backend — dijalankan dari root repo: `python -m backend.cli <cmd>`.

Setiap perintah job memakai fungsi yang sama dengan API (`app/jobs.py`), jadi CLI dan tombol
di halaman Data meninggalkan baris `ingest_run` dengan bentuk yang sama.
Perintah lain (compute, midday) menyusul di task B4–B10.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .app import db, jobs
from .app.config import ROOT, get_settings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m backend.cli", description="Sector Rotation IDX — CLI backend")
    parser.add_argument("--config", help="path file config YAML (default: config/default.yaml)")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("db-init", help="buat/perbarui skema di data/rotation.db")
    p_import = sub.add_parser("import-excel", help="import universe saham dari file Excel")
    p_import.add_argument("path", nargs="?", help="file .xlsx (default: config.universe.excel_path)")
    p_import.add_argument("--force", action="store_true", help="import ulang walau sha256 file sama")
    p_import.add_argument("--strict", action="store_true", help="gagalkan bila ada sheet di luar 11 kode sektor")
    p_prices = sub.add_parser("ingest-prices", help="unduh harga dari Yahoo ke price_daily")
    p_prices.add_argument("--mode", choices=["daily", "intraday"], default="daily", help="daily (default) atau intraday")
    p_prices.add_argument("--from", dest="from_date", help="tanggal mulai YYYY-MM-DD (default: hari ini - daily_lookback_days)")
    p_prices.add_argument("--to", dest="to_date", help="tanggal akhir YYYY-MM-DD (default: hari ini)")
    p_prices.add_argument("--tickers", help="subset emiten, mis. BBCA,BBRI,ANTM (default: seluruh universe aktif)")
    p_prices.add_argument("--sectors", help="batasi ke kode sektor, mis. IDXFINANCE,IDXENERGY")
    p_prices.add_argument("--refresh-info", action="store_true", help="sekali pakai: ambil yahoo_sector lewat .info")
    sub.add_parser("serve", help="jalankan API di host:port dari config")
    args = parser.parse_args(argv)

    if args.config:
        os.environ["ROTATION_CONFIG"] = args.config

    api_version = get_settings().app.api_version

    if args.command == "db-init":
        info = db.init_db()
        info["api_version"] = api_version
        print(json.dumps(info, ensure_ascii=False))
        return 0

    if args.command == "import-excel":
        from .app.ingest import excel

        path = Path(args.path) if args.path else ROOT / get_settings().universe["excel_path"]
        data = path.read_bytes()
        params = {"filename": path.name, "force": args.force, "strict": args.strict, "bytes": len(data)}
        try:
            _, result = jobs.execute(
                "excel",
                params,
                lambda p, _report: excel.import_excel(data, p["filename"], force=p["force"], strict=p["strict"]),
                triggered_by="cli",
            )
        except (excel.AlreadyImported, excel.UnknownSheet, excel.NoValidRows) as exc:
            codes = {"AlreadyImported": "already_imported", "UnknownSheet": "unknown_sheet", "NoValidRows": "no_valid_rows"}
            err = {"code": codes[type(exc).__name__], "message": str(exc)}
            print(json.dumps({"api_version": api_version, "error": err}, ensure_ascii=False), file=sys.stderr)
            return 1
        result["api_version"] = api_version
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    if args.command == "ingest-prices":
        from .app.ingest import prices
        from .app.repo import stock as stocks

        if args.mode == "intraday":
            print(
                json.dumps(
                    {"api_version": api_version, "error": {"code": "not_implemented", "message": "mode intraday menyusul di task B3"}},
                    ensure_ascii=False,
                ),
                file=sys.stderr,
            )
            return 1

        conn = db.connect()
        try:
            has_universe = stocks.active_count(conn) > 0
        finally:
            conn.close()
        if not has_universe and not args.tickers:
            err = {"code": "prereq_no_universe", "message": "tabel stock kosong — jalankan `import-excel` dulu"}
            print(json.dumps({"api_version": api_version, "error": err}, ensure_ascii=False), file=sys.stderr)
            return 1

        params = {
            "mode": args.mode,
            "from": args.from_date,
            "to": args.to_date,
            "sectors": args.sectors.split(",") if args.sectors else None,
            "tickers": args.tickers.split(",") if args.tickers else None,
            "refresh_info": args.refresh_info,
        }
        _, result = jobs.execute(
            f"prices_{args.mode}",
            params,
            lambda p, report: prices.ingest_daily(
                from_date=p["from"],
                to_date=p["to"],
                sectors=p["sectors"],
                tickers=p["tickers"],
                refresh_info=p["refresh_info"],
                report=report,
            ),
            triggered_by="cli",
        )
        result["api_version"] = api_version
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    if args.command == "serve":
        import uvicorn

        from .app.main import app

        cfg = get_settings().api
        uvicorn.run(app, host=cfg.host, port=cfg.port)
        return 0

    return 2


if __name__ == "__main__":
    sys.exit(main())
