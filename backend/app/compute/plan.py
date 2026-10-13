"""Trading plan berbasis analisa teknikal (docs/03 §6.4) — satu mesin untuk `signal_weekly` dan `stock_plan`.

Alat dipilih oleh **rezim** (docs/03 §6.4.0; dasar: skill `idx-ta-trading-plan`): maksimum satu alat
utama + satu konfirmasi, dan alat yang bertentangan bukan "confluence". Semua level dari harga
penyesuaian (`high`/`low` diskalakan `adj_close/close`, ADR-040); semua angka ambang dari
`config weekly.plan.*` / `config ta.*` / `config universe.*` — tidak ada angka di kode.
"""

from __future__ import annotations

import json
from datetime import datetime
from statistics import median
from zoneinfo import ZoneInfo

import pandas as pd

from ..config import get_settings
from ..db import connect
from ..labels import REGIME_LABEL, format_id_number
from . import indicators

ENTRY_TOOLS = ("pullback_ma20", "breakout_donchian", "sr_channel", "pivot_level", "none")
CONFIRM_TOOLS = ("volume", "rsi_tepi_range", "none")
MAX_REASON = 140

# `high`/`low` mentah (auto_adjust=False) diskalakan ke kerangka `adj_close` bar yang sama.
BARS_SQL = """
    SELECT date, adj_close AS close, volume,
           high * adj_close / NULLIF(close, 0) AS high,
           low  * adj_close / NULLIF(close, 0) AS low
    FROM price_daily
    WHERE ticker = ? AND date <= ? AND adj_close IS NOT NULL AND close IS NOT NULL
    ORDER BY date
"""
# `stock_metrics` hanya untuk `median_turnover_20d_idr` (gerbang rezim `tipis`, docs/03 §6.4.0) —
# level plan (sma/rsi/atr) dihitung dari bar `<= week_end` (B18b), bukan snapshot metrik terakhir.
METRICS_SQL = """
    SELECT median_turnover_20d_idr
    FROM stock_metrics WHERE ticker = ? AND timeframe = 'd1'
    ORDER BY as_of_date DESC LIMIT 1
"""
SECTOR_QUADRANT_SQL = """
    SELECT quadrant FROM rrg_daily
    WHERE scope = 'sector' AND timeframe = 'w1_fri' AND weighting = ? AND ref_id = ? AND as_of_date <= ?
    ORDER BY as_of_date DESC LIMIT 1
"""
TA_STATS_SQL = """
    SELECT result, periods, mfe_pct FROM ta_breakout
    WHERE scope = 'stock' AND ref_id = ? AND ma_period = ? AND trend_filter = ?
"""


def _trim(text: str, limit: int = MAX_REASON) -> str:
    """Kalimat alasan ≤ `limit` karakter (docs/05 §3)."""
    if len(text) <= limit:
        return text
    return text[: limit - 1].rsplit(" ", 1)[0] + "…"


def _pct(value: float, entry: float) -> float:
    return value / entry - 1


def pivots(bars: pd.DataFrame, span: int) -> tuple[list[int], list[int]]:
    """Indeks pivot high/low: bar ke-`i` ekstrem di jendela `i ± span` (docs/03 §6.4.9)."""
    highs, lows = bars["high"].tolist(), bars["low"].tolist()
    up: list[int] = []
    down: list[int] = []
    for i in range(span, len(bars) - span):
        window = slice(i - span, i + span + 1)
        if highs[i] == max(highs[window]):
            up.append(i)
        if lows[i] == min(lows[window]):
            down.append(i)
    return up, down


def channels(levels: list[float], close: float, tol_pct: float) -> list[dict]:
    """Kelompokkan level pivot yang jaraknya ≤ `tol_pct` × close → kanal + kekuatan (docs/03 §6.4.9).

    Pivot diurutkan dari yang terendah; tiap kelompok jadi satu level = rata-rata anggotanya.
    """
    groups: list[list[float]] = []
    for level in sorted(levels):
        if groups and abs(level - groups[-1][-1]) <= tol_pct * close:
            groups[-1].append(level)
        else:
            groups.append([level])
    return [{"level": sum(g) / len(g), "strength": len(g)} for g in groups]


def regime_of(bars: pd.DataFrame, metrics: dict, *, sector_quadrant: str | None, cfg) -> str:
    """Rezim pasar (docs/03 §6.4.0) — urutan cek: `tipis` > `turun` > `range` > `tren_naik`."""
    plan = cfg.weekly["plan"]
    if bars.empty:
        return "tipis"
    close = float(bars["close"].iloc[-1])
    recent = bars.iloc[-plan["donchian_fast"] :]
    zero_share = float((recent["volume"] == 0).mean()) if len(recent) else 1.0
    turnover = metrics.get("median_turnover_20d_idr")
    if (turnover is not None and turnover < cfg.universe["min_turnover_idr"]) or zero_share >= plan["thin_zero_volume"]:
        return "tipis"
    sma20, sma50 = metrics.get("sma20"), metrics.get("sma50")
    if not sma20 or not sma50:
        return "range"
    if close < sma20 < sma50:
        return "turun"
    if close and abs(sma20 - sma50) / close <= plan["range_ma_gap"]:
        return "range"
    period, offset = cfg.ta["ma_default"], plan["ma_slope_bars"]
    sma20_prev = float(bars["close"].iloc[-period - offset : -offset].mean()) if len(bars) > period + offset else None
    rising = sma20_prev is not None and sma20 > sma20_prev
    if close > sma20 > sma50 and rising and sector_quadrant in ("leading", "improving"):
        return "tren_naik"
    return "range"  # sisa: tidak ada tren naik yang sah → konservatif (menyamping)


