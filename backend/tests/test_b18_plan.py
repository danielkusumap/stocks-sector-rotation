"""B18 — trading plan TA di `signal_weekly` (docs/03 §6.4 + §10.9): rezim, level, alasan, hit rate."""

from __future__ import annotations

import json

import pandas as pd
import pytest
import yaml
from fastapi.testclient import TestClient

from backend.app import db
from backend.app.compute import plan, signals, ta as ta_compute
from backend.app.config import DEFAULT_CONFIG, get_settings
from backend.tests.test_b7_signals import DATES, _seed, _wiggle, signal_inputs, weekly_db  # noqa: F401 (fixture)

RAW_TERMS = ("SMA20", "SMA50", "ATR", "R:R", "RSI", "breakout", "Donchian", "MFE", "MAE", "stop loss")


def make_bars(closes, *, lows=None, highs=None, volumes=None) -> pd.DataFrame:
    """Bar uji (kolom yang dibaca `plan.py`: date, close, high, low, volume)."""
    count = len(closes)
    return pd.DataFrame(
        {
            "date": pd.bdate_range("2026-01-05", periods=count).strftime("%Y-%m-%d"),
            "close": [float(c) for c in closes],
            "high": [float(h) for h in (highs if highs is not None else closes)],
            "low": [float(l) for l in (lows if lows is not None else closes)],
            "volume": [float(v) for v in (volumes if volumes is not None else [2_000_000] * count)],
        }
    )


def metrics(close: float, *, sma20: float, sma50: float, rsi: float = 60.0, atr: float = 2.0, turnover: int = 5_000_000_000) -> dict:
    return {"sma20": sma20, "sma50": sma50, "rsi14": rsi, "atr14": atr, "median_turnover_20d_idr": turnover}


@pytest.fixture
def cfg(tmp_config):
    """Config asli (blok `weekly.plan` ikut) — level plan dihitung murni, tanpa DB."""
    return get_settings()


def _flat_then_rise(step: float = 1.0, flat: int = 45) -> list[float]:
    """Harga mendatar lalu naik → bar terakhir = puncak 20 hari (kandidat breakout)."""
    return [100.0] * flat + [100.0 + step * i for i in range(1, 16)]


def _dip_bars(dip_low: float, dip_at: int = 20) -> pd.DataFrame:
    """Harga mendatar dengan dua pivot low di `dip_low` (10 bar terpisah) → kanal strength 2."""
    count = 60
    closes = [100.0] * count
    lows = [99.5] * count
    for index in (dip_at, dip_at + 10):
        closes[index] = dip_low + 0.5
        lows[index] = dip_low
    return make_bars(closes, lows=lows, highs=[c + 0.5 for c in closes])


# --- §6.4.2 mode entry --------------------------------------------------------


def test_plan_breakout_butuh_volume(cfg):
    closes = _flat_then_rise()
    stats = {"n_events": 0}
    thin = plan.plan_levels(make_bars(closes), metrics(closes[-1], sma20=112.0, sma50=105.0), "tren_naik", stats, cfg)
    loud = plan.plan_levels(
        make_bars(closes, volumes=[2_000_000] * 59 + [6_000_000]), metrics(closes[-1], sma20=112.0, sma50=105.0), "tren_naik", stats, cfg
    )
    assert thin["entry_mode"] != "breakout" and thin["entry_tool"] == "pullback_ma20"
    assert loud["entry_mode"] == "breakout" and loud["entry_tool"] == "breakout_donchian"
    assert "volume" in loud["entry_zone"]["reason"].lower() or "volume" in loud["entry_zone"]["reason"]


def test_plan_wait_pullback_saat_jauh(cfg):
    closes = _flat_then_rise()
    built = plan.plan_levels(make_bars(closes), metrics(closes[-1], sma20=closes[-1] - 5.0, sma50=105.0), "tren_naik", {}, cfg)
    assert built["entry_mode"] == "wait_pullback"  # 2,5 × ATR di atas penyangga → jangan chase


# --- §6.4.3 stop --------------------------------------------------------------


def _stop_case(cfg, dip_low: float) -> dict:
    bars = _dip_bars(dip_low, dip_at=40)
    return plan.plan_levels(bars, metrics(100.0, sma20=100.0, sma50=98.0), "tren_naik", {}, cfg)


