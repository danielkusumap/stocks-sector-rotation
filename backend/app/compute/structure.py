"""Lapisan konteks SMC & Elliott (docs/03 §11.4–§11.5) — **bukan** aturan plan.

Fungsi murni tanpa DB: dipakai `/series/stock` hanya saat user memintanya (`layers=…,smc,elliott`).
Level plan tetap dari `plan_levels` (§6.4) — lapisan ini tidak boleh mengubah entry/stop/target
(skill `idx-ta-trading-plan`: maksimum satu alat utama + satu konfirmasi).
Pivot memakai `plan.pivots` (satu implementasi swing, bukan dua).
"""

from __future__ import annotations

from .plan import pivots


def swing_points(bars, span: int) -> list[dict]:
    """Pivot swing bergantian (docs/03 §11.4) — `span` bar kiri & kanan, urut waktu."""
    up_idx, low_idx = pivots(bars, span)
    points = [
        {"index": index, "date": str(bars["date"].iloc[index]), "price": float(bars["high"].iloc[index]), "kind": "high"}
        for index in up_idx
    ] + [
        {"index": index, "date": str(bars["date"].iloc[index]), "price": float(bars["low"].iloc[index]), "kind": "low"}
        for index in low_idx
    ]
    return sorted(points, key=lambda point: point["index"])


def _structure_events(bars, span: int) -> tuple[list[dict], list[dict]]:
    """BOS/CHoCH: **`close` menembus swing terakhir** (docs/03 §11.4) — `high` saja tidak cukup."""
    closes = bars["close"].astype(float).tolist()
    dates = [str(value) for value in bars["date"]]
    confirmed = sorted(
        [(point["index"] + span, point["kind"], point["price"]) for point in swing_points(bars, span)]
    )
    bos: list[dict] = []
    choch: list[dict] = []
    swing_high = swing_low = None
    pending = list(confirmed)
    for index in range(len(bars)):
        while pending and pending[0][0] <= index:  # pivot baru terkonfirmasi di bar ini
            _, kind, level = pending.pop(0)
            swing_high, swing_low = (level, swing_low) if kind == "high" else (swing_high, level)
        if swing_high is not None and closes[index] > swing_high:
            bos.append({"date": dates[index], "direction": "up", "level": round(swing_high, 2)})
            swing_high = None  # struktur pecah → tunggu swing berikutnya
        elif swing_low is not None and closes[index] < swing_low:
            choch.append({"date": dates[index], "direction": "down", "level": round(swing_low, 2)})
            swing_low = None
    return bos, choch


def _order_blocks(bars, events: list[dict], span: int, *, bullish: bool) -> list[dict]:
    """Order block: candle berlawanan terakhir sebelum impuls pemecah struktur (docs/03 §11.4)."""
    opens = bars["open"].astype(float).tolist()
    closes = bars["close"].astype(float).tolist()
    highs = bars["high"].astype(float).tolist()
    lows = bars["low"].astype(float).tolist()
    dates = [str(value) for value in bars["date"]]
    index_of = {date: index for index, date in enumerate(dates)}
    out: list[dict] = []
    for event in events:
        index = index_of[event["date"]]
        source = None
        for candidate in range(index - 1, max(index - span, 0) - 1, -1):
            if (closes[candidate] < opens[candidate]) if bullish else (closes[candidate] > opens[candidate]):
                source = candidate
                break
        if source is None:
            continue
        low, high = round(lows[source], 2), round(highs[source], 2)
        after = lows[index + 1 :] if bullish else highs[index + 1 :]
        out.append(
            {
                "kind": "bullish" if bullish else "bearish",
                "from": dates[source],
                "to": dates[source],
                "low": low,
                "high": high,
                "mitigated": any((value <= high) if bullish else (value >= low) for value in after),
            }
        )
    return out


def _fair_value_gaps(bars) -> list[dict]:
    """FVG: celah 3 bar — bullish bila `low(t) > high(t−2)`, bearish bila `high(t) < low(t−2)` (§11.4)."""
    highs = bars["high"].astype(float).tolist()
    lows = bars["low"].astype(float).tolist()
    dates = [str(value) for value in bars["date"]]
    out: list[dict] = []
    for index in range(2, len(bars)):
        if lows[index] > highs[index - 2]:
            out.append(
                {
                    "kind": "bullish",
                    "date": dates[index],
                    "low": round(highs[index - 2], 2),
                    "high": round(lows[index], 2),
                    "mitigated": any(value <= lows[index] for value in lows[index + 1 :]),
                }
            )
        elif highs[index] < lows[index - 2]:
            out.append(
                {
                    "kind": "bearish",
                    "date": dates[index],
                    "low": round(highs[index], 2),
                    "high": round(lows[index - 2], 2),
                    "mitigated": any(value >= highs[index] for value in highs[index + 1 :]),
                }
            )
    return out