def _features(bars: pd.DataFrame, metrics: dict, cfg) -> dict:
    plan = cfg.weekly["plan"]
    close = float(bars["close"].iloc[-1])
    high, low, volume = bars["high"], bars["low"], bars["volume"]
    vol20 = volume.iloc[-cfg.chart["volume_ma"] :]
    vol20 = vol20[vol20 > 0]
    return {
        "close": close,
        "high": high,
        "low": low,
        "atr14": metrics.get("atr14"),
        "rsi14": metrics.get("rsi14"),
        "sma20": metrics.get("sma20"),
        "sma50": metrics.get("sma50"),
        "don_high_f": float(high.iloc[-plan["donchian_fast"] :].max()),
        "don_high_prev": float(high.iloc[-plan["donchian_fast"] - 1 : -1].max()),
        "don_low_f": float(low.iloc[-plan["donchian_fast"] :].min()),
        "don_high_s": float(high.iloc[-plan["donchian_slow"] :].max()),
        "swing_low": float(low.iloc[-plan["swing_low_bars"] :].min()),
        "volume_ratio": (float(volume.iloc[-1]) / float(vol20.mean())) if len(vol20) else None,
    }


def _empty_plan(regime: str, note: str, *, entry_mode: str = "no_trade") -> dict:
    """Plan tanpa level (`atr14` null atau data kurang) — jangan mengarang angka (docs/03 §6.4.1)."""
    return {
        "regime": regime,
        "entry_tool": "none",
        "confirm_tool": "none",
        "entry_mode": entry_mode,
        "entry_zone": {"low": None, "high": None, "reason": _trim("Level belum bisa dihitung; jangan pasang posisi dulu.")},
        "stop": {"level": None, "pct": None, "basis": None, "reason": _trim(note)},
        "tp1": {"level": None, "pct": None, "rr": None, "basis": None, "reason": _trim(note)},
        "tp2": {"level": None, "pct": None, "rr": None, "basis": None, "reason": _trim(note)},
        "hold": {"median_periods": None, "n_events": None, "win_rate": None, "hit_tp1": None, "hit_tp2": None, "reason": None},
        "invalidation": None,
        "plan_ok": False,
        "notes": [note],
        "volume_ratio": None,
        "entry_tool_reason": _trim(note),
        "confirm_reason": None,
        "regime_reason": _trim(REGIME_REASON.get(regime, note)),
        "active_tools": [],
    }


def _stop(features: dict, entry_mid: float, regime: str, cfg) -> dict:
    """Stop: struktur dulu, volatilitas sebagai lantai (docs/03 §6.4.3)."""
    plan = cfg.weekly["plan"]
    atr = features["atr14"]
    buffer_atr = plan["stop_buffer_atr"] + (plan["thin_stop_mult"] - 1.0 if regime == "tipis" else 0.0)
    stop_struct = features["swing_low"] - buffer_atr * atr
    stop_atr = entry_mid - cfg.weekly["atr_stop_mult"] * atr
    stop = max(stop_struct, stop_atr)
    floor = entry_mid - plan["min_stop_atr"] * atr
    if stop > floor:  # lebih ketat dari 1 × ATR → dijauhkan ke lantai (docs/03 §6.4.3)
        return {"level": floor, "basis": "lantai_atr", "reason": _trim(
            "Batas rugi di bawah struktur terlalu ketat (kurang dari satu kali volatilitas harian) sehingga rawan kena gerak acak; dipakai lantai volatilitas."
        )}
    if stop_struct >= stop_atr:
        return {"level": stop_struct, "basis": "struktur_swing_low", "reason": _trim(
            f"Batas rugi di bawah titik terendah {plan['swing_low_bars']} hari ({format_id_number(features['swing_low'])}) "
            f"ditambah penyangga {format_id_number(plan['stop_buffer_atr'], 1)} kali volatilitas — di situ skenario naik batal."
        )}
    return {"level": stop_atr, "basis": "volatilitas_atr", "reason": _trim(
        f"Titik terendah terdekat terlalu jauh ({format_id_number(abs(_pct(features['swing_low'], entry_mid)) * 100, 1)}%); "
        f"batas rugi ditaruh {format_id_number(cfg.weekly['atr_stop_mult'], 1)} kali volatilitas di bawah harga acuan supaya posisi tidak kebesaran."
    )}


