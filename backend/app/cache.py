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


def put(endpoint: str, params: dict, as_of: str | None, value) -> None:
    ttl = get_settings().api.cache_ttl_seconds
    _store[key(endpoint, params, as_of)] = (time.monotonic() + ttl, value)


def clear() -> None:
    _store.clear()
