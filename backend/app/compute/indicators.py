"""Indikator teknikal (docs/03 §2, §6.2). Wilder = EMA dengan alpha 1/period.

Periode RSI/ATR (14) adalah konstanta metodologi dari `docs/03`, bukan ambang yang bisa
disetel user seperti `rrg.ema_span`/`roc_lag` di config.
"""

from __future__ import annotations

import pandas as pd


def ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def sma(series: pd.Series, window: int) -> pd.Series:
    return series.rolling(window).mean()


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
    return 100 - 100 / (1 + avg_gain / avg_loss)


def true_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    prev_close = close.shift(1)
    return pd.concat([high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1).max(axis=1)


def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    return true_range(high, low, close).ewm(alpha=1 / period, adjust=False).mean()


# --- Lapisan grafik v2 (docs/03 §11) — semua dihitung dari harga penyesuaian -------------


def moving_average(series: pd.Series, window: int, method: str) -> pd.Series:
    """Rata-rata bergerak untuk `ursi`: `rma` (Wilder) | `ema` | `sma` | `tma` (dua tahap, lebih halus)."""
    if method == "rma":
        return series.ewm(alpha=1 / window, adjust=False).mean()
    if method == "ema":
        return ema(series, window)
    if method == "tma":  # shortcut: segitiga ≈ SMA dua tahap; cukup untuk melunakkan tren
        return sma(sma(series, (window + 1) // 2), window // 2 + 1)
    return sma(series, window)


def ursi(close: pd.Series, window: int = 14, method: str = "sma") -> pd.Series:
    """Ultimate RSI (docs/03 §11.1): `50 + 50 × MA(Δ, len) / MA(|Δ|, len)`.

    Jujur di kode: dengan `method="rma"` ini **identik dengan RSI klasik/Wilder** — sama dengan
    `metrics.rsi14`. Perbedaan versi `sma`/`tma` hanya pada kehalusan (bertahan lebih lama di area
    ekstrem), bukan indikator lain.
    """
    delta = close.diff()
    return 50 + 50 * moving_average(delta, window, method) / moving_average(delta.abs(), window, method)


def vwap(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    volume: pd.Series,
    window: int = 20,
    band: tuple[float, float] = (1.0, 2.0),
    start: int | None = None,
) -> pd.DataFrame:
    """VWAP + pita deviasi σ (docs/03 §11.2); `start` = bar anchor (None = jendela bergulir).

    Bar bervolume 0 dibuang dari pembilang **dan** penyebut — volume 0 bukan harga.
    """
    typical = (high + low + close) / 3
    traded = volume.where(volume > 0, 0.0)  # volume 0 → nol (bukan NaN) supaya tidak meracuni penjumlahan
    if start is None:
        value = (typical * traded).rolling(window).sum() / traded.rolling(window).sum()
        sigma = (close - value).rolling(window).std()
    else:
        value = ((typical * traded).iloc[start:].cumsum() / traded.iloc[start:].cumsum()).reindex(close.index)
        sigma = (close - value).iloc[start:].expanding().std().reindex(close.index)
    inner, outer = min(band), max(band)
    return pd.DataFrame(
        {
            "vwap": value,
            "upper1": value + inner * sigma,
            "lower1": value - inner * sigma,
            "upper2": value + outer * sigma,
            "lower2": value - outer * sigma,
        }
    )


def volume_profile(
    high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series,
    bins: int = 24, bars: int = 60, value_area: float = 0.7,
) -> dict:
    """POC + value area (docs/03 §11.3).

    Perkiraan: karena volume harian tidak tahu harga mana yang terjadi di dalam 1 bar, seluruh
    volume bar disumbangkan ke bucket harga `typical`-nya — UI wajib melabeli "perkiraan".
    """
    typical = ((high + low + close) / 3).iloc[-bars:]
    traded = volume.iloc[-bars:].fillna(0)
    if not len(typical) or float(traded.sum()) <= 0:
        return {"poc": None, "value_area": {"low": None, "high": None}}
    low_edge, high_edge = float(typical.min()), float(typical.max())
    if high_edge <= low_edge:
        return {"poc": round(low_edge, 2), "value_area": {"low": round(low_edge, 2), "high": round(high_edge, 2)}}

    width = (high_edge - low_edge) / bins
    buckets = [0.0] * bins
    for price, size in zip(typical, traded):
        buckets[min(int((float(price) - low_edge) / width), bins - 1)] += float(size or 0)
    poc_index = max(range(bins), key=lambda index: buckets[index])
    target, total, left, right = value_area * sum(buckets), buckets[poc_index], poc_index, poc_index
    while total < target and (left > 0 or right < bins - 1):
        if right < bins - 1 and (left == 0 or buckets[right + 1] >= buckets[left - 1]):
            right += 1
            total += buckets[right]
        else:
            left -= 1
            total += buckets[left]
    return {
        "poc": round(low_edge + (poc_index + 0.5) * width, 2),
        "value_area": {"low": round(low_edge + left * width, 2), "high": round(low_edge + (right + 1) * width, 2)},
    }