def _targets(features: dict, entry_mid: float, stop: float, regime: str, levels: dict, cfg) -> tuple[dict, dict]:
    """TP1 = supply nyata terdekat, TP2 = target terukur dengan imbal hasil minimal (docs/03 §6.4.4)."""
    plan = cfg.weekly["plan"]
    atr = features["atr14"]
    cost = (plan["fee_buy_bps"] + plan["fee_sell_bps"]) / 10_000
    risk = entry_mid - stop

    def rr(level: float) -> float:
        return (level - entry_mid - cost * entry_mid) / (risk + cost * entry_mid)

    if regime == "range":
        tp1_level, tp1_basis = (levels["upper"], "kanal_atas") if levels.get("upper") else (None, None)
        tp2_level, tp2_basis = (levels["upper_next"], "kanal_berikutnya") if levels.get("upper_next") else (None, None)
    elif regime == "tipis":
        tp1_level, tp1_basis = (levels["pivot_high"], "pivot_berikutnya") if levels.get("pivot_high") else (None, None)
        tp2_level, tp2_basis = (features["don_high_s"], "puncak_40")
    else:
        nearest = features["don_high_f"]
        if nearest > entry_mid:
            tp1_level, tp1_basis = nearest, "resistance_20"
        else:
            tp1_level, tp1_basis = entry_mid + plan["tp1_fallback_atr"] * atr, "fallback_volatilitas"
        tp2_level, tp2_basis = features["don_high_s"], "puncak_40"

    if tp1_level is None:
        tp1_level, tp1_basis = entry_mid + plan["tp1_fallback_atr"] * atr, "fallback_volatilitas"
    # TP2 wajib memberi imbal hasil minimal setelah biaya → level minimum dihitung, lalu diambil yang lebih tinggi.
    tp2_min = entry_mid + cost * entry_mid + plan["rr_min_tp2"] * (risk + cost * entry_mid)
    if tp2_level is None or tp2_level < tp2_min:
        tp2_level, tp2_basis = tp2_min, "target_terukur_minimal"

    return (
        {
            "level": tp1_level,
            "pct": _pct(tp1_level, entry_mid),
            "rr": rr(tp1_level),
            "basis": tp1_basis,
            "reason": _trim(
                "Batas atas kanal bawah adalah tempat pembeli terakhir bertahan — ambil sebagian di tepi kanal."
                if tp1_basis == "kanal_atas"
                else "Puncak 20 hari terakhir adalah tempat penjual menumpuk — ambil sebagian di situ."
                if tp1_basis == "resistance_20"
                else "Belum ada level penjual nyata di atas harga; target pertama ditaruh pada jarak aman dari volatilitas harian."
            ),
        },
        {
            "level": tp2_level,
            "pct": _pct(tp2_level, entry_mid),
            "rr": rr(tp2_level),
            "basis": tp2_basis,
            "reason": _trim(
                f"Target terukur dari level {format_id_number(tp2_level)}; imbal hasil terhadap risiko setelah biaya "
                f"{format_id_number(cost * 100, 2)}% masih {format_id_number(rr(tp2_level), 2)}:1."
            ),
        },
    )


