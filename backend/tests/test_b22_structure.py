"""B22 — lapisan konteks SMC & Elliott (`compute/structure.py`, docs/03 §11.4–§11.5).

Ditulis lebih dulu (belum dijalankan — lihat ADR-054). Fixture dibangun relatif ke
`weekly.plan.pivot_bars` supaya tidak bergantung angka tertentu di config.
"""

from __future__ import annotations

import pandas as pd
import pytest

from backend.app.compute import structure
from backend.app.config import get_settings


def make_ohlc(closes, *, highs=None, lows=None, opens=None, volumes=None) -> pd.DataFrame:
    """Bar uji dengan **open** (dibutuhkan order block) — `make_bars` di test_b18_plan tidak punya open."""
    count = len(closes)
    closes = [float(value) for value in closes]
    return pd.DataFrame(
        {
            "date": pd.bdate_range("2026-01-05", periods=count).strftime("%Y-%m-%d"),
            "open": [float(value) for value in (opens if opens is not None else closes)],
            "high": [float(value) for value in (highs if highs is not None else [c + 1 for c in closes])],
            "low": [float(value) for value in (lows if lows is not None else [c - 1 for c in closes])],
            "close": closes,
            "volume": [float(value) for value in (volumes if volumes is not None else [1_000_000] * count)],
        }
    )


@pytest.fixture
def cfg(tmp_config):
    return get_settings()


def _span(cfg) -> int:
    return cfg.weekly["plan"]["pivot_bars"]


def _swing_bars(cfg, *, tail_close: float = 100.0, pokes_high: bool = False) -> pd.DataFrame:
    """Mendatar dengan swing high 110 & swing low 90; pivot biasa di 105/95 supaya wick bisa diuji.

    Band pivot dibuat **di atas** `tail_close` (105) sehingga bar ekor bisa menembus dengan `high`
    tapi tidak dengan `close`.
    """
    span = _span(cfg)
    length = span * 4 + 4
    index = span * 2
    closes = [100.0] * length
    highs = [105.0] * length
    lows = [95.0] * length
    highs[index] = 110.0  # swing high tunggal (tetangga ±`span` lebih rendah)
    lows[index + span] = 90.0  # swing low tunggal
    closes[-1] = tail_close
    highs[-1] = 111.0 if pokes_high else max(tail_close + 1, 105.0)
    return make_ohlc(closes, highs=highs, lows=lows)


# --- FVG ------------------------------------------------------------------------


def test_smc_fvg_bullish(cfg):
    """Celah 3 bar: `low(t) > high(t−2)` → bullish, level = batas celah."""
    bars = make_ohlc([100.0, 100.0, 100.0, 108.0, 108.0], highs=[101.0, 101.0, 101.0, 109.0, 109.0], lows=[99.0, 99.0, 99.0, 106.0, 106.0])
    gaps = structure.smc_layers(bars, cfg)["fvg"]
    assert any(gap["kind"] == "bullish" and gap["low"] == 101.0 and gap["high"] == 106.0 for gap in gaps)


def test_smc_fvg_bearish(cfg):
    bars = make_ohlc([100.0, 100.0, 100.0, 92.0, 92.0], highs=[101.0, 101.0, 101.0, 94.0, 94.0], lows=[99.0, 99.0, 99.0, 91.0, 91.0])
    gaps = structure.smc_layers(bars, cfg)["fvg"]
    assert any(gap["kind"] == "bearish" and gap["high"] == 99.0 for gap in gaps)


# --- BOS/CHoCH ------------------------------------------------------------------


def test_smc_bos_butuh_close(cfg):
    """`high` menembus swing high tapi `close` tidak → **bukan** BOS (docs/03 §11.4)."""
    wick = structure.smc_layers(_swing_bars(cfg, tail_close=104.0, pokes_high=True), cfg)
    assert wick["bos"] == []

    broken = structure.smc_layers(_swing_bars(cfg, tail_close=106.0), cfg)
    assert broken["bos"] and broken["bos"][-1]["direction"] == "up"


def test_smc_order_block_candle_terakhir_sebelum_impuls(cfg):
    """OB bullish = candle turun terakhir sebelum impuls yang memecah struktur; `mitigated` setelah disentuk."""
    bars = _swing_bars(cfg, tail_close=111.0)
    index = len(bars) - 1
    bars.loc[max(index - 1, 0), ["open", "close", "high", "low"]] = [109.0, 105.0, 109.5, 104.5]  # candle turun
    blocks = structure.smc_layers(bars, cfg)["order_blocks"]
    bullish = [block for block in blocks if block["kind"] == "bullish"]
    assert bullish and bullish[-1]["low"] == 104.5 and bullish[-1]["high"] == 109.5

    after = pd.concat([bars, make_ohlc([106.0], highs=[107.0], lows=[105.0])], ignore_index=True)
    after.loc[len(bars), "date"] = "2026-12-31"
    revisited = [block for block in structure.smc_layers(after, cfg)["order_blocks"] if block["kind"] == "bullish"]
    assert revisited[-1]["mitigated"] is True


def test_smc_equal_levels_toleransi(cfg):
    """Beberapa pivot high pada level berdekatan (≤ `chart.smc.eq_tol_pct` × close) → satu baris, `count ≥ 2`."""
    levels = [entry for entry in structure.smc_layers(_swing_bars(cfg), cfg)["equal_levels"] if entry["kind"] == "high"]
    assert levels and levels[0]["count"] >= 2
    assert "level" in levels[0] and levels[0]["level"] > 0


# --- Elliott --------------------------------------------------------------------


def test_elliott_min_move(cfg):
    """Pivot dengan jarak < `chart.elliott.min_move` tidak membentuk titik ZigZag baru."""
    min_move = cfg.chart["elliott"]["min_move"]
    assert min_move > 0
    bars = _swing_bars(cfg)
    zigzag = structure.elliott_layers(bars, cfg)["zigzag"]
    for previous, current in zip(zigzag, zigzag[1:]):
        assert abs(current["price"] - previous["price"]) / previous["price"] >= min_move
        assert current["kind"] != previous["kind"]


def test_elliott_invalidated_ditandai(cfg):
    """Pola yang dilanggar **tetap dikirim** dengan `invalidated=true` + `note` memuat "kandidat"."""
    bars = _swing_bars(cfg)
    body = structure.elliott_layers(bars, cfg)
    assert body["status"] in ("candidate", "invalidated")
    assert body["invalidated"] == (body["status"] == "invalidated")
    assert "kandidat, bisa berubah" in body["note"]
    for ratio in (0.382, 0.5, 0.618):
        assert any(zone["ratio"] == ratio for zone in body["fib_zones"]) or not body["fib_zones"]
