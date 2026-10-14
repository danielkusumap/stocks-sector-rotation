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


LEADING_QUADRANTS = ("leading", "improving")


def _mid(group: list[tuple[str, float]]) -> float:
    return sum(value for _, value in group) / len(group)


def sector_gate(conn, sector_code: str | None, as_of: str, cfg) -> tuple[bool | None, str | None]:
    """Gerbang sektor (docs/03 §6.4.0) dinilai di beberapa bobot.

    Satu bobot saja bisa menyesatkan: sektor yang sama di pekan yang sama bisa `weakening` menurut
    bobot `equal` tapi `improving` menurut `turnover`. Lolos bila ≥ `sector_gate_min_pass` bobot
    menyatakan memimpin/memperbaiki. `None` = tidak ada data kuadran (gerbang dilewati).
    """
    plan = cfg.weekly["plan"]
    if not sector_code:
        return None, None
    weightings = plan.get("sector_gate_weightings") or [cfg.universe["weighting"]]
    known = []
    for weighting in weightings:
        row = conn.execute(SECTOR_QUADRANT_SQL, (weighting, sector_code, as_of)).fetchone()
        if row and row[0]:
            known.append((weighting, row[0]))
    if not known:
        return None, None
    passed = sum(1 for _, quadrant in known if quadrant in LEADING_QUADRANTS)
    needed = min(plan["sector_gate_min_pass"], len(known))
    ok = passed >= needed
    detail = ", ".join(f"{weighting} {quadrant}" for weighting, quadrant in known)
    if ok:
        return True, _trim(
            f"Gerbang sektor lolos: {passed} dari {len(known)} bobot memimpin/memperbaiki ({detail})."
        )
    return False, _trim(
        f"Gerbang sektor belum lolos: baru {passed} dari {len(known)} bobot memimpin/memperbaiki ({detail}) — tunggu kuadran membaik."
    )