def plan_levels(bars: pd.DataFrame, metrics: dict, regime: str, ta_stats: dict, cfg, *, support_ihsg: float | None = None) -> dict:
    """Level + alasan satu pick (docs/03 §6.4.1–§6.4.6). **Fungsi murni, tanpa DB** supaya mudah diuji."""
    plan = cfg.weekly["plan"]
    needed = plan["donchian_slow"] + 1
    if not metrics.get("atr14"):  # ATR `None` **atau** 0 (harga datar/suspend) → tidak ada level, hindari bagi nol
        return _empty_plan(regime, "Volatilitas harian belum tersedia; level tidak dihitung supaya tidak mengarang angka.")
    if len(bars) < needed:
        return _empty_plan(regime, f"Butuh minimal {needed} bar riwayat untuk menyusun level; data belum cukup.")

    features = _features(bars, metrics, cfg)
    atr = features["atr14"]
    close = features["close"]
    sma20 = features["sma20"] or close
    above_ma20_atr = (close - sma20) / atr
    if regime == "turun":
        return _empty_plan(regime, "Tren harian masih turun (harga di bawah penyangga 20 dan 50 hari); mode gagal saat turun — tidak ambil posisi.")

    up_idx, low_idx = pivots(bars, plan["pivot_bars"])
    high_channels = channels([float(features["high"].iloc[i]) for i in up_idx], close, plan["channel_tol_pct"])
    low_channels = channels([float(features["low"].iloc[i]) for i in low_idx], close, plan["channel_tol_pct"])
    min_strength = cfg.chart["channel_min_strength"]
    strong_highs = [c for c in high_channels if c["strength"] >= min_strength]
    strong_lows = [c for c in low_channels if c["strength"] >= min_strength]
    levels = {
        "upper": min((c["level"] for c in strong_highs if c["level"] > close * 0.995), default=None),
        "support": max((c["level"] for c in strong_lows if c["level"] < close * 1.005), default=None),
        "pivot_high": min((c["level"] for c in high_channels if c["level"] > close * 0.995), default=None),
    }
    levels["upper_next"] = min((c["level"] for c in strong_highs if levels["upper"] and c["level"] > levels["upper"] * 1.005), default=None)

    notes: list[str] = []
    confirm = "none"
    if regime == "range":
        if levels["support"] is None:
            return _empty_plan(regime, "Pasar menyamping tanpa batas bawah yang jelas (kanal belum terbentuk); tidak ambil posisi.")
        entry_tool, entry_mode = "sr_channel", "pullback"
        confirm = "rsi_tepi_range"
        if (features["rsi14"] or 0) > plan["rsi_range_max"]:
            plan_out = _empty_plan(regime, f"Harga menyentuh batas bawah kanal tetapi momentum harian {format_id_number(features['rsi14'] or 0)} belum di tepi bawah — belum ada konfirmasi pantulan, jadi tidak ambil posisi.")
            plan_out["notes"].append("Sinyal bertentangan (struktur vs momentum) → seri; aturan: seri = tidak ambil posisi.")
            return plan_out
        level = levels["support"]
        zone_reason = "Pantulan di batas bawah kanal: di pasar menyamping beli di tepi bawah lebih aman daripada mengejar penembusan batas atas."
    elif regime == "tipis":
        entry_tool = "pivot_level" if levels["pivot_high"] or levels["support"] else "none"
        entry_mode = "pullback"
        confirm = "none"  # volume di saham tipis tidak bisa dipercaya (docs/03 §6.4.0)
        level = levels["support"] or features["swing_low"]
        zone_reason = "Saham jarang transaksi: pakai level pantulan saja tanpa konfirmasi volume, karena volume mudah menipu di saham tipis."
    else:  # tren_naik
        entry_tool, confirm = "pullback_ma20", "volume"
        breakout = features["volume_ratio"] is not None and features["volume_ratio"] >= plan["volume_mult"] and close > features["don_high_prev"]
        if above_ma20_atr > plan["chase_atr"] or (features["rsi14"] or 0) > cfg.universe["max_rsi"]:
            entry_mode = "wait_pullback"
            level = sma20
            zone_reason = (
                f"Harga sudah {format_id_number(above_ma20_atr, 1)} kali volatilitas harian di atas penyangga 20 hari "
                f"({format_id_number(sma20)}) — jangan chase; tunggu pullback ke penyangga."
            )
        elif breakout:
            entry_mode, entry_tool = "breakout", "breakout_donchian"
            level = features["don_high_f"]
            zone_reason = (
                f"Menembus puncak 20 hari dengan volume {format_id_number(features['volume_ratio'], 1)} kali rata-rata — "
                "permintaan nyata, bukan kenaikan tipis."
            )
        else:
            entry_mode = "pullback"
            level = sma20
            zone_reason = "Harga masih dekat penyangga 20 hari; beli di penyangga membuat batas rugi lebih dekat dan imbal hasil lebih baik."

    zone_low, zone_high = level - plan["zone_atr"] * atr, level + plan["zone_atr"] * atr
    entry_mid = (zone_low + zone_high) / 2
    if not entry_mid:  # harga acuan 0 → tidak ada level yang bisa dihitung
        return _empty_plan(regime, "Harga acuan tidak terbaca; level tidak dihitung supaya tidak mengarang angka.")
    stop = _stop(features, entry_mid, regime, cfg)
    stop["pct"] = _pct(stop["level"], entry_mid)
    tp1, tp2 = _targets(features, entry_mid, stop["level"], regime, levels, cfg)

    mfe = [value for value in (ta_stats.get("mfe_pct") or []) if value is not None]
    n_events = ta_stats.get("n_events") or 0
    enough = n_events >= plan["min_events_hold"] and bool(mfe)
    hit1 = sum(1 for value in mfe if value >= tp1["pct"]) / len(mfe) if enough else None
    hit2 = sum(1 for value in mfe if value >= tp2["pct"]) / len(mfe) if enough else None
    hold = {
        "median_periods": ta_stats.get("median_periods_win") if enough else None,
        "n_events": n_events,
        "win_rate": ta_stats.get("win_rate"),
        "hit_tp1": hit1,
        "hit_tp2": hit2,
        "reason": (
            _trim(
                f"Dari {n_events} penembusan terakhir: target pertama historis kena {format_id_number((hit1 or 0) * 100)}%, "
                f"lama tahan median {format_id_number(ta_stats.get('median_periods_win') or 0)} hari."
            )
            if enough
            else f"Belum cukup riwayat ({n_events} kejadian) untuk menilai peluang target ini."
        ),
    }

    plan_ok = True
    batas_stop = max(plan["max_stop_pct"], plan["max_stop_atr"] * atr / entry_mid)  # adaptif: saham bervolatilitas tinggi
    if abs(stop["pct"]) > batas_stop:
        # Lebar stop bukan alasan menolak ide — dikelola lewat ukuran posisi (`lots_hint`), bukan plan_ok (ADR-048).
        notes.append(
            _trim(
                f"Batas rugi {format_id_number(abs(stop['pct']) * 100, 1)}% — lebar untuk swing; perkecil ukuran posisi, jangan longgarkan stop."
            )
        )
    if tp2["rr"] < plan["rr_min_tp2"] - 1e-9:  # level TP2 dihitung tepat di ambang minimal → toleransi float
        plan_ok = False
        notes.append(f"Imbal hasil terhadap risiko target kedua hanya {format_id_number(tp2['rr'], 2)}:1 (minimal {format_id_number(plan['rr_min_tp2'], 1)}:1) setelah biaya.")

    return {
        "regime": regime,
        "entry_tool": entry_tool,
        "confirm_tool": confirm,
        "entry_mode": entry_mode,
        "entry_zone": {"low": zone_low, "high": zone_high, "reason": _trim(zone_reason)},
        "stop": stop,
        "tp1": tp1,
        "tp2": tp2,
        "hold": hold,
        "invalidation": _trim(
            f"Batal bila tutup harian di bawah penyangga 20 hari ({format_id_number(sma20)}) atau di bawah batas rugi "
            f"({format_id_number(stop['level'])}); pasar: IHSG tutup di bawah {format_id_number(support_ihsg)} → tunda entry baru."
            if support_ihsg
            else f"Batal bila tutup harian di bawah penyangga 20 hari ({format_id_number(sma20)}) atau di bawah batas rugi ({format_id_number(stop['level'])}).",
            180,
        ),
        "plan_ok": plan_ok,
        "notes": notes,
        "volume_ratio": features["volume_ratio"],
        "risk_pct": abs(stop["pct"]),
        "entry_tool_reason": _trim(TOOL_REASON.get(entry_tool, "")),
        "confirm_reason": confirm_reason(confirm, features, cfg),
        "regime_reason": _trim(REGIME_REASON.get(regime, "")),
        "active_tools": [tool for tool in (entry_tool, confirm) if tool and tool != "none"],
    }


TOOL_REASON = {
    "pullback_ma20": "Harga dekat penyangga 20 hari saat tren masih naik — beli di penyangga membuat batas rugi lebih dekat.",
    "breakout_donchian": "Harga menembus puncak 20 hari dengan volume di atas rata-rata — kelanjutan tren, bukan kenaikan tipis.",
    "sr_channel": "Pasar menyamping: level pantulan lebih andal daripada penembusan batas kanal.",
    "pivot_level": "Saham jarang transaksi: hanya level pantulan yang bisa dipercaya, tanpa konfirmasi volume.",
    "none": "Belum ada alat yang sah untuk rezim ini.",
}


