"""B20 — `stock_plan` untuk semua emiten + `/plan/stock/{ticker}` (docs/03 §6.5, §10.9)."""

from __future__ import annotations

import json

import pandas as pd
from fastapi.testclient import TestClient

from backend.app import db
from backend.app.compute import plan, signals
from backend.app.config import get_settings
from backend.tests.test_b18_plan import RAW_TERMS, _cfg_with, make_bars, metrics
from backend.tests.test_b7_signals import DATES, _seed, _wiggle, signal_inputs, weekly_db  # noqa: F401 (fixture)


def _events(entry_dates: list[str], entry_price: float = 100.0) -> list[dict]:
    """Event `ta_breakout` versi uji (kolom yang dibaca `scenario`)."""
    return [
        {"entry_date": date, "entry_price": entry_price, "result": "win"} for date in entry_dates[:8]
    ] * 2


def _ramp_bars(start: float = 100.0, step: float = 0.5, count: int = 70) -> pd.DataFrame:
    return make_bars([start + step * index for index in range(count)])


# --- §10.9 `first_touch` (urutan, bukan MFE) ---------------------------------


def test_first_touch_urutan():
    """Bar 3 menyentuh target lalu bar 5 menyentuh batas rugi → yang lebih dulu = target, periode 3."""
    closes = [100.0, 100.0, 100.0, 106.0, 103.0, 94.0, 95.0]
    bars = make_bars(closes)
    touch, periods = plan.first_touch(bars, bars["date"].iloc[0], 0.05, 0.05, 60, entry_price=100.0)
    assert (touch, periods) == ("up", 3)
    touch, periods = plan.first_touch(bars, bars["date"].iloc[0], 0.20, 0.05, 60, entry_price=100.0)
    assert (touch, periods) == ("down", 5)


def test_first_touch_timeout_dan_open():
    """Bar habis tanpa sentuhan → `timeout`; data belum cukup → `open` (bukan tebakan)."""
    bars = make_bars([100.0] * 12)
    assert plan.first_touch(bars, bars["date"].iloc[0], 0.05, 0.05, 5) == ("timeout", 5)
    assert plan.first_touch(bars, "2099-01-01", 0.05, 0.05, 5) == ("open", None)
