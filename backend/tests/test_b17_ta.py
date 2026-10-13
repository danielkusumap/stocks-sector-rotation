"""B17 — analisa teknikal & backtest MA (docs/03 §10): rumus, tabel `ta_breakout`, endpoint `/ta/*`, stage `ta`."""

from __future__ import annotations

import time

import numpy as np
import pytest
import yaml
from fastapi.testclient import TestClient

from backend.app import cache, db, jobs
from backend.app.api import ta as ta_api
from backend.app.compute import ta as ta_compute
from backend.app.config import DEFAULT_CONFIG, get_settings

STAMP = "2026-10-13T00:00:00+07:00"


def _bars(prices: list[float], *, opens: list[float] | None = None) -> list[tuple[str, float, float | None]]:
    """Seri bar uji: `dates` = hari kerja berturut, `close` = `prices`, `open` = D+1 (default = close)."""
    from datetime import date, timedelta

    day, out = date(2026, 1, 5), []
    for i, price in enumerate(prices):
        while day.weekday() >= 5:
            day += timedelta(days=1)
        stamp = day.isoformat()
        day += timedelta(days=1)
        out.append((stamp, price, None if opens is None else opens[i]))
    return out


def _rows(bars, **kwargs):
    """Baris event (ma_period, variant, signal_date, entry_date, entry_price, basis, result, exit_date, exit_price, periods)."""
    params = dict(scope="stock", ma_period=3, use_open=True, target_pct=0.05, timeout_periods=60,
                  trend_filter_period=5, variants=[1], trend_filter_on=True)
    params.update(kwargs)
    return ta_compute.reference_rows(bars, **params)


# --- rumus (docs/03 §10.1–§10.5, docs/07 B17 AC 1–6) ---------------------------


def test_ma_warmup():
    """`p=20` pada 25 bar → 19 bar NULL, mulai bar ke-20 terisi (docs/03 §10.1)."""
    values = [float(i) for i in range(1, 26)]
    ma = ta_compute.sma(values, 20)
    assert ma[:19] == [None] * 19
    assert ma[19] == pytest.approx(sum(values[:20]) / 20)
    assert ma[24] == pytest.approx(sum(values[5:25]) / 20)


def test_breakout_sekali_per_transisi():
    """Seri naik terus di atas MA → **1** event, bukan satu per bar (docs/03 §10.2)."""
    bars = _bars([100.0] * 10 + [100.0 + i for i in range(1, 11)])
    events = _rows(bars, ma_period=3)
    assert len(events) == 1
    assert events[0][2] == bars[10][0]  # transisi terjadi di bar pertama yang menembus MA


def test_entry_pakai_bar_d_plus_1():
    """Ubah harga D+1 → `entry_price` ikut berubah (bukti tidak memakai harga sinyal)."""
    prices = [100.0] * 10 + [100.0 + i for i in range(1, 11)]
    first = _rows(_bars(prices, opens=prices), use_open=True)
    moved = _rows(_bars(prices, opens=[p + 100 for p in prices]), use_open=True)
    assert first[0][4] != moved[0][4]
    assert moved[0][4] == first[0][4] + 100
    assert moved[0][3] == moved[0][3] and moved[0][5] == "open"  # entry_date & basis tidak berubah


def test_win_loss_same_bar():
    """Bar yang tepat menyentuh `−target` dicatat `loss`, walau bar berikutnya di atas `+target`.

    docs/03 §10.3 menyebut kasus tepi "satu bar menyentuh +target dan −target (gap) → loss".
    Dengan basis `close` (bukan high/low) satu bar tidak bisa melewati dua ambang sekaligus, jadi
    yang terbukti di sini adalah urutan cabang pesimis: `−target` dicek lebih dulu, dan bar entry
    (`periods` = 0) ikut dievaluasi.
    """
    close = [100.0] * 9 + [105.0, 94.0, 130.0]
    bars = _bars(close, opens=[100.0] * len(close))
    row = _rows(bars, ma_period=3)[0]
    assert row[2] == bars[9][0] and row[4] == 100.0  # sinyal di bar 9, eksekusi open bar 10
    assert row[6] == "loss" and row[9] == 0 and row[8] == 94.0


def test_expired_timeout():
    """Tidak kena target sampai `timeout_periods` → `expired`, `periods` = timeout."""
    close = [100.0] * 9 + [105.0] + [104.0] * 20
    bars = _bars(close, opens=[100.0] * len(close))  # entry 100 → +4%, di bawah target 5%
    rows = _rows(bars, ma_period=3, timeout_periods=10)
    row = rows[0]
    assert row[2] == bars[9][0] and row[3] == bars[10][0]
    assert row[6] == "expired" and row[9] == 10
    assert row[7] == bars[20][0] and row[8] == 104.0