def confirm_reason(tool: str, features: dict, cfg) -> str | None:
    """Kalimat konfirmasi (docs/06 §5.2 / ADR-044) — ≤140 char, tanpa istilah mentah."""
    if tool == "volume" and features.get("volume_ratio") is not None:
        return _trim(
            f"Volume bar terakhir {format_id_number(features['volume_ratio'], 1)} kali rata-rata 20 hari"
            f" (minimal {format_id_number(cfg.weekly['plan']['volume_mult'], 1)} kali)."
        )
    if tool == "rsi_tepi_range":
        return _trim(
            f"Momentum harian {format_id_number(features.get('rsi14') or 0)} di tepi bawah "
            f"(maksimal {format_id_number(cfg.weekly['plan']['rsi_range_max'])})."
        )
    if tool == "none" and features:
        return _trim("Tanpa konfirmasi: volume di saham tipis tidak bisa dipercaya.")
    return None


def validate(plan: dict | None) -> None:
    """Assert aturan mengikat `docs/03` §6.4.7: satu alat utama + **maksimum satu** konfirmasi."""
    if plan is None:
        return
    assert plan["entry_tool"] in ENTRY_TOOLS, f"entry_tool tidak dikenal: {plan['entry_tool']}"
    confirm = [part for part in str(plan["confirm_tool"] or "none").split(",") if part and part != "none"]
    assert len(confirm) <= 1, f"maksimum satu konfirmasi, dapat {confirm}"
    assert (plan["confirm_tool"] or "none") in CONFIRM_TOOLS, f"confirm_tool tidak dikenal: {plan['confirm_tool']}"
    assert len(plan["notes"]) >= 0 and (plan["plan_ok"] or plan["entry_mode"] == "no_trade" or plan["notes"]), (
        "plan_ok=false wajib disertai catatan alasan"
    )


def key_levels(plan: dict) -> dict:
    """Nilai kolom `signal_weekly`/`stock_plan` dari plan (docs/04 §4)."""
    return {
        "regime": plan["regime"],
        "entry_tool": plan["entry_tool"],
        "confirm_tool": plan["confirm_tool"],
        "entry_mode": plan["entry_mode"],
        "entry_zone_low": plan["entry_zone"]["low"],
        "entry_zone_high": plan["entry_zone"]["high"],
        "stop": plan["stop"]["level"],
        "stop_pct": plan["stop"]["pct"],
        "stop_basis": plan["stop"]["basis"],
        "tp1": plan["tp1"]["level"],
        "tp2": plan["tp2"]["level"],
        "rr_tp1": plan["tp1"]["rr"],
        "rr_tp2": plan["tp2"]["rr"],
        "hold_median_periods": plan["hold"]["median_periods"],
        "hit_tp1": plan["hold"]["hit_tp1"],
        "hit_tp2": plan["hold"]["hit_tp2"],
        "invalidation": plan["invalidation"],
        "volume_ratio": plan.get("volume_ratio"),
        "plan_ok": 1 if plan["plan_ok"] else 0,
        "plan_json": json.dumps(plan, ensure_ascii=False),
    }


def plan_columns() -> tuple[str, ...]:
    """Urutan kolom plan yang ditulis ke `signal_weekly` (docs/04 §4 migrasi 005)."""
    return (
        "regime", "entry_tool", "confirm_tool", "entry_mode", "entry_zone_low", "entry_zone_high",
        "stop_pct", "stop_basis", "tp1", "tp2", "rr_tp1", "rr_tp2", "volume_ratio",
        "hold_median_periods", "hit_tp1", "hit_tp2", "invalidation", "plan_ok", "plan_json",
    )


def plan_values(plan: dict | None) -> tuple:
    """Nilai kolom plan dalam urutan `plan_columns()`; `None` = plan tidak dibuat (kolom tetap NULL)."""
    if plan is None:
        return (None,) * len(plan_columns())
    values = key_levels(plan)
    return tuple(values[column] for column in plan_columns())


def ta_stats_for(conn, ticker: str, cfg) -> dict:
    """Statistik event TA (docs/03 §6.4.5) dari `ta_breakout` — tidak menghitung ulang modul TA."""
    rows = list(conn.execute(TA_STATS_SQL, (ticker, cfg.ta["ma_default"], 1 if cfg.ta["trend_filter"] else 0)))
    counts = {key: 0 for key in ("win", "loss", "expired", "open")}
    wins: list[int] = []
    mfe: list[float | None] = []
    for row in rows:
        if row["result"] in counts:
            counts[row["result"]] += 1
        if row["result"] == "win" and row["periods"] is not None:
            wins.append(row["periods"])
        if row["result"] != "open":
            mfe.append(row["mfe_pct"])
    decided = counts["win"] + counts["loss"]
    return {
        "n_events": len(rows),
        "win_rate": round(counts["win"] / decided, 4) if decided else None,
        "median_periods_win": median(wins) if wins else None,
        "mfe_pct": mfe,
        "counts": counts,
    }


