"""Fixture pytest bersama: db sementara, file Excel kecil, config sementara."""

from __future__ import annotations

import yaml
import pytest

from backend.app import db
from backend.app.config import DEFAULT_CONFIG, get_settings
from backend.tests.fixtures import FIXTURE_SHEETS, write_xlsx


@pytest.fixture
def tmp_db(tmp_path):
    p = tmp_path / "rotation.db"
    db.init_db(p)
    return p


@pytest.fixture
def fixture_xlsx(tmp_path):
    return write_xlsx(tmp_path / "kecil.xlsx", FIXTURE_SHEETS)


@pytest.fixture
def tmp_config(tmp_path, monkeypatch):
    """Config sementara yang menunjuk db di tmp_path — supaya CLI/job tidak menyentuh data/rotation.db."""
    cfg = yaml.safe_load(DEFAULT_CONFIG.read_text(encoding="utf-8"))
    cfg["database"]["path"] = str(tmp_path / "rotation.db")
    path = tmp_path / "config.yaml"
    path.write_text(yaml.safe_dump(cfg), encoding="utf-8")
    monkeypatch.setenv("ROTATION_CONFIG", str(path))
    get_settings.cache_clear()
    db.init_db()
    yield tmp_path / "rotation.db"
    get_settings.cache_clear()