def test_open_horizon_belum_selesai():
    """Horizon belum selesai (data habis) → `open`, `periods` NULL (docs/03 §10.3)."""
    close = [100.0] * 9 + [105.0, 104.0, 104.5, 103.0]
    bars = _bars(close, opens=[100.0] * len(close))
    rows = _rows(bars, ma_period=3, timeout_periods=60)
    assert len(rows) == 1
    row = rows[0]
    assert row[6] == "open" and row[9] is None and row[7] is None and row[8] is None


def test_median_bukan_mean():
    """Satu trade 60 periode tidak menggeser median seperti mean (docs/03 §10.4)."""
    rows = [
        {"result": "win", "periods": p} for p in (2, 3, 3, 60)
    ] + [{"result": "loss", "periods": p} for p in (1, 2, 2)] + [{"result": "expired", "periods": 60}]
    stats = ta_api._stats(rows)
    assert stats["n_events"] == 8 and stats["win"] == 4 and stats["loss"] == 3 and stats["expired"] == 1
    assert stats["median_periods_win"] == 3  # mean-nya 17,0
    assert stats["win_rate"] == round(4 / 7, 4)
    assert ta_api._stats([])["win_rate"] is None and ta_api._stats([])["median_periods_win"] is None


def test_trend_filter_mengurangi_event():
    """Varian filter tren `on` ≤ `off` (docs/03 §10.5), keduanya bisa dibaca berdampingan."""
    up = [100.0 + i * 1.2 for i in range(20)]
    down = [up[-1] - i * 0.9 for i in range(1, 21)]
    chop = [up[-1] - 18 + 6 * np.sin(np.arange(20) / 2.0)]
    values = up + down + list(chop[0])
    bars = _bars(values, opens=values)
    off = _rows(bars, ma_period=5, variants=[0], trend_filter_period=10)
    on = _rows(bars, ma_period=5, variants=[1], trend_filter_period=10)
    assert len(off) == 2 and len(on) == 1  # satu breakout tren-naik & satu breakout di bawah MA10


def test_sektor_pakai_nilai_indeks():
    """Sektor tidak punya `open` → entry = nilai indeks D+1, `entry_basis` = `index` (docs/03 §10.7)."""
    bars = _bars([100.0] * 9 + [105.0, 110.0, 120.0, 130.0], opens=None)
    rows = _rows(bars, scope="sector", ma_period=3)
    assert rows[0][5] == "index" and rows[0][4] == 110.0


# --- DB: hitung, simpan, idempoten, endpoint ----------------------------------


@pytest.fixture
def ta_db(tmp_path, monkeypatch):
    """DB + config salinan dengan ambang kecil (`ma_periods` 3/5, `min_history` 12) — data uji kecil saja."""
    monkeypatch.setenv("ROTATION_CONFIG", str(_config(tmp_path, {})))
    get_settings.cache_clear()
    path = tmp_path / "rotation.db"
    db.init_db(path)
    conn = db.connect(path)
    try:
        for ticker, sector, prices in (
            ("AAAA", "IDXFINANCE", _series([100.0] * 10 + [100.0 + i for i in range(1, 31)])),
            ("BBBB", "IDXFINANCE", _series([100.0 - i * 0.5 for i in range(40)])),
        ):
            sector_id = conn.execute("SELECT id FROM sector WHERE code = ?", (sector,)).fetchone()[0]
            conn.execute(
                "INSERT INTO stock (ticker, yahoo_symbol, sector_id, shares_outstanding, is_active, updated_at) VALUES (?,?,?,?,1,?)",
                (ticker, f"{ticker}.JK", sector_id, 1_000_000, STAMP),
            )
            for date, close, _open in _bars(prices, opens=prices):
                conn.execute(
                    "INSERT INTO price_daily (ticker,date,open,high,low,close,adj_close,volume,value_idr,source,ingested_at)"
                    " VALUES (?,?,?,?,?,?,?,1000,100000,'test',?)",
                    (ticker, date, close, close, close, close, close, STAMP),
                )
        # indeks sektor equal untuk IDXFINANCE supaya scope=sector teruji
        sector_id = conn.execute("SELECT id FROM sector WHERE code = 'IDXFINANCE'").fetchone()[0]
        for date, close, _open in _bars(_series([100.0 + i * 0.3 for i in range(40)]), opens=None):
            conn.execute(
                "INSERT INTO sector_index_daily (sector_id,date,weighting,index_close,constituents_count,partial,computed_at)"
                " VALUES (?,?,'equal',?,3,0,?)",
                (sector_id, date, close, STAMP),
            )
        conn.commit()
    finally:
        conn.close()
    yield path
    get_settings.cache_clear()