def build_plans(conn, week_end: str, picks: list[dict], cfg, *, weighting: str | None = None) -> dict[str, dict]:
    """Plan untuk sekumpulan pick (docs/03 §6.4): `{ticker: plan}`.

    `atr14` null → plan `null` (kolom plan NULL) supaya tidak ada level karangan (docs/03 §6.4.1).
    """
    weighting = weighting or cfg.universe["weighting"]
    benchmark = cfg.ingest["benchmark_alias"]
    support_ihsg = None
    ihsg = load_bars(conn, benchmark, week_end)
    if len(ihsg) > cfg.weekly["plan"]["donchian_fast"]:
        support_ihsg = float(ihsg["low"].iloc[-cfg.weekly["plan"]["donchian_fast"] :].min())

    out: dict[str, dict] = {}
    for pick in picks:
        row = pick["row"]
        ticker = row["ticker"]
        bars = load_bars(conn, ticker, week_end)
        # Level plan dari bar `<= week_end` (B18b); `stock_metrics` hanya menyumbang turnover (gerbang `tipis`).
        metrics = metrics_for(conn, ticker, week_end)
        metrics.update(indicators_from_bars(bars, cfg))
        sector_code = conn.execute("SELECT code FROM sector WHERE id = ?", (row["sector_id"],)).fetchone()
        quadrant = None
        if sector_code:
            found = conn.execute(SECTOR_QUADRANT_SQL, (weighting, sector_code[0], week_end)).fetchone()
            quadrant = found[0] if found else None
        regime = regime_of(bars, metrics, sector_quadrant=quadrant, cfg=cfg)
        if not metrics.get("atr14"):  # ATR `None` **atau** 0 (harga datar/suspend) → tidak ada level, hindari bagi nol
            out[ticker] = None
            continue
        out[ticker] = plan_levels(
            bars, metrics, regime, ta_stats_for(conn, ticker, cfg), cfg, support_ihsg=support_ihsg
        )
        validate(out[ticker])
    return out


def load_bars(conn, ticker: str, week_end: str) -> pd.DataFrame:
    """Bar penyesuaian sampai `week_end` (kolom: date, close, high, low, volume)."""
    return pd.read_sql(BARS_SQL, conn, params=(ticker, week_end))


def indicators_from_bars(bars: pd.DataFrame, cfg) -> dict:
    """SMA20/50, RSI14 (Wilder), ATR14 (Wilder), vol20 dari bar `date <= week_end` (docs/03 §6.4.1).

    Bukan dari `stock_metrics`: snapshot itu hanya punya `as_of` terakhir (ADR-021) sehingga pekan
    lama tak bisa direplay dan pekan terakhir bisa membaca bar **setelah** `week_end` (look-ahead).
    Rumusnya sama dengan `metrics.py` (rolling mean + Wilder) → nilainya konsisten bila `close == adj_close`.
    """
    close = bars["close"].astype(float)

    def _last(series: pd.Series) -> float | None:
        value = series.iloc[-1] if len(series) else None
        return None if value is None or pd.isna(value) else float(value)

    volume = bars["volume"].astype(float).iloc[-cfg.chart["volume_ma"] :]
    volume = volume[volume > 0]
    return {
        "sma20": _last(close.rolling(20).mean()),
        "sma50": _last(close.rolling(50).mean()),
        "rsi14": _last(indicators.rsi(close)),
        "atr14": _last(indicators.atr(bars["high"].astype(float), bars["low"].astype(float), close)),
        "vol20": float(volume.mean()) if len(volume) else None,
    }


def metrics_for(conn, ticker: str, _week_end: str | None = None) -> dict:
    """Turnover median terakhir dari `stock_metrics` — gerbang rezim `tipis` saja (level plan dari bar, B18b)."""
    row = conn.execute(METRICS_SQL, (ticker,)).fetchone()
    return dict(row) if row else {}


# --- B20: plan & skenario untuk SEMUA emiten (docs/03 §6.5) ---

FAR_FUTURE = "9999-12-31"  # batas atas tanggal: "bar terakhir yang tersedia"

# Alasan rezim (docs/03 §6.4.0 → docs/05 §2 `regime.reason`) — dipakai `weekly/picks` dan `/plan/stock`.
REGIME_REASON = {
    "tren_naik": "Harga di atas penyangga 20 & 50 hari dan penyangganya menanjak — alat utama pantulan ke penyangga.",
    "range": "Penyangga 20 & 50 hari berdekatan (pasar menyamping) — alat utama level pantulan di kanal.",
    "turun": "Harga di bawah penyangga 20 & 50 hari — mode gagal saat turun, tidak ambil posisi.",
    "tipis": "Transaksi harian jarang atau banyak bar tanpa volume — hanya level pantulan, tanpa konfirmasi volume.",
    "tidak_cukup_data": "Riwayat harga belum cukup untuk menghitung level.",
}

ACTIVE_STOCKS_SQL = """
    SELECT ticker FROM stock WHERE is_active = 1 ORDER BY ticker
"""
STOCK_EVENTS_SQL = """
    SELECT entry_date, entry_price, result FROM ta_breakout
    WHERE scope = 'stock' AND ref_id = ? AND ma_period = ? AND trend_filter = ?
    ORDER BY entry_date
"""
STOCK_PLAN_COLUMNS = (
    "as_of_date", "ticker", "regime", "entry_tool", "confirm_tool", "entry_mode",
    "entry_zone_low", "entry_zone_high", "stop", "stop_pct", "stop_basis", "tp1", "tp2",
    "rr_tp1", "rr_tp2", "volume_ratio", "hold_median_periods", "hit_tp1", "hit_tp2",
    "p_tp1_first", "p_sl_first", "p_timeout", "p_tp2_first", "median_periods_tp1", "median_periods_sl",
    "n_events", "invalidation", "summary_lines", "plan_ok", "notes", "plan_json", "computed_at",
)
STOCK_PLAN_SQL = (
    f"INSERT INTO stock_plan ({', '.join(STOCK_PLAN_COLUMNS)}) "
    f"VALUES ({', '.join('?' * len(STOCK_PLAN_COLUMNS))}) "
    "ON CONFLICT(as_of_date, ticker) DO UPDATE SET "
    + ", ".join(f"{column} = excluded.{column}" for column in STOCK_PLAN_COLUMNS if column not in ("as_of_date", "ticker"))
)


