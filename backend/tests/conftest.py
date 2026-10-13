"""Fixture pytest bersama: db sementara, file Excel kecil, config sementara."""

from __future__ import annotations

import shutil
import sqlite3

import yaml
import pytest

from backend.app import db
from backend.app.config import DEFAULT_CONFIG, get_settings
from backend.tests.fixtures import FIXTURE_SHEETS, write_xlsx


def _copy_db(src, dst) -> None:
    """Salin DB lewat API backup sqlite3 (aman terhadap mode WAL)."""
    with sqlite3.connect(src) as source, sqlite3.connect(dst) as target:
        source.backup(target)


@pytest.fixture(scope="session")
def template_db(tmp_path_factory):
    """Skema + master sektor dibangun SEKALI per sesi uji; tiap test menyalinnya (docs/07 B23)."""
    path = tmp_path_factory.mktemp("template") / "rotation.db"
    db.init_db(path)
    return path


@pytest.fixture
def tmp_db(tmp_path, template_db):
    p = tmp_path / "rotation.db"
    _copy_db(template_db, p)
    return p


@pytest.fixture
def fixture_xlsx(tmp_path):
    return write_xlsx(tmp_path / "kecil.xlsx", FIXTURE_SHEETS)


@pytest.fixture
def tmp_config(tmp_path, template_db, monkeypatch):
    """Config sementara yang menunjuk db di tmp_path — supaya CLI/job tidak menyentuh data/rotation.db.

    DB disalin dari template sesi (bukan `db.init_db()` tiap test): skema+migrasi+seed dibangun sekali
    per sesi (docs/07 B23), sementara isi config tetap ditulis per test karena `database.path` berbeda.
    """
    cfg = yaml.safe_load(DEFAULT_CONFIG.read_text(encoding="utf-8"))
    db_file = tmp_path / "rotation.db"
    _copy_db(template_db, db_file)
    cfg["database"]["path"] = str(db_file)
    path = tmp_path / "config.yaml"
    path.write_text(yaml.safe_dump(cfg), encoding="utf-8")
    monkeypatch.setenv("ROTATION_CONFIG", str(path))
    get_settings.cache_clear()
    yield db_file
    get_settings.cache_clear()