def _config(tmp_path, overrides: dict, db_name: str = "rotation.db"):
    cfg = yaml.safe_load(DEFAULT_CONFIG.read_text(encoding="utf-8"))
    cfg["database"]["path"] = str(tmp_path / db_name)
    cfg["ta"].update({"ma_periods": [3, 5], "ma_default": 3, "min_history": 12, "timeout_periods": 10, "trend_filter_period": 5})
    cfg["universe"]["min_prices_coverage"] = 0.0
    cfg.update(overrides)
    path = tmp_path / "config.yaml"
    path.write_text(yaml.safe_dump(cfg), encoding="utf-8")
    return path


def _series(prices: list[float]) -> list[float]:
    return prices


@pytest.fixture
def ta_client(ta_db, monkeypatch):
    monkeypatch.setattr(db, "db_path", lambda: ta_db)
    cache.clear()
    from backend.app.main import app

    return TestClient(app)


def test_ta_recompute_idempoten(ta_db, monkeypatch):
    """`stage=ta` 2× → jumlah baris `ta_breakout` sama (docs/03 §10.8 no.9)."""
    monkeypatch.setenv("ROTATION_CONFIG", str(_config(ta_db.parent, {})))
    get_settings.cache_clear()
    conn = db.connect(ta_db)
    try:
        first = ta_compute.compute_ta(db_path=ta_db)
        after_first = conn.execute("SELECT COUNT(*) FROM ta_breakout").fetchone()[0]
        second = ta_compute.compute_ta(db_path=ta_db)
        after_second = conn.execute("SELECT COUNT(*) FROM ta_breakout").fetchone()[0]
        assert first["events"] > 0
        assert after_first == after_second == first["events"]
        assert second["refs"] == first["refs"] and second["refs_skipped_short_history"] == first["refs_skipped_short_history"]
        # entry D+1 & varian tersimpan berdampingan
        assert {r[0] for r in conn.execute("SELECT DISTINCT trend_filter FROM ta_breakout")} == {0, 1}
        assert conn.execute("SELECT COUNT(*) FROM ta_breakout WHERE entry_basis = 'open'").fetchone()[0] > 0
    finally:
        conn.close()
        get_settings.cache_clear()


def test_entry_open_diskalakan_ke_adj_close(ta_db):
    """`open` mentah diskalakan ke kerangka `adj_close` — kalau tidak, entry seolah rugi −50% (ADR-039)."""
    conn = db.connect(ta_db)
    try:
        sector_id = conn.execute("SELECT id FROM sector WHERE code = 'IDXFINANCE'").fetchone()[0]
        conn.execute(
            "INSERT INTO stock (ticker, yahoo_symbol, sector_id, is_active, updated_at) VALUES ('KAOS','KAOS.JK',?,1,?)",
            (sector_id, STAMP),
        )
        conn.execute(
            "INSERT INTO price_daily (ticker,date,open,high,low,close,adj_close,volume,value_idr,source,ingested_at)"
            " VALUES ('KAOS','2026-01-05',200,200,200,100,50,1000,100000,'test',?)",
            (STAMP,),
        )
        conn.commit()
        assert ta_compute.load_bars(conn, "stock", "KAOS", "equal") == [("2026-01-05", 50.0, 100.0)]
    finally:
        conn.close()


