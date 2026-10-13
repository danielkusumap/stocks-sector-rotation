"""D — `GET /api/v1/meta/market`: kutipan IHSG (DB / live + cache TTL + fallback). docs/05 §1.

Hanya benchmark: tidak ada jalur kutipan live untuk emiten/sektor (dijaga `test_market_hanya_benchmark`).
"""

from __future__ import annotations

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app import cache, db
from backend.app.api import meta
from backend.app.config import get_settings
from backend.tests.test_b8_read import read_db  # noqa: F401

SYMBOL = "^JKSE"
FIELDS = ("Open", "High", "Low", "Close", "Adj Close", "Volume")
QUOTE_FIELDS = {
    "api_version", "benchmark", "symbol", "close", "prev_close", "ret_1d", "ret_1w", "ret_intraday",
    "open", "high", "low", "volume", "as_of", "last_bar_at", "session", "source", "delayed", "cached",
    "cache_age_s", "data_status",
}


def _frame(closes: list[float], index=None) -> pd.DataFrame:
    """Tiruan keluaran `yf.download(group_by='ticker')` untuk `^JKSE`."""
    index = pd.DatetimeIndex(pd.bdate_range("2026-09-16", periods=len(closes))) if index is None else index
    data = {}
    for field in FIELDS:
        data[(SYMBOL, field)] = closes if field in ("Close", "Adj Close") else [c - 1 for c in closes]
    return pd.DataFrame(data, index=index).sort_index(axis=1)


DAILY = [5900.0, 5950.0, 6000.0, 6050.0, 6100.0, 6093.0, 5936.0, 5911.0]


def _patch_fetch(monkeypatch, *, daily, intraday=None, calls: list | None = None):
    """Ganti `prices.fetch` — tidak menyentuh jaringan, tanpa sleep retry."""

    def fake(symbols, start, end, **kw):
        if calls is not None:
            calls.append(kw.get("interval"))
        if kw.get("interval") == "5m":
            return intraday
        return daily

    monkeypatch.setattr(meta.prices, "fetch", fake)


@pytest.fixture
def client(read_db, monkeypatch):
    monkeypatch.setattr(db, "db_path", lambda: read_db)
    cache.clear()
    from backend.app.main import app

    yield TestClient(app)
    cache.clear()


def test_market_live_cache(client, monkeypatch):
    """2 poll dalam TTL → Yahoo dihubungi 1×, respons kedua `cached: true` + `cache_age_s` (docs/05 §1)."""
    monkeypatch.setattr(meta, "session_now", lambda tz: "closed")
    calls: list[str] = []
    _patch_fetch(monkeypatch, daily=_frame(DAILY), calls=calls)

    first = client.get("/api/v1/meta/market?live=true").json()
    second = client.get("/api/v1/meta/market?live=true").json()

    assert set(first) == QUOTE_FIELDS
    assert first["api_version"] == "1.1" and first["benchmark"] == "IHSG" and first["symbol"] == SYMBOL
    assert first["source"] == "live" and first["cached"] is False and first["cache_age_s"] == 0
    assert first["delayed"] is True  # feed Yahoo IDX selalu delay
    assert first["close"] == DAILY[-1] and first["prev_close"] == DAILY[-2]
    assert first["ret_1d"] == pytest.approx(DAILY[-1] / DAILY[-2] - 1)
    assert first["ret_1w"] == pytest.approx(DAILY[-1] / DAILY[-6] - 1)
    assert first["last_bar_at"] == f"{first['as_of']}T16:00:00+07:00"

    assert second["cached"] is True and isinstance(second["cache_age_s"], int) and second["cache_age_s"] >= 0
    assert second["close"] == first["close"]
    assert calls == ["1d"], f"Yahoo harus 1× saja dalam TTL, dipanggil: {calls}"


def test_market_fallback_db_saat_gagal(client, monkeypatch):
    """Fetch live gagal → tetap 200, `source: db`, `data_status.status: stale` + detail manusiawi."""
    monkeypatch.setattr(meta, "session_now", lambda tz: "closed")
    _patch_fetch(monkeypatch, daily=None)  # gagal total (prices.fetch mengembalikan None)

    response = client.get("/api/v1/meta/market?live=true")
    body = response.json()

    assert response.status_code == 200
    assert body["source"] == "db" and body["delayed"] is True and body["cached"] is False
    assert body["data_status"]["status"] == "stale"
    assert body["data_status"]["detail"] == "live gagal, memakai data tersimpan"
    assert body["close"] is not None  # nilai tersimpan tetap dipakai


def test_ret_intraday_null_saat_closed(client, monkeypatch):
    """`ret_intraday` = close/prev_close − 1 saat jam bursa; `null` di luar jam bursa (docs/05 §1)."""
    _patch_fetch(monkeypatch, daily=_frame(DAILY))
    monkeypatch.setattr(meta, "session_now", lambda tz: "closed")
    closed = client.get("/api/v1/meta/market?live=true").json()
    assert closed["session"] == "closed" and closed["ret_intraday"] is None
    assert closed["ret_1d"] is not None  # perubahan harian tetap dilaporkan

    cache.clear()
    intraday = _frame(
        [5905.0, 5912.0],
        index=pd.DatetimeIndex(
            [pd.Timestamp("2026-10-14 14:30", tz="Asia/Jakarta"), pd.Timestamp("2026-10-14 14:35", tz="Asia/Jakarta")]
        ),
    )
    _patch_fetch(monkeypatch, daily=_frame(DAILY), intraday=intraday)
    monkeypatch.setattr(meta, "session_now", lambda tz: "open")
    during = client.get("/api/v1/meta/market?live=true").json()

    assert during["session"] == "open"
    assert during["close"] == 5912.0 and during["last_bar_at"] == "2026-10-14T14:35:00+07:00"
    assert during["ret_intraday"] == pytest.approx(during["ret_1d"])


def test_market_db_default_dan_meta_config(client):
    """`live=false` (default) → `source: db`; `/meta/config` mengekspos knob poll kutipan."""
    body = client.get("/api/v1/meta/market").json()
    assert body["source"] == "db" and body["api_version"] == "1.1"
    assert body["data_status"]["range_from"] == body["as_of"] == body["last_bar_at"][:10]
    assert body["close"] is not None and body["prev_close"] is not None

    cfg = get_settings().market
    limits = client.get("/api/v1/meta/config").json()["market"]
    assert limits == {
        "live_enabled": cfg.live_enabled,
        "live_ttl_seconds": cfg.live_ttl_seconds,
        "poll_seconds": cfg.poll_seconds,
        "move_flat_pct": cfg.move_flat_pct,
    }


def test_market_hanya_benchmark(client, monkeypatch):
    """Tidak ada jalur kutipan live untuk emiten/sektor: `ticker`/`code` tidak berpengaruh (docs/05 §1)."""
    monkeypatch.setattr(meta, "session_now", lambda tz: "closed")
    calls: list[tuple] = []

    def fake(symbols, start, end, **kw):
        calls.append(tuple(symbols))
        return _frame(DAILY)

    monkeypatch.setattr(meta.prices, "fetch", fake)
    body = client.get("/api/v1/meta/market?live=true&ticker=BBRI&code=IDXFINANCE&sector=IDXFINANCE").json()
    assert body["benchmark"] == "IHSG" and body["symbol"] == SYMBOL
    assert set(calls) == {(SYMBOL,)}  # simbol yang diminta ke Yahoo selalu benchmark
