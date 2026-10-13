"""Config loader — config/default.yaml adalah satu-satunya sumber angka ambang.

Path bisa di-override lewat env `ROTATION_CONFIG` (dipakai `cli.py --config`).
Section yang belum dipakai task mana pun tetap bisa dibaca mentah (`extra="allow"`),
jadi menambah key di YAML tidak perlu mengubah file ini.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
    YamlConfigSettingsSource,
)

ROOT = Path(__file__).resolve().parents[2]  # root repo
DEFAULT_CONFIG = ROOT / "config" / "default.yaml"


def config_path() -> Path:
    return Path(os.environ.get("ROTATION_CONFIG") or DEFAULT_CONFIG)


class AppCfg(BaseModel):
    name: str
    timezone: str
    api_version: str


class DatabaseCfg(BaseModel):
    path: str
    journal_mode: str
    busy_timeout_ms: int


class ApiCfg(BaseModel):
    host: str
    port: int
    cors_origins: list[str]
    cache_ttl_seconds: int
    api_key: str = ""
    backup_enabled: bool = True


class MarketCfg(BaseModel):
    """Kutipan IHSG di halaman Overview (docs/05 §1 `/meta/market`). Hanya benchmark, tidak untuk emiten."""

    live_enabled: bool
    live_ttl_seconds: int
    poll_seconds: int
    move_flat_pct: float


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="allow")

    app: AppCfg
    database: DatabaseCfg
    api: ApiCfg
    market: MarketCfg

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (
            init_settings,
            YamlConfigSettingsSource(settings_cls, yaml_file=config_path()),
            env_settings,
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