def _equal_levels(bars, span: int, tolerance_pct: float) -> list[dict]:
    """Equal high/low: ≥2 pivot sejenis dalam toleransi → magnet likuiditas (docs/03 §11.4)."""
    close = float(bars["close"].iloc[-1])
    out: list[dict] = []
    for kind, column in (("high", "high"), ("low", "low")):
        levels = [point["price"] for point in swing_points(bars, span) if point["kind"] == kind]
        groups: list[list[float]] = []
        for level in sorted(levels):
            if groups and abs(level - groups[-1][-1]) <= tolerance_pct * close:
                groups[-1].append(level)
            else:
                groups.append([level])
        for group in groups:
            if len(group) >= 2:
                out.append({"kind": kind, "level": round(sum(group) / len(group), 2), "count": len(group)})
    return out


def smc_layers(bars, cfg) -> dict:
    """Struktur & zona SMC (docs/03 §11.4) — level dari `high`/`low` penyesuaian."""
    span = cfg.weekly["plan"]["pivot_bars"]
    points = swing_points(bars, span)
    bos, choch = _structure_events(bars, span)
    highs = [point["price"] for point in points if point["kind"] == "high"]
    lows = [point["price"] for point in points if point["kind"] == "low"]
    swing_high, swing_low = (highs[-1] if highs else None), (lows[-1] if lows else None)
    mid = round((swing_high + swing_low) / 2, 2) if swing_high and swing_low else None
    return {
        "bos": bos,
        "choch": choch,
        "order_blocks": _order_blocks(bars, bos, span, bullish=True) + _order_blocks(bars, choch, span, bullish=False),
        "fvg": _fair_value_gaps(bars),
        # docs/03 §11.4 menyebut `plan.channel_tol_pct`, docs/07 B22 AC 4 menyebut `chart.smc.eq_tol_pct`;
        # kunci khusus SMC yang dipakai (lihat ADR-053).
        "equal_levels": _equal_levels(bars, span, cfg.chart["smc"]["eq_tol_pct"]),
        "range": {"low": swing_low, "high": swing_high, "premium_from": mid, "discount_to": mid},
    }


def elliott_layers(bars, cfg) -> dict:
    """Kandidat Elliott (docs/03 §11.5) — tidak reproducible, wajib ditandai "kandidat, bisa berubah"."""
    span = cfg.weekly["plan"]["pivot_bars"]
    min_move = cfg.chart["elliott"]["min_move"]
    zigzag: list[dict] = []
    for point in swing_points(bars, span):
        if zigzag and point["kind"] == zigzag[-1]["kind"]:
            extreme = point["price"] > zigzag[-1]["price"] if point["kind"] == "high" else point["price"] < zigzag[-1]["price"]
            if extreme:
                zigzag[-1] = point
            continue
        if zigzag and abs(point["price"] - zigzag[-1]["price"]) / zigzag[-1]["price"] < min_move:
            continue  # gerakan < `chart.elliott.min_move` bukan gelombang baru
        zigzag.append(point)

    waves: list[dict] = []
    invalidated = False
    if len(zigzag) >= 6:
        leg = zigzag[-6:]
        prices = [point["price"] for point in leg]
        waves = [
            {
                "label": str(index + 1),
                "from": leg[index]["date"],
                "to": leg[index + 1]["date"],
                "price_from": round(leg[index]["price"], 2),
                "price_to": round(leg[index + 1]["price"], 2),
            }
            for index in range(5)
        ]
        first, third, fifth = abs(prices[1] - prices[0]), abs(prices[3] - prices[2]), abs(prices[5] - prices[4])
        invalidated = prices[2] <= prices[0] or prices[4] <= prices[1] or third < min(first, fifth)

    zones: list[dict] = []
    if len(zigzag) >= 2:
        start, end = zigzag[-2]["price"], zigzag[-1]["price"]
        zones = [{"ratio": ratio, "level": round(end - (end - start) * ratio, 2)} for ratio in (0.382, 0.5, 0.618)]
    return {
        "status": "invalidated" if invalidated else "candidate",
        "invalidated": invalidated,
        "zigzag": [{"date": point["date"], "price": round(point["price"], 2), "kind": point["kind"]} for point in zigzag],
        "waves": waves,
        "fib_zones": zones,
        "note": "kandidat, bisa berubah saat bar baru masuk",
    }
