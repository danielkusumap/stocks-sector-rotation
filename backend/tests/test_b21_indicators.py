"""B21 — lapisan `indicators` (docs/03 §11.1–§11.3): URSI, VWAP+σ, POC.

Ditulis lebih dulu (belum dijalankan — lihat ADR-054).
"""

from __future__ import annotations

import pandas as pd
import pytest

from backend.app.api.plan import _indicators
from backend.app.compute import indicators
from backend.app.config import get_settings


def close_series(count: int = 80) -> pd.Series:
    """Harga naik-turun lembut supaya RSI tidak mentok 0/100 (pembagi ≠ 0)."""
    steps = range(count)
    return pd.Series([100 + 0.4 * step + 6 * (-1) ** step for step in steps], dtype=float)


def test_ursi_rma_sama_dengan_rsi14():
    """`ursi(method="rma")` **identik** RSI klasik/Wilder → sama dengan `metrics.rsi14` (docs/03 §11.1)."""
    close = close_series()
    assert indicators.ursi(close, 14, "rma").iloc[20:].to_list() == pytest.approx(
        indicators.rsi(close, 14).iloc[20:].to_list(), abs=1e-6
    )


def test_ursi_sma_lebih_halus_dari_rma():
    """Versi `sma` bukan indikator lain — hanya smoothing lain (perubahan lebih kecil per bar)."""
    close = close_series()
    rma = indicators.ursi(close, 14, "rma").diff().abs().iloc[20:].mean()
    sma = indicators.ursi(close, 14, "sma").diff().abs().iloc[20:].mean()
    assert sma < rma


def test_vwap_buang_volume_nol():
    """Bar bervolume 0 dibuang dari pembilang & penyebut (bukan dianggap harga)."""
    high = pd.Series([110.0, 200.0, 110.0])
    low = pd.Series([90.0, 100.0, 90.0])
    close = pd.Series([100.0, 150.0, 100.0])
    volume = pd.Series([1000.0, 0.0, 1000.0])
    value = indicators.vwap(high, low, close, volume, window=3)["vwap"].iloc[-1]
    assert value == pytest.approx((100.0 * 1000.0 + 100.0 * 1000.0) / 2000.0)


def test_poc_manual():
    """POC dihitung ulang manual (aturan docs/03 §11.3) → titik tengah bucket terberat."""
    bars = 20
    typical_base = 100.0
    high = pd.Series([typical_base + 3.0] * bars)
    low = pd.Series([typical_base - 3.0] * bars)
    close = pd.Series([typical_base] * bars)  # typical = 100 untuk semua bar
    volume = pd.Series([1.0] * (bars - 1) + [50.0])  # bar terakhir mendominasi
    bins, bars_used, area = 5, bars, 0.7
    profile = indicators.volume_profile(high, low, close, volume, bins=bins, bars=bars_used, value_area=area)
    width = (100.0 - 100.0) / bins  # rentang nol → jalur khusus
    assert width == 0
    assert profile["poc"] == pytest.approx(100.0)
    assert profile["value_area"]["low"] <= profile["poc"] <= profile["value_area"]["high"]


def test_blok_indicators_bentuk_kontrak(tmp_config):
    """`_indicators()` merakit blok dengan kunci & metadata sesuai `docs/05` §2."""
    cfg = get_settings()
    bars = pd.DataFrame(
        {
            "date": pd.bdate_range("2026-01-05", periods=80).strftime("%Y-%m-%d"),
            "open": [100.0] * 80,
            "high": [103.0] * 80,
            "low": [97.0] * 80,
            "close": close_series(80).to_list(),
            "volume": [1_000_000.0] * 80,
        }
    )
    block = _indicators(bars, cfg, bars.index)
    assert set(block) == {"ursi", "vwap", "poc"}
    assert set(block["ursi"]) >= {"len", "method", "ob", "os", "points"}
    assert block["ursi"]["points"] and set(block["ursi"]["points"][0]) == {"date", "value", "signal"}
    assert set(block["vwap"]) >= {"len", "anchor", "anchor_date", "points"}
    assert set(block["vwap"]["points"][0]) == {"date", "vwap", "upper1", "lower1", "upper2", "lower2"}
    assert block["vwap"]["points"][0]["upper2"] > block["vwap"]["points"][0]["upper1"]
    assert block["poc"]["basis"] in ("daily", "intraday")
    assert block["poc"]["bars_used"] == min(cfg.chart["poc"]["bars"], len(bars))
    assert set(block["poc"]["value_area"]) == {"low", "high"}
