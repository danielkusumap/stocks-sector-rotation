"""Audit Hermes: response_model kontrak, ret_4w config-driven, `require_sektor_kandidat`, baris freshness B3."""

from __future__ import annotations

import json
import sqlite3

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app import cache, db
from backend.app.compute import metrics, rrg, signals
from backend.app.config import get_settings
from backend.app.ingest import prices
from backend.app.repo import run as runs
from backend.tests.test_b2_prices import db_with_universe as b2_universe
from backend.tests.test_b3_intraday_gate import DAY, _frame, db_with_universe, small_config
from backend.tests.test_b7_signals import signal_inputs, weekly_db  # noqa: F401
from backend.tests.test_b8_read import client, read_db  # noqa: F401  (fixture dipakai test di bawah)

# --- 1) response_model benar-benar menegakkan bentuk respons -------------------

SCHEMA_ENDPOINTS = {
    "/api/v1/freshness": "FreshnessResponse",
    "/api/v1/admin/runs": "RunsResponse",
    "/api/v1/admin/runs/{run_id}": "RunDetailResponse",
    "/api/v1/weekly/picks": "WeeklyPicksResponse",
}


def test_openapi_memuat_schema_response(tmp_db, monkeypatch):
    """Setiap endpoint audit punya model di openapi — bukan cuma kesepakatan dokumen."""
    monkeypatch.setattr(db, "db_path", lambda: tmp_db)
    from backend.app.main import app

    spec = app.openapi()
    for path, model in SCHEMA_ENDPOINTS.items():
        assert path in spec["paths"], path
        schema = spec["paths"][path]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
        assert model in json.dumps(schema), (path, schema)
        assert model in spec["components"]["schemas"], model

    runs_props = spec["components"]["schemas"]["RunsResponse"]["properties"]
    assert "runs" in runs_props and "items" not in runs_props  # docs/05 §4.6
    assert "run" in spec["components"]["schemas"]["RunDetailResponse"]["properties"]  # §4.3
    assert "runs" in spec["components"]["schemas"]["RunsResponse"]["required"]


def test_weekly_picks_tidak_membocorkan_field_di_luar_kontrak(signal_inputs, monkeypatch):
    monkeypatch.setattr(db, "db_path", lambda: signal_inputs)
    cache.clear()
    signals.compute_signals(db_path=signal_inputs)
    from backend.app.main import app

    body = TestClient(app).get("/api/v1/weekly/picks").json()
    assert body["sectors"] and body["stocks"]
    assert set(body["sectors"][0]) == {"ref_id", "name", "rank", "score", "streak_weeks", "rule_hits", "rationale"}
    assert set(body["stocks"][0]) == {
        "ticker", "name", "sector_code", "rank", "score", "streak_weeks",
        "entry_ref", "stop", "target", "atr14", "lots_hint", "rule_hits", "rationale", "plan",
    }  # `week_end`/`sector_id` dari SQL tidak lagi bocor ke respons; `plan` = docs/05 §3 (api_version 1.2)


def test_freshness_dan_runs_ikut_model(client, tmp_db):
    """Envelope `runs`/`run` dan blok freshness lolos validasi model, bukan dict bebas."""
    from backend.app import jobs

    jobs.execute("midday", {}, lambda p, report: {"rows": 0}, triggered_by="api")

    freshness_body = client.get("/api/v1/freshness").json()
    assert set(freshness_body) == {"api_version", "midday_gate", "daily_ingest"}
    assert set(freshness_body["daily_ingest"]) == {"status", "last_data_at", "last_bar_date", "expected_bar_date"}

    runs_body = client.get("/api/v1/admin/runs?limit=3").json()
    assert set(runs_body) == {"api_version", "total", "runs"} and runs_body["runs"]
    assert set(runs_body["runs"][0]) >= {"run_id", "kind", "status", "started_at", "percent", "failed_tickers"}

    detail = client.get(f"/api/v1/admin/runs/{runs_body['runs'][0]['run_id']}").json()
    assert set(detail) == {"api_version", "run"} and detail["run"]["kind"] == "midday"


# --- 2) ret_4w memakai acuan return yang sama dengan skor ----------------------


def test_ret_4w_config_driven(signal_inputs, monkeypatch):
    cfg = get_settings()
    week = "2026-10-09"
    conn = db.connect(signal_inputs)
    try:
        sector_id = conn.execute("SELECT id FROM sector WHERE code = 'IDXFINANCE'").fetchone()[0]
        bars = [dict(r) for r in conn.execute(
            "SELECT date, index_close FROM sector_index_daily WHERE sector_id = ? AND weighting = 'equal' ORDER BY date",
            (sector_id,),
        )]
        refs = signals.reference_returns(conn, week, weighting="equal", cfg=cfg)
    finally:
        conn.close()

    series = pd.Series([b["index_close"] for b in bars], index=[b["date"] for b in bars])
    expected = metrics.window_return(rrg.weekly(series, final_only=True), week, cfg.scoring["return_window_weeks"])
    assert refs[sector_id] == pytest.approx(expected)
    assert expected is not None and expected > 0

    monkeypatch.setitem(cfg.scoring, "return_window_weeks", 2)  # ambang dari config, bukan angka mati
    conn = db.connect(signal_inputs)
    try:
        short = signals.reference_returns(conn, week, weighting="equal", cfg=cfg)[sector_id]
    finally:
        conn.close()
    assert short != pytest.approx(expected)