def test_stop_pilih_yang_struktur(cfg):
    assert _stop_case(cfg, 98.4)["stop"]["basis"] == "struktur_swing_low"
    assert _stop_case(cfg, 94.0)["stop"]["basis"] == "volatilitas_atr"


def test_stop_lantai_atr(cfg):
    built = _stop_case(cfg, 99.2)
    entry_mid = (built["entry_zone"]["low"] + built["entry_zone"]["high"]) / 2
    assert built["stop"]["basis"] == "lantai_atr"
    assert built["stop"]["level"] == pytest.approx(entry_mid - 1.0 * 2.0)  # lantai = 1 × ATR


# --- §6.4.4 target & biaya ----------------------------------------------------


def test_rr_netto_biaya(cfg, tmp_path, monkeypatch):
    closes = _flat_then_rise()
    bars = make_bars(closes)
    m = metrics(closes[-1], sma20=112.0, sma50=105.0)
    base = plan.plan_levels(bars, m, "tren_naik", {}, cfg)

    config = yaml.safe_load(DEFAULT_CONFIG.read_text(encoding="utf-8"))
    config["database"]["path"] = str(tmp_path / "x.db")
    config["weekly"]["plan"]["fee_buy_bps"] = 150
    config["weekly"]["plan"]["fee_sell_bps"] = 150
    path = tmp_path / "mahal.yaml"
    path.write_text(yaml.safe_dump(config), encoding="utf-8")
    monkeypatch.setenv("ROTATION_CONFIG", str(path))
    get_settings.cache_clear()
    try:
        costly = plan.plan_levels(bars, m, "tren_naik", {}, get_settings())
    finally:
        get_settings.cache_clear()

    assert costly["tp2"]["level"] > base["tp2"]["level"]  # biaya naik → target minimal ikut naik
    assert costly["tp1"]["rr"] < base["tp1"]["rr"]  # level TP1 dari pasar tidak berubah, biaya memotong imbal hasil
    # menaikkan biaya bisa menutup plan; kalau ya, catatannya menyebut angkanya
    if not costly["plan_ok"]:
        assert any("risiko" in note for note in costly["notes"])


def test_tp1_fallback(cfg):
    flat = make_bars([100.0] * 60)
    built = plan.plan_levels(flat, metrics(100.0, sma20=100.0, sma50=100.0), "tren_naik", {}, cfg)
    entry_mid = (built["entry_zone"]["low"] + built["entry_zone"]["high"]) / 2
    assert built["tp1"]["basis"] == "fallback_volatilitas"
    assert built["tp1"]["level"] == pytest.approx(entry_mid + 1.5 * 2.0)  # 1,5 × ATR


# --- §6.4.5 hit rate & §10.9 MFE ---------------------------------------------


def test_hit_rate_dari_mfe(cfg):
    closes = [100.0] * 45 + [103.0] + [100.0] * 14  # resistance 20 hari = 103 → TP1 ≈ +3%
    bars = make_bars(closes)
    built = plan.plan_levels(bars, metrics(100.0, sma20=100.0, sma50=95.0), "tren_naik", {"n_events": 10, "mfe_pct": [0.06] * 10}, cfg)
    assert built["tp1"]["pct"] < 0.06 < built["tp2"]["pct"]
    assert built["hold"]["hit_tp1"] == 1.0 and built["hold"]["hit_tp2"] == 0.0
    # MFE 8% → TP1 kena (1,0) dan TP2 (+7,6% di fixture ini) juga kena
    high = plan.plan_levels(bars, metrics(100.0, sma20=100.0, sma50=95.0), "tren_naik", {"n_events": 10, "mfe_pct": [0.08] * 10}, cfg)
    assert high["hold"]["hit_tp1"] == 1.0 and high["hold"]["hit_tp2"] == 1.0
    # event < min_events_hold → null, bukan 0
    few = plan.plan_levels(bars, metrics(100.0, sma20=100.0, sma50=95.0), "tren_naik", {"n_events": 2, "mfe_pct": [0.08, 0.08]}, cfg)
    assert few["hold"]["hit_tp1"] is None and few["hold"]["hit_tp2"] is None