def _volume_node(features: dict, cfg) -> float | None:
    """Harga dengan volume terbesar 20 bar (median harga bar bervolume di atas rata-rata)."""
    plan = cfg.weekly["plan"]
    window = plan["donchian_fast"]
    closes, volumes = features.get("close_arr"), features.get("vol_arr")
    if closes is None or volumes is None or len(closes) < window:
        return None
    pairs = [(float(c), float(v)) for c, v in zip(closes.iloc[-window:], volumes.iloc[-window:]) if v and v > 0]
    if not pairs:
        return None
    average = sum(v for _, v in pairs) / len(pairs)
    heavy = sorted(c for c, v in pairs if v >= average)
    return heavy[len(heavy) // 2] if heavy else None


def _anchors(features: dict, levels: dict, cfg) -> list[tuple[str, float]]:
    """Acuan harga yang bisa dipakai sebagai pusat zona (docs/03 §6.4.2) — bukan hanya SMA20."""
    plan = cfg.weekly["plan"]
    candidates: list[tuple[str, float | None]] = [
        ("penyangga 20 hari", features.get("sma20")),
        ("penyangga 50 hari", features.get("sma50")),
        ("puncak 20 hari sebelumnya", features.get("don_high_prev")),
        ("terendah 10 hari", features.get("swing_low")),
        ("batas kanal bawah", levels.get("support")),
        ("simpul volume 20 hari", _volume_node(features, cfg)),
    ]
    leg_low, leg_high = features.get("don_low_f"), features.get("don_high_s")
    if leg_low and leg_high and leg_high > leg_low:
        span = leg_high - leg_low
        for ratio in plan["retrace_ratios"]:
            candidates.append((f"koreksi {format_id_number(ratio * 100, 1)}%", leg_high - ratio * span))
    return [(label, float(value)) for label, value in candidates if value and value > 0]


def _entry_zone(features: dict, levels: dict, cfg, fallback: float, regime: str) -> tuple[float, float, float, str]:
    """Zona entry = kelompok acuan yang paling banyak berkumpul, lebarnya adaptif (docs/03 §6.4.2).

    Pusat zona bukan satu level formula: semua acuan (MA, puncak sebelumnya, swing low, koreksi Fibonacci,
    simpul volume) dikelompokkan dengan toleransi `anchor_tol_atr` × ATR; kelompok terbesar menang.
    Kalau tidak ada kelompok yang cukup (`anchor_min_count`), dipakai acuan rezim saja.
    """
    plan = cfg.weekly["plan"]
    close, atr = features["close"], features["atr14"]
    tolerance = plan["anchor_tol_atr"] * atr
    anchors = sorted(_anchors(features, levels, cfg), key=lambda item: item[1])
    clusters: list[list[tuple[str, float]]] = []
    for index, anchor in enumerate(anchors):
        group = [other for other in anchors[index:] if other[1] - anchor[1] <= tolerance]
        if group:
            clusters.append(group)
    eligible = [group for group in clusters if len(group) >= plan["anchor_min_count"]]
    below_eligible = [group for group in eligible if _mid(group) <= close]
    below_any = [group for group in clusters if _mid(group) <= close]
    if below_eligible:
        center_group, relaxed = max(below_eligible, key=_mid), False  # support terdekat di bawah harga
    elif below_any:
        center_group, relaxed = max(below_any, key=_mid), True  # relaksasi: satu acuan di bawah harga tetap dipakai
    elif eligible:
        center_group, relaxed = min(eligible, key=_mid), False  # semua acuan di atas harga (mode breakout)
    else:
        center_group, relaxed = [], True
    if center_group and (not relaxed or len(center_group) >= 1):
        chosen, labels = center_group, ", ".join(label for label, _ in center_group)
        reason = f"Zona dari {len(chosen)} acuan berdekatan ({labels})."
    else:
        chosen = [(ANCHOR_FALLBACK.get(regime, "level acuan"), fallback)]
        reason = f"Belum ada acuan yang berkumpul; zona memakai {chosen[0][0]} saja."
    center = sum(value for _, value in chosen) / len(chosen)
    half = max(plan["zone_atr"] * atr, plan["zone_min_pct"] * close)
    if regime == "tipis":
        half *= plan["zone_thin_mult"]
    return center - half, center + half, center, _trim(reason)


def _zone_status(close: float, zone_high: float, atr: float, cfg) -> str:
    """Seberapa dekat harga sekarang ke zona entry — supaya pick yang zonanya jauh tidak dibaca sebagai siap beli.

    Ambang sentuh (`zone_touch_atr`, default 0,25) ada supaya harga yang hanya `0,1 × ATR` di atas zona
    tidak salah dilabeli "mendekati" padahal praktis menempel (temuan 14 Okt 2026: MEDC 1.450 vs zona 1.444).
    """
    plan = cfg.weekly["plan"]
    gap = (close - zone_high) / atr if atr else 0.0
    if gap <= plan.get("zone_touch_atr", 0.0):
        return "di_zona"
    if gap <= plan["zone_near_atr"]:
        return "mendekati"
    if gap <= plan["zone_far_atr"]:
        return "jauh"
    return "sangat_jauh"


ANCHOR_FALLBACK = {"tren_naik": "penyangga 20 hari", "range": "batas kanal bawah", "tipis": "level pantulan"}


def regime_of(bars: pd.DataFrame, metrics: dict, *, sector_quadrant: str | None, cfg, sector_ok: bool | None = None) -> str:
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
    if close > sma20 > sma50 and rising and (sector_ok if sector_ok is not None else sector_quadrant in LEADING_QUADRANTS):
        return "tren_naik"
    return "range"  # sisa: tidak ada tren naik yang sah → konservatif (menyamping)


def _features(bars: pd.DataFrame, metrics: dict, cfg) -> dict:
    plan = cfg.weekly["plan"]
    close = float(bars["close"].iloc[-1])
    close_series = bars["close"].astype(float)
    high, low, volume = bars["high"], bars["low"], bars["volume"]
    vol20 = volume.iloc[-cfg.chart["volume_ma"] :]
    vol20 = vol20[vol20 > 0]
    return {
        "close": close,
        "high": high,
        "low": low,
        "close_arr": close_series,
        "vol_arr": volume,
        "turnover": metrics.get("median_turnover_20d_idr"),
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
        "zone_status": None,
        "zone_pct": None,
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


def plan_levels(bars: pd.DataFrame, metrics: dict, regime: str, ta_stats: dict, cfg, *, support_ihsg: float | None = None, sector_ok: bool | None = None, sector_note: str | None = None) -> dict:
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
        # Rezim menyamping: alat utama kanal S/R. Konfirmasi momentum dipakai sebagai PERINGATAN, bukan
        # penolakan — kalau tidak, hampir semua nama di pasar sideways kehilangan rencana (revisi 14 Okt 2026).
        level = levels["support"] or sma20 or features["swing_low"]
        if level is None:
            return _empty_plan(regime, "Pasar menyamping tanpa batas bawah yang jelas (kanal belum terbentuk); tidak ambil posisi.")
        entry_tool, entry_mode = "sr_channel", "pullback"
        if (features["rsi14"] or 0) <= plan["rsi_range_max"]:
            confirm = "rsi_tepi_range"
        else:
            confirm = "none"
            notes.append(
                _trim(
                    f"Momentum harian {format_id_number(features['rsi14'] or 0)} belum di tepi bawah "
                    f"(maksimal {format_id_number(plan['rsi_range_max'])}) — tunggu RSI mendingin sebelum entry di zona."
                )
            )
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

    zone_low, zone_high, entry_mid, anchor_reason = _entry_zone(features, levels, cfg, fallback=level, regime=regime)
    zone_reason = f"{zone_reason} {anchor_reason}"
    zone_status = _zone_status(close, zone_high, atr, cfg)
    if not entry_mid:  # harga acuan 0 → tidak ada level yang bisa dihitung
        return _empty_plan(regime, "Harga acuan tidak terbaca; level tidak dihitung supaya tidak mengarang angka.")
    stop = _stop(features, entry_mid, regime, cfg)
    stop["pct"] = _pct(stop["level"], entry_mid)
    tp1, tp2 = _targets(features, entry_mid, stop["level"], regime, levels, cfg)
    if tp1["level"] is not None and tp2["level"] is not None and tp2["level"] < tp1["level"]:
        # Urutan target harus naik: TP1 selalu lebih dekat dari TP2 (temuan 14 Okt 2026, mis. MEDC 1784/1702).
        tp1["level"], tp2["level"] = tp2["level"], tp1["level"]
        tp1["basis"], tp2["basis"] = tp2["basis"], tp1["basis"]
        tp1["pct"], tp2["pct"] = _pct(tp1["level"], entry_mid), _pct(tp2["level"], entry_mid)
        cost = (plan["fee_buy_bps"] + plan["fee_sell_bps"]) / 10_000
        risk = entry_mid - stop["level"]
        for target in (tp1, tp2):
            target["rr"] = (target["level"] - entry_mid - cost * entry_mid) / (risk + cost * entry_mid)

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
    turnover = features.get("turnover")
    if turnover is not None and turnover < plan["min_turnover_idr"]:
        # Permintaan user 14 Okt 2026: saham tidak likuid tidak boleh lolos sebagai rencana yang dipakai.
        plan_ok = False
        notes.append(
            _trim(
                f"Nilai transaksi harian {format_id_number(turnover / 1_000_000_000, 2)} M di bawah ambang "
                f"{format_id_number(plan['min_turnover_idr'] / 1_000_000_000, 0)} M — terlalu tipis untuk swing."
            )
        )
    if n_events < plan["min_events_plan"] or (ta_stats.get("win_rate") or 0) < plan["min_win_rate_plan"]:
        # Sejak 14 Okt 2026 statistik breakout-MA hanya catatan, bukan gerbang plan_ok (keputusan user:
        # win-rate sistem MA diabaikan — ia menguji sistem lain, bukan zona plan ini).
        notes.append(
            _trim(
                f"Catatan (bukan penolakan): riwayat sinyal MA {n_events} kejadian, win-rate "
                f"{format_id_number((ta_stats.get('win_rate') or 0) * 100)}% — di bawah acuan "
                f"{plan['min_events_plan']} kejadian / {format_id_number(plan['min_win_rate_plan'] * 100)}%."
            )
        )
    if sector_note:
        notes.append(sector_note)
        if sector_ok is False:
            plan_ok = False
    if zone_status in ("jauh", "sangat_jauh"):
        notes.append(
            _trim(
                f"Zona entry masih {format_id_number((close - zone_high) / atr, 1)} kali volatilitas harian di bawah harga — tunggu pullback, jangan chase."
            )
        )

    return {
        "regime": regime,
        "entry_tool": entry_tool,
        "confirm_tool": confirm,
        "entry_mode": entry_mode,
        "entry_zone": {"low": zone_low, "high": zone_high, "reason": _trim(zone_reason)},
        "zone_status": zone_status,
        "zone_pct": (zone_high - zone_low) / entry_mid if entry_mid else None,
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
        sector_ok, sector_note = sector_gate(conn, sector_code[0] if sector_code else None, week_end, cfg)
        regime = regime_of(bars, metrics, sector_quadrant=None, cfg=cfg, sector_ok=sector_ok)
        if not metrics.get("atr14"):  # ATR `None` **atau** 0 (harga datar/suspend) → tidak ada level, hindari bagi nol
            out[ticker] = None
            continue
        out[ticker] = plan_levels(
            bars, metrics, regime, ta_stats_for(conn, ticker, cfg), cfg, support_ihsg=support_ihsg,
            sector_ok=sector_ok, sector_note=sector_note,
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
    "range": "Belum ada tren naik yang sah (harga/penyangga menyamping atau sektor belum memimpin) — alat utama level pantulan di kanal.",
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
    "n_events", "invalidation", "summary_lines", "plan_ok", "notes", "plan_json", "computed_at", "last_bar_date",
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


def plan_for_all(conn, cfg, report=None, as_of: str | None = None, persist_picks: bool = True) -> dict:
    """Plan + skenario untuk **semua** emiten aktif (docs/03 §6.5) → upsert `stock_plan` per `as_of_date`.

    `as_of` = hitung dari bar `date <= as_of` (docs/03 §6.4.1); `None` = bar terakhir tiap emiten (perilaku lama).
    Mesin yang sama dengan pick mingguan (`build_plans` → `plan_levels`); hanya lingkupnya berbeda.
    `report(rows=…, rows_total=…, message=…)` menulis progres tiap 50 emiten.
    """
    plan_cfg = cfg.weekly["plan"]
    ma = cfg.ta["ma_default"]
    trend = 1 if cfg.ta["trend_filter"] else 0
    requested_as_of = as_of  # loop di bawah memakai nama `as_of` untuk tanggal bar tiap emiten
    # Cutoff = satu tanggal untuk SELURUH run (B20e): `as_of` yang diminta, atau bar terakhir di DB.
    # Sebelumnya `as_of_date` baris diisi tanggal bar terakhir tiap emiten → satu run terpecah ke dua keranjang.
    cutoff = (
        requested_as_of
        or conn.execute("SELECT MAX(date) FROM price_daily").fetchone()[0]
        or FAR_FUTURE
    )
    now = datetime.now(ZoneInfo(cfg.app.timezone)).isoformat(timespec="seconds")
    benchmark_bars = load_bars(conn, cfg.ingest["benchmark_alias"], cutoff)
    support_ihsg = (
        float(benchmark_bars["low"].iloc[-plan_cfg["donchian_fast"] :].min())
        if len(benchmark_bars) > plan_cfg["donchian_fast"]
        else None
    )

    refs = [row["ticker"] for row in conn.execute(ACTIVE_STOCKS_SQL)]
    written = skipped = null_scenario = 0
    for index, ticker in enumerate(refs, 1):
        bars = load_bars(conn, ticker, cutoff)
        if not len(bars):
            continue
        as_of = str(bars["date"].iloc[-1])  # bar terakhir emiten ini (≤ cutoff) → `last_bar_date`
        row = {"as_of_date": cutoff, "ticker": ticker, "last_bar_date": as_of, "computed_at": now}
        if len(bars) < cfg.ta["min_history"]:
            plan, stats = None, None
            regime = "tidak_cukup_data"
            summaries = [_trim(f"Riwayat harga baru {len(bars)} bar — belum cukup untuk menghitung level.")]
            skipped += 1
        else:
            metrics = metrics_for(conn, ticker)
            metrics.update(indicators_from_bars(bars, cfg))
            sector = conn.execute("SELECT code FROM sector WHERE id = (SELECT sector_id FROM stock WHERE ticker = ?)", (ticker,)).fetchone()
            sector_ok, sector_note = sector_gate(conn, sector[0] if sector else None, as_of, cfg)
            regime = regime_of(bars, metrics, sector_quadrant=None, cfg=cfg, sector_ok=sector_ok)
            if not metrics.get("atr14"):  # ATR `None` **atau** 0 (harga datar/suspend) → tidak ada level, hindari bagi nol
                plan = None
            else:
                plan = plan_levels(
                    bars, metrics, regime, ta_stats_for(conn, ticker, cfg), cfg, support_ihsg=support_ihsg,
                    sector_ok=sector_ok, sector_note=sector_note,
                )
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
                if column not in ("as_of_date", "ticker", "computed_at", "last_bar_date")  # dikunci terpisah di atas
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
    picks_saved = 0
    if persist_picks and written:
        # Hasil saring disimpan di sini (bukan saat request) supaya `/plan/picks` hanya membaca tabel (B20d).
        persist_as_of = requested_as_of or conn.execute("SELECT MAX(as_of_date) FROM stock_plan").fetchone()[0]
        picks_saved = screen_picks(conn, cfg, as_of=persist_as_of, persist=True)["screened"]
    return {
        "rows": written, "refs": len(refs), "skipped_short_history": skipped,
        "scenario_null_refs": null_scenario, "picks_saved": picks_saved,
    }


def stock_plan_row(conn, ticker: str, as_of: str | None = None) -> dict | None:
    """Baris `stock_plan` terakhir (atau `as_of` tertentu) — satu sumber untuk `/plan/stock` & `/series/stock`."""
    sql = "SELECT * FROM stock_plan WHERE ticker = ?"
    params: tuple = (ticker,)
    if as_of:
        sql += " AND as_of_date <= ?"
        params += (as_of,)
    found = conn.execute(sql + " ORDER BY as_of_date DESC LIMIT 1", params).fetchone()
    return dict(found) if found else None


# --- Picks terkurasi: `GET /plan/picks` (aturan saring 14 Okt 2026, docs/05 §2) ----------------

PICKS_RULES = (
    "Likuiditas: median transaksi 20 hari ≥ `?min_turnover` (default `weekly.plan.min_turnover_idr`).",
    "Gerbang sektor: ≥ `sector_gate_min_pass` dari 3 bobot (`equal`/`turnover`/`captier`) pada `w1_fri` memimpin/memperbaiki.",
    "Rezim `tren_naik` atau `range` — `tipis`/`turun` dibuang.",
    "ATR14 ≤ `picks_atr_max_pct` × harga.",
    "Lebar zona ≤ `picks_zone_max_atr` × ATR14.",
    "Batas rugi ≤ `picks_stop_max_pct` × harga.",
    "Imbal hasil TP2 ≥ `rr_min_tp2` setelah biaya.",
    "Label zona `di_zona` (gap ≤ `zone_touch_atr`) atau `mendekati` (gap ≤ `zone_near_atr`).",
    "Denyut sektor harian (d1) ≥ `picks_sector_pulse_min` di semua bobot `picks_sector_pulse_weightings`.",
)

PICKS_SQL = """
    SELECT p.ticker, st.name, sec.code AS sector_code, p.regime, p.entry_zone_low, p.entry_zone_high,
           p.stop, p.stop_pct, p.stop_basis, p.tp1, p.tp2, p.rr_tp1, p.rr_tp2, p.plan_json,
           m.close, m.atr14, m.rsi14, m.median_turnover_20d_idr
      FROM stock_plan p
      JOIN stock st ON st.ticker = p.ticker
      JOIN sector sec ON sec.id = st.sector_id
      JOIN stock_metrics m ON m.ticker = p.ticker AND m.timeframe = 'd1'
      JOIN (SELECT ticker, MAX(as_of_date) AS as_of_date FROM stock_metrics WHERE timeframe = 'd1' GROUP BY ticker) mm
        ON mm.ticker = m.ticker AND mm.as_of_date = m.as_of_date
     WHERE p.as_of_date = ?
     ORDER BY p.ticker
"""

SECTOR_SCORE_SQL = """
    SELECT score FROM rrg_daily
     WHERE scope = 'sector' AND ref_id = ? AND weighting = ? AND timeframe = ? AND as_of_date <= ?
     ORDER BY as_of_date DESC LIMIT 1
"""

SECTOR_PULSE_SQL = """
    SELECT sm.score FROM sector_metrics sm
      JOIN sector s ON s.id = sm.sector_id
     WHERE s.code = ? AND sm.timeframe = 'd1' AND sm.weighting = ? AND sm.as_of_date <= ?
     ORDER BY sm.as_of_date DESC LIMIT 1
"""


def sector_pulse(conn, sector_code: str | None, as_of: str, cfg) -> tuple[dict, bool]:
    """Skor **denyut harian** (d1) per bobot + apakah saring ini bisa dinilai sama sekali.

    Dipakai untuk menahan pick di sektor yang sedang dijual hari itu — penyebab SL yang paling sering
    (pelajaran 14 Okt 2026: pick BARANG BAKU lolos gerbang mingguan padahal skor hariannya lagging).
    `False` = tidak ada metrik d1 sama sekali → saring dilewati, bukan menolak semua.
    """
    plan = cfg.weekly["plan"]
    skor: dict[str, float | None] = {}
    for weighting in plan.get("picks_sector_pulse_weightings") or [cfg.universe["weighting"]]:
        row = conn.execute(SECTOR_PULSE_SQL, (sector_code, weighting, as_of)).fetchone()
        skor[weighting] = float(row["score"]) if row and row["score"] is not None else None
    return skor, any(value is not None for value in skor.values())


def ihsg_support(conn, cfg, week_end: str = FAR_FUTURE) -> float | None:
    """Terendah `donchian_fast` bar IHSG = level jeda entry pasar (docs/03 §6.4.0)."""
    bars = load_bars(conn, cfg.ingest["benchmark_alias"], week_end)
    window = cfg.weekly["plan"]["donchian_fast"]
    return float(bars["low"].iloc[-window:].min()) if len(bars) > window else None


def sector_pick_context(conn, sector_code: str | None, as_of: str, cfg) -> tuple[float | None, dict, int]:
    """Skor sektor (bobot `universe.weighting`) + kuadran tiga bobot `w1_fri` + jumlah bobot yang lolos."""
    plan = cfg.weekly["plan"]
    kuadran: dict[str, str | None] = {}
    for weighting in plan.get("sector_gate_weightings") or [cfg.universe["weighting"]]:
        row = conn.execute(SECTOR_QUADRANT_SQL, (weighting, sector_code, as_of)).fetchone()
        kuadran[weighting] = row[0] if row and row[0] else None
    score = None
    for timeframe in ("w1_fri", "w1"):
        row = conn.execute(SECTOR_SCORE_SQL, (sector_code, cfg.universe["weighting"], timeframe, as_of)).fetchone()
        if row and row["score"] is not None:
            score = float(row["score"])
            break
    lolos = sum(1 for quadrant in kuadran.values() if quadrant in LEADING_QUADRANTS)
    return score, kuadran, lolos


def picks_score(
    gap_atr: float, rr_tp2: float | None, sector_score: float | None, artefak: bool = False
) -> tuple[float, dict]:
    """Urutan picks: kedekatan zona (×3) + R:R TP2 (cap 6) + skor sektor/50 — semua komponen dikembalikan.

    R:R ikut dipotong separuh bila targetnya `artefak` (> `picks_tp_artifact_pct` dari harga): angka R:R
    dari acuan kanal yang jauh bukan imbal hasil yang bisa dieksekusi.
    """
    rr = min(rr_tp2 or 0.0, 6.0)
    rincian = {
        "kedekatan_zona": round(3 * (1 - min(max(gap_atr, 0.0), 1.0)), 3),
        "rr_tp2": round(rr / 2 if artefak else rr, 3),
        "skor_sektor": round((sector_score or 0.0) / 50, 3),
    }
    return round(sum(rincian.values()), 3), rincian


def _picks_rr(entry: float, stop: float, target: float | None, cfg) -> float | None:
    """R:R setelah biaya — rumus sama dengan `plan_levels` supaya angkanya tidak berbeda antar endpoint."""
    if not target or not entry or not stop or entry <= stop:
        return None
    plan = cfg.weekly["plan"]
    cost = (plan["fee_buy_bps"] + plan["fee_sell_bps"]) / 10_000
    return (target - entry - cost * entry) / (entry - stop + cost * entry)


def picks_validity(zone_low: float | None, stop: float | None, tp2: float | None, support_ihsg: float | None) -> dict:
    """Blok valid/batal/kedaluwarsa/selesai — wajib ada di setiap rencana (permintaan user 14 Okt 2026)."""
    return {
        "valid_until": "10:00 WIB sesi bursa berikutnya",
        "valid_if": (
            f"tutup harian masih di atas {format_id_number(zone_low)}"
            + (f" dan IHSG masih di atas {format_id_number(support_ihsg)}" if support_ihsg else "")
        ),
        "invalidate_below": zone_low,
        "expires_if": "zona belum tersentuh sampai 10:00 → rencana gugur; jangan geser zona untuk memaksa masuk",
        "done_if": (
            f"TP2 {format_id_number(tp2)} kena / stop {format_id_number(stop)} kena / kedaluwarsa"
        ),
    }


def _screen_candidates(conn, cfg, as_of: str, ambang: float) -> tuple[list[dict], float | None]:
    """Kandidat yang lolos saring picks untuk satu `as_of` (docs/05 §2) — level dibaca dari `stock_plan`.

    Dipakai dua jalur: compute (`save_picks` menyimpan hasilnya) dan pembacaan langsung (uji/laporan).
    """
    plan = cfg.weekly["plan"]
    support = ihsg_support(conn, cfg)
    kandidat: list[dict] = []
    for row in (conn.execute(PICKS_SQL, (as_of,)) if as_of else ()):
        close, atr = row["close"], row["atr14"]
        detail = json.loads(row["plan_json"]) if row["plan_json"] else {}
        # Zona/stop/target diambil dari `plan_json` lebih dulu: kolom level di `stock_plan` hanya terisi
        # saat `plan_ok=true` (aturan writer), sedangkan saring picks di sini tidak memakai `plan_ok`.
        zona = detail.get("entry_zone") or {}
        stop_detail = detail.get("stop") or {}
        tp1_detail = detail.get("tp1") or {}
        tp2_detail = detail.get("tp2") or {}
        low = zona.get("low") or row["entry_zone_low"]
        high = zona.get("high") or row["entry_zone_high"]
        stop = stop_detail.get("level") or row["stop"]
        stop_pct = stop_detail.get("pct") if stop_detail.get("pct") is not None else row["stop_pct"]
        tp1 = tp1_detail.get("level") or row["tp1"]
        tp2 = tp2_detail.get("level") or row["tp2"]
        rr_tp1 = tp1_detail.get("rr") if tp1_detail.get("rr") is not None else row["rr_tp1"]
        rr_tp2 = tp2_detail.get("rr") if tp2_detail.get("rr") is not None else row["rr_tp2"]
        if not close or not atr or not low or not high or row["median_turnover_20d_idr"] is None:
            continue
        if row["median_turnover_20d_idr"] < ambang or row["regime"] not in ("tren_naik", "range"):
            continue
        if atr / close > plan["picks_atr_max_pct"] or (high - low) > plan["picks_zone_max_atr"] * atr:
            continue
        if abs(stop_pct or 0.0) > plan["picks_stop_max_pct"]:
            continue
        if (rr_tp2 or 0.0) < plan["rr_min_tp2"] - 1e-9:
            continue
        status = _zone_status(close, high, atr, cfg)
        if status not in ("di_zona", "mendekati"):
            continue
        sector_ok, _ = sector_gate(conn, row["sector_code"], as_of, cfg)
        if sector_ok is not True:
            continue
        pulse, ada_pulse = sector_pulse(conn, row["sector_code"], as_of, cfg)
        ambang_pulse = plan["picks_sector_pulse_min"]
        # Ada metrik d1 tapi ada bobot di bawah ambang → sektor sedang dijual hari itu → tahan pick ini.
        # Tanpa metrik d1 sama sekali, saring dilewati (data parsial tidak boleh mengosongkan daftar).
        if ada_pulse and any(value is not None and value < ambang_pulse for value in pulse.values()):
            continue
        entry = (low + high) / 2
        gap_atr = (close - high) / atr
        artefak_pct = 1 + plan["picks_tp_artifact_pct"]
        tp1_artefak = bool(tp1 and tp1 > entry * artefak_pct)
        tp2_artefak = bool(tp2 and tp2 > entry * artefak_pct)
        skor_sektor, kuadran, lolos = sector_pick_context(conn, row["sector_code"], as_of, cfg)
        skor, rincian = picks_score(gap_atr, rr_tp2, skor_sektor, artefak=tp1_artefak or tp2_artefak)
        tp0 = entry + plan["tp1_fallback_atr"] * atr
        kandidat.append(
            {
                "ticker": row["ticker"],
                "name": row["name"],
                "sector_code": row["sector_code"],
                "close": close,
                "turnover_idr": row["median_turnover_20d_idr"],
                "atr14": atr,
                "atr_pct": atr / close,
                "rsi14": row["rsi14"],
                "regime": row["regime"],
                "regime_label": REGIME_LABEL.get(row["regime"], row["regime"]),
                "entry_zone": {"low": low, "high": high, "reason": zona.get("reason", "")},
                "zone_status": status,
                "zone_pct": (high - low) / entry,
                "zone_gap_atr": gap_atr,
                "entry": entry,
                "stop": {
                    "level": stop,
                    "pct": stop_pct,
                    "basis": row["stop_basis"],
                    "reason": stop_detail.get("reason", ""),
                },
                "tp0": {
                    "level": tp0,
                    "pct": tp0 / entry - 1,
                    "rr": _picks_rr(entry, stop, tp0, cfg),
                    "basis": "cepat_1,5atr",
                    "reason": "Target cepat (1,5 × ATR14): ambil sebagian di sini, sisanya dibiarkan ke TP1/TP2.",
                },
                "tp1": {
                    "level": tp1,
                    "pct": (tp1 / entry - 1) if tp1 else None,
                    "rr": rr_tp1,
                    "basis": tp1_detail.get("basis"),
                    "reason": tp1_detail.get("reason", ""),
                },
                "tp2": {
                    "level": tp2,
                    "pct": (tp2 / entry - 1) if tp2 else None,
                    "rr": rr_tp2,
                    "basis": tp2_detail.get("basis"),
                    "reason": tp2_detail.get("reason", ""),
                },
                "tp1_artefak": tp1_artefak,
                "tp2_artefak": tp2_artefak,
                "sector_quadrants": kuadran,
                "sector_score": skor_sektor,
                "sector_pass": lolos,
                "sector_pulse": pulse,
                "sector_pulse_min": ambang_pulse,
                "skor": skor,
                "skor_rincian": rincian,
                "validity": picks_validity(low, stop, tp2, support),
                "notes": detail.get("notes", []),
            }
        )
    kandidat.sort(key=lambda pick: (-pick["skor"], -(pick["turnover_idr"] or 0)))
    return kandidat, support


# Kolom `plan_pick` (docs/04 §4, migrasi 008) — hasil saring disimpan **saat compute**, bukan saat request.
PLAN_PICK_COLUMNS = (
    "as_of_date", "ticker", "rank", "score", "zone_status", "zone_gap_atr", "entry", "stop", "tp1", "tp2",
    "rr_tp2", "sector_code", "quadrant", "rules_version", "payload_json", "computed_at",
)
PLAN_PICK_SQL = (
    f"INSERT INTO plan_pick ({', '.join(PLAN_PICK_COLUMNS)}) "
    f"VALUES ({', '.join('?' * len(PLAN_PICK_COLUMNS))}) "
    "ON CONFLICT(as_of_date, ticker) DO UPDATE SET "
    + ", ".join(f"{column} = excluded.{column}" for column in PLAN_PICK_COLUMNS if column not in ("as_of_date", "ticker"))
)


def save_picks(conn, cfg, as_of: str, kandidat: list[dict]) -> int:
    """Simpan hasil saring satu tanggal ke `plan_pick`: hapus tanggal itu dulu, lalu tulis ulang."""
    conn.execute("DELETE FROM plan_pick WHERE as_of_date = ?", (as_of,))
    now = datetime.now(ZoneInfo(cfg.app.timezone)).isoformat(timespec="seconds")
    version = cfg.weekly["plan"]["picks_rules_version"]
    for rank, pick in enumerate(kandidat, 1):
        row = {
            "as_of_date": as_of,
            "ticker": pick["ticker"],
            "rank": rank,
            "score": pick["skor"],
            "zone_status": pick["zone_status"],
            "zone_gap_atr": pick["zone_gap_atr"],
            "entry": pick["entry"],
            "stop": (pick["stop"] or {}).get("level"),
            "tp1": (pick["tp1"] or {}).get("level"),
            "tp2": (pick["tp2"] or {}).get("level"),
            "rr_tp2": (pick["tp2"] or {}).get("rr"),
            "sector_code": pick["sector_code"],
            "quadrant": (pick["sector_quadrants"] or {}).get(cfg.universe["weighting"]),
            "rules_version": version,
            "payload_json": json.dumps(pick, ensure_ascii=False),
            "computed_at": now,
        }
        conn.execute(PLAN_PICK_SQL, tuple(row[column] for column in PLAN_PICK_COLUMNS))
    conn.commit()
    return len(kandidat)


def available_dates(conn, cfg, limit: int | None = None) -> list[str]:
    """Tanggal yang **punya isi** di `plan_pick`, urut menurun (UI tidak mengarang tanggal)."""
    batas = int(limit or cfg.weekly["plan"]["picks_available_dates"])
    rows = conn.execute("SELECT DISTINCT as_of_date FROM plan_pick ORDER BY as_of_date DESC LIMIT ?", (batas,))
    return [row[0] for row in rows]


def screen_picks(conn, cfg, *, limit=None, min_turnover=None, as_of=None, persist=False) -> dict:
    """≤N rencana terbaik dari `stock_plan` (aturan 14 Okt 2026, docs/05 §2).

    `persist=True` (jalur compute) menyimpan hasil saring ke `plan_pick`; endpoint membacanya lewat
    `load_picks()` supaya satu permintaan tidak perlu menyaring 900+ baris (dulu 20,0 s).
    """
    plan = cfg.weekly["plan"]
    batas = max(1, min(int(limit or plan["picks_limit"]), int(plan["picks_max_limit"])))
    ambang = float(plan["min_turnover_idr"] if min_turnover is None else min_turnover)
    as_of = as_of or conn.execute("SELECT MAX(as_of_date) FROM stock_plan").fetchone()[0]
    kandidat, support = _screen_candidates(conn, cfg, as_of, ambang) if as_of else ([], None)
    if persist and as_of:
        save_picks(conn, cfg, as_of, kandidat)
    return {
        "as_of": as_of, "limit": batas, "min_turnover_idr": ambang, "screened": len(kandidat),
        "ihsg_support": support, "rules": list(PICKS_RULES), "picks": kandidat[:batas],
    }


# --- Status berjalan pick (docs/05 §2 B20d) — dihitung dari bar **setelah** `as_of`, maks horizon+2 bar ---
STATUS_BARS_SQL = """
    SELECT date, adj_close AS close,
           high * adj_close / NULLIF(close, 0) AS high,
           low  * adj_close / NULLIF(close, 0) AS low
    FROM price_daily
    WHERE ticker = ? AND date >= ? AND adj_close IS NOT NULL AND close IS NOT NULL
    ORDER BY date
    LIMIT ?
"""


def _status_note(status: str, levels: dict, bars_since: int, cfg) -> str:
    """Kalimat status ≤140 char, bahasa Indonesia tanpa istilah mentah (docs/05 §2)."""
    stop, tp1, tp2 = levels["stop"], levels["tp1"], levels["tp2"]
    if status == "kena_tp2":
        return _trim(f"Target kedua {format_id_number(tp2)} sudah kena di bar ke-{bars_since} — rencana selesai di sisi untung.")
    if status == "kena_tp1":
        return _trim(f"Target pertama {format_id_number(tp1)} sudah kena (bar ke-{bars_since}); pertimbangkan mengunci sebagian.")
    if status == "kena_stop":
        return _trim(f"Batas rugi {format_id_number(stop)} kena di bar ke-{bars_since} — rencana ini selesai sebagai rugi.")
    if status == "di_zona":
        return _trim("Harga sudah masuk zona beli; target maupun batas rugi belum tersentuh.")
    if status == "kedaluwarsa":
        return _trim(f"Lewat {cfg.ta['timeout_periods']} bar tanpa menyentuh zona, target, atau batas rugi — rencana gugur; jangan kejar harga.")
    return _trim("Zona beli belum tersentuh; tunggu harga masuk atau biarkan rencana gugur.")


def pick_status(conn, ticker: str, as_of: str, pick: dict, cfg) -> dict:
    """Status berjalan satu pick: `menunggu_zona`/`di_zona`/`kena_tp1`/`kena_tp2`/`kena_stop`/`kedaluwarsa`.

    Sentuhan batas rugi diperiksa **lebih dulu** di tiap bar (pesimis, sama seperti `simulate_result`) —
    bar yang menyentuh keduanya dihitung rugi, bukan untung.
    """
    horizon = cfg.ta["timeout_periods"]
    zone_high = (pick.get("entry_zone") or {}).get("high")
    levels = {
        "stop": (pick.get("stop") or {}).get("level"),
        "tp1": (pick.get("tp1") or {}).get("level"),
        "tp2": (pick.get("tp2") or {}).get("level"),
    }
    rows = conn.execute(STATUS_BARS_SQL, (ticker, as_of, horizon + 2)).fetchall()
    close_latest = float(rows[-1]["close"]) if rows else None
    base = next((float(row["close"]) for row in rows if row["date"] == as_of), close_latest)
    after = [row for row in rows if row["date"] > as_of]
    bars_since = len(after)
    entry = pick.get("entry") or base

    status = None
    touched = False
    for row in after:
        low, high = float(row["low"]), float(row["high"])
        if levels["stop"] and low <= levels["stop"]:
            status = "kena_stop"
            break
        if levels["tp2"] and high >= levels["tp2"]:
            status = "kena_tp2"
            break
        if levels["tp1"] and high >= levels["tp1"]:
            status = "kena_tp1"
            break
        if zone_high and low <= zone_high:
            touched = True
    if status is None:
        status = "kedaluwarsa" if bars_since > horizon else ("di_zona" if touched else "menunggu_zona")

    return {
        "status": status,
        "close_latest": close_latest,
        "ret_sejak_asof": round(close_latest / base - 1, 4) if close_latest and base else None,
        "bars_sejak_asof": bars_since,
        "mfe_pct": round(max(float(row["high"]) for row in after) / entry - 1, 4) if bars_since and entry else None,
        "mae_pct": round(min(float(row["low"]) for row in after) / entry - 1, 4) if bars_since and entry else None,
        "status_note": _status_note(status, levels, max(bars_since, 1), cfg),
    }


def load_picks(conn, cfg, *, as_of=None, limit=None, min_turnover=None) -> dict | None:
    """Baca `plan_pick` (bukan hitung ulang) — `None` bila `as_of` tidak punya isi (endpoint → 404)."""
    plan = cfg.weekly["plan"]
    batas = max(1, min(int(limit or plan["picks_limit"]), int(plan["picks_max_limit"])))
    dates = available_dates(conn, cfg, limit=plan["picks_available_dates"])
    as_of = as_of or (dates[0] if dates else None)
    if not as_of or not conn.execute("SELECT 1 FROM plan_pick WHERE as_of_date = ? LIMIT 1", (as_of,)).fetchone():
        return None
    ambang = float(plan["min_turnover_idr"] if min_turnover is None else min_turnover)
    picks: list[dict] = []
    for row in conn.execute("SELECT rank, payload_json FROM plan_pick WHERE as_of_date = ? ORDER BY rank", (as_of,)):
        pick = json.loads(row["payload_json"])
        # Tersimpan memakai ambang default config; permintaan yang lebih ketat disaring di sini (lebih longgar
        # tidak bisa menghidupkan kembali kandidat yang sudah tidak disimpan — lihat ADR-058).
        if min_turnover is not None and (pick.get("turnover_idr") or 0) < ambang:
            continue
        pick.update(pick_status(conn, pick["ticker"], as_of, pick, cfg))
        picks.append(pick)
    return {
        "as_of": as_of,
        "available_dates": dates,
        "limit": batas,
        "min_turnover_idr": ambang,
        "screened": len(picks),
        "ihsg_support": ihsg_support(conn, cfg),
        "rules": list(PICKS_RULES),
        "picks": picks[:batas],
    }