def test_rule_hits_ret_4w_pakai_sumber_yang_sama(signal_inputs):
    """`rule_hits.ret_4w` di `signal_weekly` = acuan return dari seri indeks (bukan `sector_metrics.ret_1m`)."""
    week = "2026-10-09"
    signals.compute_signals(db_path=signal_inputs)
    conn = db.connect(signal_inputs)
    try:
        row = conn.execute(
            "SELECT rule_hits FROM signal_weekly WHERE scope = 'sector' AND week_end = ? ORDER BY rank LIMIT 1", (week,)
        ).fetchone()
        refs = signals.reference_returns(conn, week, weighting="equal", cfg=get_settings())
        hits = json.loads(row["rule_hits"])
        expected = next(v for v in refs.values() if v is not None)
    finally:
        conn.close()
    assert hits["ret_4w"] == pytest.approx(expected)
    assert hits["ret_4w_ok"] is True


# --- 3) `weekly.require_sektor_kandidat` dihormati ----------------------------


@pytest.fixture
def two_sector_inputs(read_db):
    """read_db (IDXFINANCE & IDXENERGY berisi) + input aturan: IDXFINANCE kandidat, IDXENERGY tidak;
    AAAA (IDXFINANCE) & DDDD (IDXENERGY) sama-sama lolos aturan saham §6.2."""
    rrg.compute_rrg(timeframes=["w1_fri"], weightings=["equal"], scopes=("sector",), db_path=read_db)
    metrics.compute_metrics(timeframes=["w1_fri"], weightings=["equal"], db_path=read_db)
    metrics.compute_scores(timeframes=["w1_fri"], weightings=["equal"], db_path=read_db)

    conn = db.connect(read_db)
    try:
        conn.execute(
            "UPDATE rrg_daily SET quadrant = 'leading', quadrant_prev = 'improving', quadrant_age_periods = 3,"
            " rs_momentum = 101.5, rs_momentum_change_1p = 0.4, score = 80 WHERE scope = 'sector'"
            " AND ref_id = 'IDXFINANCE' AND timeframe = 'w1_fri'"
        )
        conn.execute(
            "UPDATE rrg_daily SET quadrant = 'lagging', quadrant_prev = 'lagging', quadrant_age_periods = 5,"
            " rs_momentum = 99, rs_momentum_change_1p = -0.2 WHERE scope = 'sector'"
            " AND ref_id = 'IDXENERGY' AND timeframe = 'w1_fri'"
        )
        for ticker, sma20, sma50 in (("AAAA", 1400, 1300), ("DDDD", 1000, 900)):
            conn.execute(
                "UPDATE stock_metrics SET close = 1500, sma20 = ?, sma50 = ?, rsi14 = 60, atr14 = 60,"
                " ret_5d = 0.02, median_turnover_20d_idr = 5000000000 WHERE ticker = ? AND timeframe = 'd1'",
                (sma20, sma50, ticker),
            )
            conn.execute("UPDATE rrg_daily SET rs_ratio = 106.0 WHERE scope = 'stock' AND ref_id = ? AND timeframe = 'd1'", (ticker,))
        conn.commit()
    finally:
        conn.close()
    return read_db


def _stock_picks(db_path) -> set[str]:
    conn = db.connect(db_path)
    try:
        week = conn.execute("SELECT MAX(week_end) FROM signal_weekly").fetchone()[0]
        return {r[0] for r in conn.execute("SELECT DISTINCT ref_id FROM signal_weekly WHERE scope = 'stock' AND week_end = ?", (week,))}
    finally:
        conn.close()


@pytest.mark.slow
def test_require_sektor_kandidat_dihormati(two_sector_inputs, monkeypatch):
    cfg = get_settings()
    monkeypatch.setitem(cfg.weekly, "require_sektor_kandidat", True)
    signals.compute_signals(db_path=two_sector_inputs)
    ketat = _stock_picks(two_sector_inputs)
    assert "AAAA" in ketat and "DDDD" not in ketat  # DDDD di sektor non-kandidat

    monkeypatch.setitem(cfg.weekly, "require_sektor_kandidat", False)
    signals.compute_signals(db_path=two_sector_inputs)
    longgar = _stock_picks(two_sector_inputs)
    assert "DDDD" in longgar and "AAAA" in longgar