def test_mfe_mae_dari_seri_naik_turun():
    """Naik 8% lalu turun 3% → `mfe_pct` ≈ +0,08, `mae_pct` ≈ −0,03 (docs/03 §10.9)."""
    close = [100.0] * 9 + [105.0, 100.0, 108.0, 97.0]
    bars = [(f"2026-01-{i + 1:02d}", c, 100.0 if i >= 10 else c) for i, c in enumerate(close)]
    rows = ta_compute.reference_rows(
        bars, scope="stock", ma_period=3, use_open=True, target_pct=0.20, timeout_periods=2,
        trend_filter_period=5, variants=[0], trend_filter_on=True,
    )
    # (ma_period, variant, signal_date, entry_date, entry_price, basis, result, exit_date, exit_price, periods, mfe, mae)
    assert rows[0][6] == "expired" and rows[0][9] == 2
    assert rows[0][10] == pytest.approx(0.08, abs=1e-6) and rows[0][11] == pytest.approx(-0.03, abs=1e-6)


# --- §6.4.0 gerbang rezim -----------------------------------------------------


def test_regime_gate(cfg):
    bars = _dip_bars(97.0)
    closes = bars["close"]
    m = metrics(100.0, sma20=100.0, sma50=101.0, rsi=30.0)  # selisih 1% → menyamping; momentum di tepi bawah
    assert plan.regime_of(bars, m, sector_quadrant="leading", cfg=cfg) == "range"
    assert plan.plan_levels(bars, m, "range", {}, cfg)["entry_tool"] == "sr_channel"
    # harga menembus puncak 20 bar tetap bukan breakout di rezim ini
    strong = bars.copy()
    strong.loc[strong.index[-1], "close"] = float(closes.max()) + 5
    assert plan.plan_levels(strong, m, "range", {}, cfg)["entry_tool"] == "sr_channel"


def test_regime_tipis_menang(cfg):
    closes = _flat_then_rise()
    volumes = [2_000_000] * 55 + [0] * 5  # 5 dari 20 bar terakhir = 25% ≥ 20%
    bars = make_bars(closes, volumes=volumes)
    m = metrics(closes[-1], sma20=112.0, sma50=105.0)
    assert plan.regime_of(bars, m, sector_quadrant="leading", cfg=cfg) == "tipis"
    built = plan.plan_levels(bars, m, "tipis", {}, cfg)
    assert built["confirm_tool"] == "none" and built["entry_tool"] in ("pivot_level", "none")


def test_regime_turun_no_trade(cfg):
    closes = [200.0 - i for i in range(60)]
    bars = make_bars(closes)
    m = metrics(closes[-1], sma20=160.0, sma50=170.0)
    assert plan.regime_of(bars, m, sector_quadrant="lagging", cfg=cfg) == "turun"
    built = plan.plan_levels(bars, m, "turun", {"n_events": 9}, cfg)
    assert built["entry_mode"] == "no_trade" and built["plan_ok"] is False
    assert all(built[key]["level"] is None for key in ("stop", "tp1", "tp2")) and built["notes"]


def test_konflik_seri_no_trade(cfg):
    bars = _dip_bars(97.0)
    built = plan.plan_levels(bars, metrics(100.0, sma20=100.0, sma50=101.0, rsi=55.0), "range", {}, cfg)
    assert built["entry_mode"] == "no_trade" and built["entry_tool"] == "none"
    assert any("seri" in note.lower() for note in built["notes"])


# --- §6.4.7 aturan mengikat ---------------------------------------------------


def test_konfirmasi_maks_satu(cfg):
    closes = _flat_then_rise()
    built = plan.plan_levels(make_bars(closes), metrics(closes[-1], sma20=112.0, sma50=105.0), "tren_naik", {}, cfg)
    plan.validate(built)
    built["confirm_tool"] = "volume,rsi_tepi_range"
    with pytest.raises(AssertionError):
        plan.validate(built)


def test_plan_alasan_pendek_dan_bahasa_indonesia(cfg):
    closes = _flat_then_rise()
    built = plan.plan_levels(make_bars(closes), metrics(closes[-1], sma20=112.0, sma50=105.0), "tren_naik", {"n_events": 9}, cfg)
    reasons = [
        built["entry_zone"]["reason"], built["stop"]["reason"], built["tp1"]["reason"], built["tp2"]["reason"],
        built["hold"]["reason"], built["entry_tool_reason"], built["confirm_reason"],
    ]
    for reason in reasons:
        assert reason and len(reason) <= 140
    for reason in reasons + [built["invalidation"]]:
        assert not any(term.lower() in (reason or "").lower() for term in RAW_TERMS)