def scenario_basis(cfg) -> str:
    """Basis angka skenario (docs/03 §6.5.2) — dipakai saat menghitung dan saat endpoint membacanya."""
    return (
        f"penembusan penyangga {cfg.ta['ma_default']} hari "
        f"({'filter tren aktif' if cfg.ta['trend_filter'] else 'tanpa filter tren'}), "
        f"horizon {cfg.ta['timeout_periods']} bar"
    )


def first_touch(
    bars: pd.DataFrame,
    entry_date: str,
    up_pct: float,
    down_pct: float,
    horizon: int,
    *,
    entry_price: float | None = None,
) -> tuple[str, int | None]:
    """Bar yang **lebih dulu** menyentuh `+up_pct` atau `−down_pct` (docs/03 §10.9).

    Urutan bar yang menentukan, bukan MFE/MAE: seri yang menyentuh target lalu berbalik ke batas rugi
    tetap dihitung "target lebih dulu". `entry_price` = harga entry bar D (dari `ta_breakout`).
    """
    window = bars[bars["date"] >= entry_date]
    if window.empty:
        return "open", None
    base = float(entry_price) if entry_price else float(window["close"].iloc[0])
    if not base:  # harga entry 0 (data rusak/suspend) → tidak ada perubahan % yang bisa dihitung
        return "open", None
    closes = window["close"].tolist()
    for period, close in enumerate(closes[: horizon + 1]):
        change = close / base - 1
        if change <= -down_pct:
            return "down", period
        if change >= up_pct:
            return "up", period
    if len(closes) > horizon:
        return "timeout", horizon
    return "open", None


def scenario(events: list[dict], bars: pd.DataFrame, levels: dict | None, cfg) -> dict | None:
    """Frekuensi historis pada level plan hari ini (docs/03 §6.5.2) — bukan ramalan, bukan MFE.

    `n_events < weekly.plan.min_events_scenario` → `None` (UI: "belum cukup riwayat").
    """
    plan_cfg = cfg.weekly["plan"]
    usable = [event for event in events if event["result"] != "open"]
    n_open = len(events) - len(usable)
    if levels is None or len(usable) < plan_cfg["min_events_scenario"]:
        return None

    ahead = behind = timeout = ahead2 = 0
    periods_ahead: list[int] = []
    periods_behind: list[int] = []
    horizon = cfg.ta["timeout_periods"]
    for event in usable:
        touch, periods = first_touch(bars, event["entry_date"], levels["tp1_pct"], levels["stop_pct"], horizon, entry_price=event["entry_price"])
        touch2, _ = first_touch(bars, event["entry_date"], levels["tp2_pct"], levels["stop_pct"], horizon, entry_price=event["entry_price"])
        if touch == "up":
            ahead += 1
            if periods is not None:
                periods_ahead.append(periods)
        elif touch == "down":
            behind += 1
            if periods is not None:
                periods_behind.append(periods)
        else:
            timeout += 1
        if touch2 == "up":
            ahead2 += 1

    total = len(usable)
    return {
        "p_tp1_first": round(ahead / total, 4),
        "p_sl_first": round(behind / total, 4),
        "p_timeout": round(timeout / total, 4),
        "p_tp2_first": round(ahead2 / total, 4),
        "median_periods_tp1": median(periods_ahead) if periods_ahead else None,
        "median_periods_sl": median(periods_behind) if periods_behind else None,
        "n_events": total,
        "n_open_dikeluarkan": n_open,
    }


def summary_lines(bars, metrics: dict, regime: str, plan: dict | None, scenario_stats: dict | None, cfg) -> list[str]:
    """1–3 kalimat (docs/03 §6.5.1), tiap kalimat ≤ 140 char, tanpa istilah mentah."""
    lines: list[str] = []
    close = float(bars["close"].iloc[-1]) if len(bars) else None
    sma20, sma50 = metrics.get("sma20"), metrics.get("sma50")
    if close and sma20 and sma50:
        lines.append(
            _trim(
                f"Harga {format_id_number(close)} {'di atas' if close >= sma20 else 'di bawah'} penyangga 20 hari "
                f"({format_id_number(sma20)}) dan {'di atas' if close >= sma50 else 'di bawah'} penyangga 50 hari "
                f"({format_id_number(sma50)}); rezim: {REGIME_LABEL.get(regime, regime)}."
            )
        )
    if plan and plan.get("plan_ok"):
        lines.append(
            _trim(
                f"Zona beli {format_id_number(plan['entry_zone']['low'])}–{format_id_number(plan['entry_zone']['high'])}, "
                f"batas rugi {format_id_number(plan['stop']['level'])} ({format_id_number(abs(plan['stop']['pct']) * 100)}%), "
                f"target {format_id_number(plan['tp1']['level'])} ({format_id_number(plan['tp1']['pct'] * 100)}%) dan "
                f"{format_id_number(plan['tp2']['level'])} ({format_id_number(plan['tp2']['pct'] * 100)}%); "
                f"imbal hasil terhadap risiko {format_id_number(plan['tp2']['rr'])}:1."
            )
        )
    if scenario_stats:
        lines.append(
            _trim(
                f"Dari {scenario_stats['n_events']} penembusan sebelumnya: target pertama kena "
                f"{format_id_number(scenario_stats['p_tp1_first'] * 100)}% (median "
                f"{format_id_number(scenario_stats['median_periods_tp1'] or 0)} bar), batas rugi kena lebih dulu "
                f"{format_id_number(scenario_stats['p_sl_first'] * 100)}%."
            )
        )
    elif regime == "tidak_cukup_data":
        lines.append(_trim("Belum cukup riwayat untuk menaksir peluang pada level ini."))
    else:
        n_events = (plan or {}).get("hold", {}).get("n_events") or 0
        lines.append(_trim(f"Belum cukup riwayat untuk menaksir peluang pada level ini (baru {n_events} penembusan)."))
    for note in (plan or {}).get("notes", []) or []:
        if len(lines) >= 3:
            break
        lines.append(_trim(note))
    return lines[:3]