def test_summary_dan_detail_kontrak(ta_client, ta_db):
    """`/ta/summary` & `/ta/{scope}/{ref_id}` persis kunci docs/05 §2 (AC 10)."""
    ta_compute.compute_ta(db_path=ta_db)
    body = ta_client.get("/api/v1/ta/summary?scope=stock&ma_period=3&trend_filter=false").json()
    assert set(body) == {"api_version", "scope", "timeframe", "ma_period", "trend_filter", "total", "limit", "offset", "items", "coverage", "data_status"}
    assert body["total"] == 2 and body["items"]  # entitas tanpa event tetap tampil
    item = next(i for i in body["items"] if i["ref_id"] == "AAAA")
    assert item["n_events"] > 0 and item["n_events"] == item["win"] + item["loss"] + item["expired"] + item["open"]
    assert item["median_periods_win"] is None or item["median_periods_win"] >= 1
    assert item["close"] == 130.0 and item["ma"] is not None
    assert item["last_breakout"] and item["last_breakout"]["entry_basis"] in ("open", "adj_close")
    assert item["last_breakout"]["gain_since"] == pytest.approx(item["close"] / item["last_breakout"]["entry_price"] - 1)
    assert body["coverage"] == {
        "refs_tested": 2, "refs_skipped_short_history": 0,
        "bars_from": "2026-01-05", "bars_to": "2026-02-27", "price_basis": "adj_close",
    }

    detail = ta_client.get("/api/v1/ta/stock/AAAA?ma_period=3").json()
    assert set(detail) == {"api_version", "scope", "ref_id", "name", "ma_period", "trend_filter", "price_basis",
                           "ma_series", "stats", "latest", "events", "coverage", "data_status"}
    assert detail["price_basis"] == "adj_close" and detail["stats"].keys() == {"filter_on", "filter_off"}
    assert detail["stats"]["filter_on"]["n_events"] <= detail["stats"]["filter_off"]["n_events"]
    assert detail["ma_series"] and detail["ma_series"][0]["ma"] is not None  # warmup dibuang
    assert detail["ma_series"] == sorted(detail["ma_series"], key=lambda p: p["date"])

    sector = ta_client.get("/api/v1/ta/sector/IDXFINANCE?ma_period=3").json()
    assert sector["ref_id"] == "IDXFINANCE" and sector["coverage"]["price_basis"] == "adj_close"

    kosong = ta_client.get("/api/v1/ta/stock/BBBB?ma_period=3").json()  # turun terus → tanpa event
    assert kosong["latest"] is None and kosong["events"] == [] and kosong["stats"]["filter_on"]["n_events"] == 0


def test_error_kontrak_ma_period_dan_prereq(ta_client, tmp_path, monkeypatch):
    """`ma_period` di luar config → 400; `price_daily` kosong → 409 `prereq_no_prices` (AC 11)."""
    bad = ta_client.get("/api/v1/ta/summary?ma_period=7")
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "invalid_ma_period"
    assert ta_client.get("/api/v1/ta/summary?scope=x").json()["error"]["code"] == "invalid_scope"

    monkeypatch.setenv("ROTATION_CONFIG", str(_config(tmp_path, {}, db_name="kosong.db")))
    get_settings.cache_clear()
    kosong_db = tmp_path / "kosong.db"
    db.init_db(kosong_db)
    monkeypatch.setattr(db, "db_path", lambda: kosong_db)
    conn = db.connect(kosong_db)
    conn.execute("INSERT INTO stock (ticker, yahoo_symbol, sector_id, is_active, updated_at) VALUES ('ZZZZ','ZZZZ.JK',1,1,?)", (STAMP,))
    conn.commit()
    conn.close()
    for path in ("/api/v1/ta/summary?scope=stock", "/api/v1/ta/stock/ZZZZ"):
        response = ta_client.get(path)
        assert response.status_code == 409 and response.json()["error"]["code"] == "prereq_no_prices"
    assert ta_client.get("/api/v1/ta/stock/QQQQ").status_code == 404
    get_settings.cache_clear()


def test_stage_ta_lewat_http(ta_client, ta_db):
    """`POST /admin/compute?async=true {"stage":"ta"}` → 202, `kind=compute_ta`, progres naik (AC 8–9)."""
    started = ta_client.post("/api/v1/admin/compute?async=true", json={"stage": "ta"})
    assert started.status_code == 202
    run_id = started.json()["run_id"]
    phases = []
    for _ in range(200):
        run = ta_client.get(f"/api/v1/admin/runs/{run_id}").json()["run"]
        phases.append((run["status"], run["phase"], run["rows"]))
        if run["status"] in ("ok", "partial", "failed", "skipped"):
            break
        time.sleep(0.05)
    assert run["kind"] == "compute_ta" and run["status"] == "ok"
    assert any(phase[1] == "compute_ta" for phase in phases)  # progres per grup entitas (docs/05 §4.3)
    for key in ("events", "refs", "ma_periods", "variants", "win_rate", "duration_s"):
        assert key in run["result_json"]
    assert run["result_json"]["variants"] == ["filter_off", "filter_on"] and run["result_json"]["events"] > 0

    conn = db.connect(ta_db)
    first = jobs.compute({"stage": "all", "timeframe": "d1"}, lambda **kw: None)["ta_rows"]
    conn.execute("DELETE FROM ta_breakout")  # kalau `stage=all` tidak menghitung TA, tabel tetap kosong
    conn.commit()
    second = jobs.compute({"stage": "all", "timeframe": "d1"}, lambda **kw: None)["ta_rows"]
    after = conn.execute("SELECT COUNT(*) FROM ta_breakout").fetchone()[0]
    conn.close()
    assert first == second == after > 0  # stage=all MENYERTAKAN TA (docs/05 §4.1) & idempoten