def test_atr_null_plan_null(cfg):
    closes = _flat_then_rise()
    built = plan.plan_levels(make_bars(closes), metrics(closes[-1], sma20=112.0, sma50=105.0, atr=None), "tren_naik", {}, cfg)
    assert built["entry_mode"] == "no_trade" and built["plan_ok"] is False
    assert all(built[key]["level"] is None for key in ("stop", "tp1", "tp2")) and built["hold"]["hit_tp1"] is None


# --- §6.4.9 pivot & kanal -----------------------------------------------------


def test_pivot_butuh_bar_kiri_kanan(cfg):
    closes = [100.0] * 30 + [140.0]
    bars = make_bars(closes, highs=closes)
    up, down = plan.pivots(bars, 5)
    assert all(5 <= index <= len(bars) - 6 for index in up + down)
    assert len(bars) - 1 not in up and 0 not in down


def test_kanal_kelompokkan_pivot_berdekatan(cfg):
    grouped = plan.channels([100.0, 100.5], 100.0, 0.01)
    assert len(grouped) == 1 and grouped[0]["strength"] == 2
    assert plan.channels([100.0, 120.0], 100.0, 0.01) == [{"level": 100.0, "strength": 1}, {"level": 120.0, "strength": 1}]


def test_kanal_min_strength(cfg):
    bars = _dip_bars(97.0, dip_at=20).copy()
    bars.loc[30, "close"] = bars.loc[30, "close"]  # satu pivot low saja (dip_at+10 dihapus)
    single = make_bars([100.0] * 60, lows=[99.5] * 30 + [97.0] + [99.5] * 29, highs=[100.5] * 60)
    built = plan.plan_levels(single, metrics(100.0, sma20=100.0, sma50=101.0), "range", {}, cfg)
    assert built["entry_tool"] == "none" and built["plan_ok"] is False  # kanal 1 pivot tidak dipakai


# --- integrasi: `signal_weekly` + endpoint ------------------------------------


@pytest.fixture
def coherent_inputs(signal_inputs):
    """Fixture B7 + metrik harian yang **konsisten** dengan level harga nyata (rezim `tren_naik`).

    Fixture B7 memaksa `close=1500/sma20=1400` untuk menguji aturan §6.2, padahal harga sintetisnya
    ~2.900; plan membaca level harga, jadi metriknya diselaraskan dulu.
    """
    target = signal_inputs
    conn = db.connect(target)
    try:
        # Harga Jumat terakhir (bar yang dipakai pick mingguan) — metrik lama (1.500) tidak nyambung dengan level harga.
        close = conn.execute(
            "SELECT close FROM price_daily WHERE ticker = 'AAAA'"
            " AND date = (SELECT MAX(date) FROM price_daily WHERE ticker = 'AAAA' AND strftime('%w', date) = '5')"
        ).fetchone()[0]
        conn.execute(
            "UPDATE stock_metrics SET sma20 = ?, sma50 = ?, atr14 = ?, rsi14 = 60, median_turnover_20d_idr = 5000000000"
            " WHERE ticker = 'AAAA' AND timeframe = 'd1'",
            (close * 0.97, close * 0.94, close * 0.02),
        )
        conn.commit()
    finally:
        conn.close()
    return target