@pytest.mark.slow
def test_compute_all_menyiapkan_prasyarat_w1_fri(read_db, monkeypatch):
    """Temuan gladi bersih: `stage=all` (tombol 4) tidak menghitung `w1_fri` sehingga langkah
    sinyalnya selalu 0 baris. Sekarang tombol 4 menghitung RRG/metrik/skor `w1_fri` sektor."""
    monkeypatch.setattr(db, "db_path", lambda: read_db)
    from backend.app import jobs

    result = jobs.compute({"stage": "all", "timeframe": "d1"}, lambda **k: None)
    assert "w1_fri" in result["timeframes"]

    conn = db.connect(read_db)
    try:
        rrg_w1f = conn.execute("SELECT COUNT(*) FROM rrg_daily WHERE timeframe = 'w1_fri' AND scope = 'sector'").fetchone()[0]
        metrics_w1f = conn.execute("SELECT COUNT(*) FROM sector_metrics WHERE timeframe = 'w1_fri'").fetchone()[0]
        scored_w1f = conn.execute("SELECT COUNT(*) FROM sector_metrics WHERE timeframe = 'w1_fri' AND score IS NOT NULL").fetchone()[0]
        stock_w1f = conn.execute("SELECT COUNT(*) FROM rrg_daily WHERE timeframe = 'w1_fri' AND scope = 'stock'").fetchone()[0]
    finally:
        conn.close()
    assert rrg_w1f > 0 and metrics_w1f > 0 and scored_w1f > 0
    assert stock_w1f == 0  # saham sengaja tidak dihitung untuk w1_fri (jaga durasi tombol 4)


def test_data_status_stale_kalau_tidak_ada_hasil_hitung(read_db, monkeypatch):
    """Timeframe tanpa baris hasil hitung harus `stale`, bukan `ok` dengan `as_of: null`."""
    monkeypatch.setattr(db, "db_path", lambda: read_db)
    cache.clear()
    from backend.app.main import app

    body = TestClient(app).get("/api/v1/sectors/summary?timeframe=midday").json()
    assert body["items"] == [] and body["data_status"]["as_of"] is None
    assert body["data_status"]["status"] == "stale"


# --- 4) B3: baris `data_freshness` ditulis setelah ingest ---------------------


def test_ingest_intraday_catat_baris_freshness(db_with_universe, small_config, monkeypatch):
    monkeypatch.setattr(prices, "fetch", lambda *a, **k: _frame(["11:35"]))
    result = prices.ingest_intraday(tickers=["BBCA"], db_path=db_with_universe)

    assert result["status"] == "ok"
    conn = db.connect(db_with_universe)
    try:
        row = conn.execute("SELECT * FROM data_freshness WHERE key = 'intraday_ingest'").fetchone()
    finally:
        conn.close()
    assert row["status"] == "ok"
    assert row["last_bar_at"] == f"{DAY}T11:35:00+07:00"
    assert json.loads(row["detail"])["rows"] == result["rows"] > 0


def test_ingest_daily_catat_baris_freshness(b2_universe, monkeypatch):
    from backend.tests.test_b2_prices import _frame as daily_frame, _patch_download

    _patch_download(monkeypatch, lambda symbols, **kw: daily_frame(symbols))
    result = prices.ingest_daily(tickers=["BBRI"], db_path=b2_universe)

    conn = db.connect(b2_universe)
    try:
        row = conn.execute("SELECT * FROM data_freshness WHERE key = 'daily_ingest'").fetchone()
    finally:
        conn.close()
    assert result["status"] == "ok" and row is not None
    assert row["status"] == "ok" and row["last_bar_at"]
    assert json.loads(row["detail"])["rows"] == result["rows"] > 0


# --- 5) Temuan gladi bersih: transaksi panjang & progres best-effort ----------


def test_week_picks_tidak_menahan_transaksi(two_sector_inputs):
    """Regresi `database is locked` (gladi bersih): `week_picks` menulis tabel TEMP; tanpa commit,
    koneksi ini menyimpan snapshot basi sehingga `upsert` di akhir loop gagal (SQLITE_BUSY_SNAPSHOT)
    begitu `report()` menulis dari koneksi worker di tengah loop."""
    cfg = get_settings()
    conn = db.connect(two_sector_inputs)
    try:
        weeks = signals.weekly_calendar(conn, cfg.ingest["benchmark_alias"], final_only=True)
        assert weeks, "fixture harus punya minggu final"
        dates = [r[0] for r in conn.execute(signals.CALENDAR_SQL, (cfg.ingest["benchmark_alias"],))]
        sector_rows, _ = signals.week_picks(conn, weeks[-1], weighting="equal", trading_dates=dates, cfg=cfg)
        assert sector_rows, "fixture harus menghasilkan kandidat sektor (jalur tabel TEMP terpakai)"
        assert conn.in_transaction is False
    finally:
        conn.close()


def test_report_best_effort_saat_database_locked():
    """Progres kosmetik tidak boleh membunuh job panjang yang sedang menahan kunci tulis."""

    class LockedConn:
        def execute(self, *args, **kwargs):
            raise sqlite3.OperationalError("database is locked")

        def rollback(self):
            pass

    runs.report(LockedConn(), 1, rows=5, rows_total=10)  # tidak raise

    class BrokenConn(LockedConn):
        def execute(self, *args, **kwargs):
            raise sqlite3.OperationalError("no such table: ingest_run")

    with pytest.raises(sqlite3.OperationalError):
        runs.report(BrokenConn(), 1, rows=5)
