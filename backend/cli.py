"""CLI backend — dijalankan dari root repo: `python -m backend.cli <cmd>`.

Perintah lain (import-excel, ingest-prices, compute, midday) menyusul di task B1–B10.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from .app import db


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m backend.cli", description="Sector Rotation IDX — CLI backend")
    parser.add_argument("--config", help="path file config YAML (default: config/default.yaml)")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("db-init", help="buat/perbarui skema di data/rotation.db")
    sub.add_parser("serve", help="jalankan API di host:port dari config")
    args = parser.parse_args(argv)

    if args.config:
        os.environ["ROTATION_CONFIG"] = args.config

    if args.command == "db-init":
        from .app.config import get_settings

        info = db.init_db()
        info["api_version"] = get_settings().app.api_version
        print(json.dumps(info, ensure_ascii=False))
        return 0

    if args.command == "serve":
        import uvicorn

        from .app.config import get_settings
        from .app.main import app

        cfg = get_settings().api
        uvicorn.run(app, host=cfg.host, port=cfg.port)
        return 0

    return 2


if __name__ == "__main__":
    sys.exit(main())