def test_plan_tersimpan_dan_idempoten(coherent_inputs):
    target = coherent_inputs
    first = signals.compute_signals(db_path=target)
    conn = db.connect(target)
    try:
        rows = [dict(r) for r in conn.execute("SELECT * FROM signal_weekly WHERE scope = 'stock'")]
        assert rows and first["stock_rows"] >= 1
        latest = max(row["week_end"] for row in rows)
        current = [row for row in rows if row["week_end"] == latest]
        assert current[0]["plan_json"] and current[0]["regime"] == "tren_naik"  # minggu terakhir punya plan penuh
        for row in rows:
            if not row["plan_json"]:  # minggu lama: riwayat harga belum cukup → kolom plan NULL
                assert row["regime"] is None and row["plan_ok"] is None
                continue
            assert row["regime"] in ("tren_naik", "range", "turun", "tipis")
            assert row["confirm_tool"] in ("volume", "rsi_tepi_range", "none")
            built = json.loads(row["plan_json"])
            assert built["regime"] == row["regime"] and built["plan_ok"] == bool(row["plan_ok"])
            assert row["stop"] == pytest.approx(built["stop"]["level"])
            if row["tp2"] is not None:
                assert row["target"] == pytest.approx(row["tp2"])  # `target` = `tp2` (docs/05 §3)
                assert row["entry_ref"] is not None
        before = {r["ref_id"]: (r["plan_json"], r["tp2"], r["rr_tp2"], r["hit_tp1"]) for r in rows}
    finally:
        conn.close()

    signals.compute_signals(db_path=target)  # recompute → nilai plan sama (kecuali computed_at)
    conn = db.connect(target)
    try:
        after = {
            r["ref_id"]: (r["plan_json"], r["tp2"], r["rr_tp2"], r["hit_tp1"])
            for r in conn.execute("SELECT * FROM signal_weekly WHERE scope = 'stock'")
        }
    finally:
        conn.close()
    assert after == before


def test_weekly_picks_kirim_plan(coherent_inputs, monkeypatch):
    target = coherent_inputs
    signals.compute_signals(db_path=target)
    monkeypatch.setattr(db, "db_path", lambda: target)
    from backend.app.main import app

    client = TestClient(app)
    body = client.get("/api/v1/weekly/picks").json()
    assert body["api_version"] == "1.2"
    pick = body["stocks"][0]
    assert set(pick["plan"]) == {
        "regime", "entry_tool", "entry_tool_reason", "confirm_tool", "confirm_reason", "entry_mode", "entry_zone",
        "stop", "tp1", "tp2", "hold", "invalidation", "plan_ok", "notes",
    }
    assert pick["plan"]["confirm_reason"] is None or len(pick["plan"]["confirm_reason"]) <= 140
    assert set(pick["plan"]["stop"]) == {"level", "pct", "basis", "reason"}
    assert pick["target"] == pytest.approx(pick["plan"]["tp2"]["level"])

    conn = db.connect(target)
    try:  # baris lama (sebelum migrasi 005) → `plan: null`, endpoint tetap 200
        conn.execute("UPDATE signal_weekly SET plan_json = NULL WHERE scope = 'stock'")
        conn.commit()
    finally:
        conn.close()
    legacy = client.get("/api/v1/weekly/picks").json()
    assert legacy["stocks"][0]["plan"] is None and legacy["api_version"] == "1.2"


# --- B18b: basis bar plan = bar `date <= week_end`, bukan snapshot `stock_metrics` terakhir --------


def _upto(day: str) -> int:
    return DATES.index(day) + 1


def _add_bar(conn, ticker: str, date: str, close: float, volume: int = 2_000_000) -> None:
    conn.execute(
        "INSERT INTO price_daily (ticker, date, open, high, low, close, adj_close, volume, value_idr, source, ingested_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'test', '2026-10-14')",
        (ticker, date, close, close * 1.01, close * 0.99, close, close, volume, int(close * volume)),
    )


def test_plan_pakai_bar_sampai_week_end(tmp_db):
    """`atr14`/`sma20`/`rsi14` plan = hitungan dari bar ≤ pekan, bukan snapshot metrik setelahnya."""
    closes = _wiggle(0.0035, ramp=0.00002)
    conn = db.connect(tmp_db)
    try:
        _seed(conn, "AAAA", closes[: _upto("2026-10-09")])
        conn.commit()
    finally:
        conn.close()

    cfg = get_settings()
    conn = db.connect(tmp_db)
    try:
        bars = plan.load_bars(conn, "AAAA", "2026-10-09")
        indicators_week = plan.indicators_from_bars(bars, cfg)
    finally:
        conn.close()
    assert bars["date"].max() == "2026-10-09"  # bar setelah Jumat tidak ikut
    assert indicators_week["sma20"] == pytest.approx(float(bars["close"].rolling(20).mean().iloc[-1]), abs=1e-6)

    conn = db.connect(tmp_db)
    try:
        _add_bar(conn, "AAAA", "2026-10-12", 5000.0)
        _add_bar(conn, "AAAA", "2026-10-13", 5000.0)
        conn.commit()
        indicators_future = plan.indicators_from_bars(plan.load_bars(conn, "AAAA", "2026-10-13"), cfg)
    finally:
        conn.close()
    # dua angka berbeda → kalau kode membaca snapshot terakhir, plan pekan 9 Okt akan memakai yang ini
    assert abs(indicators_future["sma20"] - indicators_week["sma20"]) > 1.0
    assert abs(indicators_future["atr14"] - indicators_week["atr14"]) > 1.0


