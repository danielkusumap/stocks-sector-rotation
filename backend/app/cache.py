"""Cache in-process untuk endpoint berat (docs/07 B8): kunci (endpoint, params, as_of), TTL dari config."""

from __future__ import annotations

import time

from .config import get_settings

_store: dict[tuple, tuple[float, object]] = {}


def key(endpoint: str, params: dict, as_of: str | None) -> tuple:
    return (endpoint, tuple(sorted((k, str(v)) for k, v in params.items() if k != "format")), as_of)


def get(endpoint: str, params: dict, as_of: str | None):
    entry = _store.get(key(endpoint, params, as_of))
    if entry is None:
        return None
    expires_at, value = entry
    if expires_at < time.monotonic():
        return None
    return value


def put(endpoint: str, params: dict, as_of: str | None, value, ttl: float | None = None) -> None:
    ttl = get_settings().api.cache_ttl_seconds if ttl is None else ttl
    _store[key(endpoint, params, as_of)] = (time.monotonic() + ttl, value)


def age(endpoint: str, params: dict, as_of: str | None, ttl: float) -> float | None:
    """Umur entri cache (detik, dibulatkan) — `None` kalau tidak ada/kedaluwarsa (dipakai `meta/market`)."""
    entry = _store.get(key(endpoint, params, as_of))
    if entry is None:
        return None
    expires_at, _ = entry
    remaining = expires_at - time.monotonic()
    return None if remaining < 0 else round(max(0.0, ttl - remaining))


def clear() -> None:
    _store.clear()