def plan_for_all(conn, cfg, report=None) -> dict:
    """Plan + skenario untuk **semua** emiten aktif (docs/03 §6.5) → upsert `stock_plan` hari ini.

    Mesin yang sama dengan pick mingguan (`build_plans` → `plan_levels`); hanya lingkupnya berbeda.
    `report(rows=…, rows_total=…, message=…)` menulis progres tiap 50 emiten.
    """
    plan_cfg = cfg.weekly["plan"]
    ma = cfg.ta["ma_default"]
    trend = 1 if cfg.ta["trend_filter"] else 0
    now = datetime.now(ZoneInfo(cfg.app.timezone)).isoformat(timespec="seconds")
    benchmark_bars = load_bars(conn, cfg.ingest["benchmark_alias"], FAR_FUTURE)
    support_ihsg = (
        float(benchmark_bars["low"].iloc[-plan_cfg["donchian_fast"] :].min())
        if len(benchmark_bars) > plan_cfg["donchian_fast"]
        else None
    )

    refs = [row["ticker"] for row in conn.execute(ACTIVE_STOCKS_SQL)]
    written = skipped = null_scenario = 0
    for index, ticker in enumerate(refs, 1):
        bars = load_bars(conn, ticker, FAR_FUTURE)
        if not len(bars):
            continue
        as_of = str(bars["date"].iloc[-1])
        row = {"as_of_date": as_of, "ticker": ticker, "computed_at": now}
        if len(bars) < cfg.ta["min_history"]:
            plan, stats = None, None
            regime = "tidak_cukup_data"
            summaries = [_trim(f"Riwayat harga baru {len(bars)} bar — belum cukup untuk menghitung level.")]
            skipped += 1
        else:
            metrics = metrics_for(conn, ticker)
            metrics.update(indicators_from_bars(bars, cfg))
            sector = conn.execute("SELECT code FROM sector WHERE id = (SELECT sector_id FROM stock WHERE ticker = ?)", (ticker,)).fetchone()
            quadrant = (
                conn.execute(SECTOR_QUADRANT_SQL, (cfg.universe["weighting"], sector[0], as_of)).fetchone() if sector else None
            )
            regime = regime_of(bars, metrics, sector_quadrant=quadrant[0] if quadrant else None, cfg=cfg)
            if not metrics.get("atr14"):  # ATR `None` **atau** 0 (harga datar/suspend) → tidak ada level, hindari bagi nol
                plan = None
            else:
                plan = plan_levels(bars, metrics, regime, ta_stats_for(conn, ticker, cfg), cfg, support_ihsg=support_ihsg)
                validate(plan)
            events = [dict(event) for event in conn.execute(STOCK_EVENTS_SQL, (ticker, ma, trend))]
            # Plan tanpa level (`no_trade`/data kurang) → tidak ada level untuk diukur skenarionya.
            levels = (
                {
                    "tp1_pct": plan["tp1"]["pct"],
                    "tp2_pct": plan["tp2"]["pct"],
                    "stop_pct": abs(plan["stop"]["pct"]),
                }
                if plan and plan["stop"]["pct"] is not None and plan["tp1"]["pct"] is not None and plan["tp2"]["pct"] is not None
                else None
            )
            stats = scenario(events, bars, levels, cfg)
            summaries = summary_lines(bars, metrics, regime, plan, stats, cfg)
        if stats is None:
            null_scenario += 1

        level_values = (
            key_levels(plan)
            if plan
            else {
                # `plan_ok` NOT NULL di DDL → tanpa plan = 0 (tidak layak dipakai), bukan NULL.
                column: (0 if column == "plan_ok" else None)
                for column in STOCK_PLAN_COLUMNS
                if column not in ("as_of_date", "ticker", "computed_at")  # dikunci terpisah di atas
            }
        )
        level_values["regime"] = regime
        row.update(level_values)
        row.update(
            {
                "p_tp1_first": stats["p_tp1_first"] if stats else None,
                "p_sl_first": stats["p_sl_first"] if stats else None,
                "p_timeout": stats["p_timeout"] if stats else None,
                "p_tp2_first": stats["p_tp2_first"] if stats else None,
                "median_periods_tp1": stats["median_periods_tp1"] if stats else None,
                "median_periods_sl": stats["median_periods_sl"] if stats else None,
                "n_events": stats["n_events"] if stats else (plan["hold"]["n_events"] if plan else 0),
                "summary_lines": json.dumps(summaries, ensure_ascii=False),
                "notes": json.dumps((plan or {}).get("notes", []), ensure_ascii=False),
            }
        )
        conn.execute(STOCK_PLAN_SQL, tuple(row[column] for column in STOCK_PLAN_COLUMNS))
        written += 1
        if report and (index % 50 == 0 or index == len(refs)):
            report(rows=written, rows_total=len(refs), message=f"emiten {index}/{len(refs)}")
    conn.commit()
    return {"rows": written, "refs": len(refs), "skipped_short_history": skipped, "scenario_null_refs": null_scenario}


def stock_plan_row(conn, ticker: str, as_of: str | None = None) -> dict | None:
    """Baris `stock_plan` terakhir (atau `as_of` tertentu) — satu sumber untuk `/plan/stock` & `/series/stock`."""
    sql = "SELECT * FROM stock_plan WHERE ticker = ?"
    params: tuple = (ticker,)
    if as_of:
        sql += " AND as_of_date <= ?"
        params += (as_of,)
    found = conn.execute(sql + " ORDER BY as_of_date DESC LIMIT 1", params).fetchone()
    return dict(found) if found else None