def test_plan_tidak_baca_metrik_masa_depan(tmp_db):
    """Plan pekan 9 Okt identik walau bar 12–13 Okt ditambahkan (docs/07 B18b AC 2)."""
    cfg = get_settings()
    conn = db.connect(tmp_db)
    try:
        _seed(conn, "AAAA", _wiggle(0.0035, ramp=0.00002)[: _upto("2026-10-09")])
        sid = conn.execute("SELECT id FROM sector WHERE code = 'IDXFINANCE'").fetchone()[0]
        # kuadran sektor `leading` → regime plan `tren_naik` (kalau tidak, rezim jatuh ke `range` → no_trade)
        conn.execute(
            "INSERT INTO rrg_daily (as_of_date, scope, ref_id, timeframe, weighting, rs_ratio, rs_momentum,"
            " quadrant, quadrant_age_periods, bench_ref, computed_at)"
            " VALUES ('2026-10-09', 'sector', 'IDXFINANCE', 'w1_fri', 'equal', 105.0, 101.0, 'leading', 3, 'IHSG', '2026-10-09')"
        )
        conn.commit()
    finally:
        conn.close()

    pick = {"row": {"ticker": "AAAA", "sector_id": sid}}
    conn = db.connect(tmp_db)
    try:
        before = plan.build_plans(conn, "2026-10-09", [pick], cfg)["AAAA"]
    finally:
        conn.close()
    assert before is not None and before["stop"]["level"] is not None

    conn = db.connect(tmp_db)
    try:
        _add_bar(conn, "AAAA", "2026-10-12", 3000.0)
        _add_bar(conn, "AAAA", "2026-10-13", 3000.0)
        conn.commit()
        after = plan.build_plans(conn, "2026-10-09", [pick], cfg)["AAAA"]
    finally:
        conn.close()
    assert after == before


def test_indicators_sama_dengan_stock_metrics(weekly_db):
    """`week_end` = `as_of` terakhir → indikator dari bar = `stock_metrics` (toleransi 1e-6)."""
    conn = db.connect(weekly_db)
    try:
        row = dict(
            conn.execute(
                "SELECT as_of_date, sma20, sma50, rsi14, atr14 FROM stock_metrics"
                " WHERE ticker = 'AAAA' AND timeframe = 'd1'"
            ).fetchone()
        )
        got = plan.indicators_from_bars(plan.load_bars(conn, "AAAA", row["as_of_date"]), get_settings())
    finally:
        conn.close()
    for key in ("sma20", "sma50", "rsi14", "atr14"):
        assert got[key] == pytest.approx(row[key], abs=1e-6), key


def test_plan_pekan_lama_tetap_ada_level(tmp_db):
    """Pekan lama tetap punya level walau `stock_metrics` tidak punya baris tanggal itu (docs/07 B18b AC 4)."""
    cfg = get_settings()
    last = _upto("2026-06-19")
    conn = db.connect(tmp_db)
    try:
        _seed(conn, "AAAA", _wiggle(0.0035, ramp=0.00002)[:last])
        sid = conn.execute("SELECT id FROM sector WHERE code = 'IDXFINANCE'").fetchone()[0]
        # 5 dari 20 bar terakhir tanpa volume → rezim `tipis`: tetap punya level, tak butuh kuadran sektor
        conn.execute("UPDATE price_daily SET volume = 0 WHERE ticker = 'AAAA' AND date >= ?", (DATES[last - 5],))
        stale = conn.execute("SELECT COUNT(*) FROM stock_metrics WHERE ticker = 'AAAA'").fetchone()[0]
        conn.commit()
        built = plan.build_plans(conn, "2026-06-19", [{"row": {"ticker": "AAAA", "sector_id": sid}}], cfg)["AAAA"]
    finally:
        conn.close()
    assert stale == 0  # memang tak ada snapshot metrik sama sekali di DB ini
    assert built is not None and built["regime"] == "tipis"
    assert built["stop"]["level"] is not None and built["tp1"]["level"] is not None
