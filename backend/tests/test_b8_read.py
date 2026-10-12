"""B8 — endpoint read `docs/05` §1–§2: bentuk field, filter, pagination, cache."""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app import cache, db
from backend.app.compute import index, metrics, rrg
from backend.app.config import get_settings

STAMP = "2026-10-13T00:00:00+07:00"
DATES = pd.bdate_range("2026-01-05", "2026-10-14").strftime("%Y-%m-%d").tolist()  # berakhir Rabu


def _seed(conn, ticker: str, closes, *, sector_code: str | None = "IDXFINANCE", volume: int = 2_000_000) -> None:
    if sector_code:
        sector_id = conn.execute("SELECT id FROM sector WHERE code = ?", (sector_code,)).fetchone()[0]
        conn.execute(
            "INSERT INTO stock (ticker, yahoo_symbol, sector_id, shares_outstanding, is_active, updated_at) VALUES (?,?,?,1000000,1,?)",
            (ticker, f"{ticker}.JK", sector_id, STAMP),
        )
    for date, close in zip(DATES, closes):
        conn.execute(
            "INSERT INTO price_daily (ticker,date,open,high,low,close,adj_close,volume,value_idr,source,ingested_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,'test',?)",
            (ticker, date, close, close * 1.01, close * 0.99, close, close, volume, int(close * volume), STAMP),
        )


def _series(rate: float, amplitude: float = 60.0, ramp: float = 0.0):
    steps = np.arange(len(DATES))
    return 1_000 * np.cumprod(1 + rate + ramp * steps) + amplitude * np.sin(steps / 4)


@pytest.fixture
def read_db(tmp_db):
    conn = db.connect(tmp_db)
    try:
        _seed(conn, "IHSG", _series(0.0003, 5.0), sector_code=None, volume=0)
        _seed(conn, "AAAA", _series(0.0035, ramp=0.00002))
        _seed(conn, "BBBB", _series(0.0008, ramp=0.00001))
        _seed(conn, "CCCC", _series(0.0005))
        _seed(conn, "DDDD", _series(0.0010), sector_code="IDXENERGY")  # sektor kedua supaya filter terbukti
        # satu baris sinyal mingguan supaya `streak_weeks` & `last_pick` teruji
        sector_id = conn.execute("SELECT id FROM sector WHERE code = 'IDXFINANCE'").fetchone()[0]
        conn.execute(
            "INSERT INTO signal_weekly (week_end, scope, ref_id, sector_id, timeframe, rank, score, streak_weeks,"
            " rule_hits, entry_ref, stop, target, atr14, lots_hint, rationale, computed_at)"
            " VALUES ('2026-10-09','stock','AAAA',?, 'w1_fri', 1, 88.0, 3, '{}', 2500, 2400, 2700, 60, 33, 'uji', ?)",
            (sector_id, STAMP),
        )
        conn.execute(
            "INSERT INTO signal_weekly (week_end, scope, ref_id, sector_id, timeframe, rank, score, streak_weeks,"
            " rule_hits, rationale, computed_at) VALUES ('2026-10-09','sector','IDXFINANCE',?, 'w1_fri', 1, 80.0, 2, '{}', 'uji', ?)",
            (sector_id, STAMP),
        )
        conn.commit()
    finally:
        conn.close()

    index.compute_index(db_path=tmp_db, weightings=["equal"])
    rrg.compute_rrg(timeframes=["d1"], weightings=["equal"], db_path=tmp_db)
    metrics.compute_metrics(timeframes=["d1"], weightings=["equal"], db_path=tmp_db)
    metrics.compute_scores(timeframes=["d1"], weightings=["equal"], db_path=tmp_db)
    return tmp_db


@pytest.fixture
def client(read_db, monkeypatch):
    monkeypatch.setattr(db, "db_path", lambda: read_db)
    cache.clear()
    from backend.app.main import app

    return TestClient(app)


# --- §1 meta ------------------------------------------------------------------


def test_meta_sectors_dan_config(client):
    sectors = client.get("/api/v1/meta/sectors").json()
    assert sectors["api_version"] == "1.0"
    assert len(sectors["items"]) == 11
    item = sectors["items"][0]
    assert set(item) == {"code", "name_id", "name_en", "color_token", "color_hex", "sort_order", "constituents_active"}
    finance = next(i for i in sectors["items"] if i["code"] == "IDXFINANCE")
    assert finance["color_token"] == "sector-finance" and finance["constituents_active"] == 3

    cfg = client.get("/api/v1/meta/config").json()
    assert set(cfg) == {"api_version", "universe", "rrg", "timeframes", "windows", "midday_gate_min_bar_time", "last_ingest"}
    assert cfg["universe"] == {"min_turnover_idr": 1_000_000_000, "min_price_idr": 100, "max_rsi": 75}
    assert cfg["timeframes"] == ["d1", "w1", "w1_fri", "midday"]
    assert cfg["rrg"]["min_points"]["d1"] == 60
    assert cfg["last_ingest"] == {"prices_daily": None, "intraday": None, "signals_weekly": None}


# --- §2 /rrg ------------------------------------------------------------------


def test_rrg_kontrak_tail_dan_filter(client):
    body = client.get("/api/v1/rrg").json()
    assert body["api_version"] == "1.1"  # contoh docs/05 §2 memakai 1.1
    assert body["timeframe"] == "d1" and body["weighting"] == "equal"
    assert set(body) == {"api_version", "timeframe", "as_of", "window", "weighting", "quadrants", "items", "data_status"}
    assert set(body["quadrants"]) == {"leading", "improving", "weakening", "lagging"}
    assert sum(body["quadrants"].values()) == len(body["items"])

    item = body["items"][0]
    assert set(item) == {
        "ref_id", "name", "color_hex", "rs_ratio", "rs_momentum", "rs_ratio_change_1p", "rs_momentum_change_1p",
        "quadrant", "quadrant_prev", "transition", "quadrant_age_periods", "score", "rank_score", "streak_weeks",
        "ret_1w", "median_turnover_20d_idr", "tail",
    }
    assert item["streak_weeks"] == 2 and item["rank_score"] == 1  # dari signal_weekly
    assert item["tail"] and item["tail"][-1]["as_of"] == body["as_of"]
    assert item["tail"][-1]["rs_ratio"] == item["rs_ratio"]  # titik terakhir == nilai di atas
    assert body["data_status"]["as_of"] == body["as_of"]

    # filter `sector` dua bentuk + `scope=stock` (skor null)
    one = client.get("/api/v1/rrg?sector=IDXFINANCE").json()
    assert [i["ref_id"] for i in one["items"]] == ["IDXFINANCE"]
    assert client.get("/api/v1/rrg?sector=IDXFINANCE,IDXENERGY").json()["items"]
    stock = client.get("/api/v1/rrg?scope=stock&sector=IDXFINANCE").json()
    assert {i["ref_id"] for i in stock["items"]} == {"AAAA", "BBBB", "CCCC"}
    assert all(i["score"] is None and i["rank_score"] is None for i in stock["items"])
    # tail_points dibatasi 60 dan param tak dikenal diabaikan
    tail = client.get("/api/v1/rrg?tail_points=999&tidak_dikenal=1").json()["items"][0]["tail"]
    assert len(tail) == 60


# --- §2 /sectors/summary ------------------------------------------------------


def test_sectors_summary_filter_pagination(client):
    body = client.get("/api/v1/sectors/summary").json()
    assert set(body) == {"api_version", "total", "limit", "offset", "items", "data_status"}
    assert body["total"] == 2 and len(body["items"]) == 2
    item = next(i for i in body["items"] if i["code"] == "IDXFINANCE")
    assert set(item) == {
        "code", "name_id", "color_hex", "quadrant", "quadrant_label", "quadrant_desc", "quadrant_prev", "transition",
        "quadrant_age_periods", "rs_ratio", "rs_momentum", "rs_ratio_change_1p", "rs_momentum_change_1p", "ret_1w",
        "ret_1m", "ret_3m", "ret_6m", "ret_ytd", "turnover_idr", "median_turnover_20d_idr", "turnover_growth",
        "advancers", "decliners", "unchanged", "constituents_count", "partial", "score", "rank_score", "streak_weeks",
        "top_stock",
    }
    assert item["quadrant_label"] == {"leading": "Memimpin", "improving": "Membaik", "weakening": "Melemah", "lagging": "Tertinggal"}[item["quadrant"]]
    assert item["quadrant_desc"]
    assert item["streak_weeks"] == 2 and item["top_stock"]["ticker"] == "AAAA" and item["top_stock"]["stock_score"]
    assert item["partial"] is False and item["constituents_count"] == 3

    # pagination
    page = client.get("/api/v1/sectors/summary?limit=1&offset=1").json()
    assert (page["total"], page["limit"], page["offset"]) == (2, 1, 1) and len(page["items"]) == 1
    # filter sektor & kuadran (dua bentuk penulisan)
    only = client.get("/api/v1/sectors/summary?sector=IDXFINANCE").json()
    assert only["total"] == 1 and only["items"][0]["code"] == "IDXFINANCE"
    leading = client.get("/api/v1/sectors/summary?quadrant=LEADING,improving").json()
    assert all(i["quadrant"] in ("leading", "improving") for i in leading["items"])
    # min_streak & ret_positive_only & sort
    assert client.get("/api/v1/sectors/summary?min_streak=2").json()["total"] == 1
    naik = client.get("/api/v1/sectors/summary?ret_positive_only=true&window=1m").json()
    assert all((i["ret_1m"] or 0) > 0 for i in naik["items"])
    asc = client.get("/api/v1/sectors/summary?sort=rs_ratio&dir=asc").json()
    assert [i["rs_ratio"] for i in asc["items"]] == sorted(i["rs_ratio"] for i in asc["items"])
    # param tak dikenal tidak memecah apa pun
    assert client.get("/api/v1/sectors/summary?window=bogus&foo=1").json()["total"] == 2


def test_sector_detail(client):
    body = client.get("/api/v1/sectors/IDXFINANCE?window=1m&constituents_limit=2").json()
    assert set(body) == {"api_version", "sector", "metrics", "series", "constituents", "data_status"}
    assert body["sector"] == {"code": "IDXFINANCE", "name_id": "Keuangan", "color_hex": body["sector"]["color_hex"]}
    assert set(body["metrics"]) == {"quadrant", "rs_ratio", "rs_momentum", "ret_1w", "score", "streak_weeks", "constituents_count", "advancers", "decliners"}
    assert body["series"] and set(body["series"][0]) == {"date", "index_close", "ret_1d"}
    assert body["constituents"]["total"] == 3 and len(body["constituents"]["items"]) == 2
    first = body["constituents"]["items"][0]
    assert set(first) == {"ticker", "name", "close", "ret_1d", "ret_1w", "median_turnover_20d_idr", "rs_ratio", "rs_momentum", "quadrant", "stock_score", "rsi14", "atr14"}
    assert first["ticker"] == "AAAA"  # default constituent_sort=stock_score

    kode_kecil = client.get("/api/v1/sectors/idxfinance").json()
    assert kode_kecil["sector"]["code"] == "IDXFINANCE"
    assert client.get("/api/v1/sectors/IDXZZZ").status_code == 404


def test_meta_dates(client):
    body = client.get("/api/v1/meta/dates").json()
    assert body["api_version"] == "1.1"  # docs/05 §1
    assert set(body) == {"api_version", "timeframe", "latest", "dates"}
    assert body["timeframe"] == "d1"
    assert body["dates"] and body["dates"] == sorted(body["dates"], reverse=True)  # urut menurun
    assert body["latest"] == body["dates"][0]
    assert client.get("/api/v1/meta/dates?limit=1").json()["dates"] == [body["latest"]]
    assert client.get("/api/v1/meta/dates?limit=999").status_code == 422  # maks 400

    invalid = client.get("/api/v1/meta/dates?timeframe=x1")
    assert invalid.status_code == 400
    assert invalid.json()["error"]["code"] == "invalid_timeframe"


def test_meta_dates_fallback_dan_kosong(client, read_db, tmp_path, monkeypatch):
    """`rrg_daily` kosong → fallback `sector_metrics`; keduanya kosong → daftar kosong (bukan error)."""
    conn = db.connect(read_db)
    try:
        conn.execute("DELETE FROM rrg_daily")
        conn.commit()
    finally:
        conn.close()
    cache.clear()
    fallback = client.get("/api/v1/meta/dates").json()
    assert fallback["dates"] and fallback["latest"] == fallback["dates"][0]

    empty_path = tmp_path / "kosong.db"  # DB lain yang benar-benar belum dihitung
    db.init_db(empty_path)
    monkeypatch.setattr(db, "db_path", lambda: empty_path)
    cache.clear()
    from backend.app.main import app

    empty = TestClient(app).get("/api/v1/meta/dates").json()
    assert empty == {"api_version": "1.1", "timeframe": "d1", "latest": None, "dates": []}


# --- §2 /stocks & /stocks/{ticker} -------------------------------------------


def test_stocks_list(client):
    body = client.get("/api/v1/stocks").json()
    assert body["total"] == 4 and body["limit"] == 50 and body["items"][0]["ticker"] == "AAAA"
    assert set(body["items"][0]) == {
        "ticker", "name", "sector_code", "close", "ret_1d", "ret_1w", "ret_1m", "median_turnover_20d_idr",
        "rs_ratio", "rs_momentum", "quadrant", "quadrant_label", "stock_score", "rsi14", "atr14",
    }
    assert client.get("/api/v1/stocks?q=aa&limit=1").json()["total"] == 1
    assert client.get("/api/v1/stocks?sector=IDXFINANCE,IDXENERGY").json()["total"] == 4
    assert client.get("/api/v1/stocks?sector=IDXENERGY").json()["total"] == 1
    assert client.get("/api/v1/stocks?min_price_idr=9999999").json()["total"] == 0
    assert client.get("/api/v1/stocks?sort=ticker&dir=asc").json()["items"][0]["ticker"] == "AAAA"
    invalid = client.get("/api/v1/stocks?limit=999")  # maks 500 → 422 dengan envelope kontrak
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "validation_error"
    assert invalid.json()["api_version"] == "1.0"


def test_stock_detail(client):
    body = client.get("/api/v1/stocks/AAAA?window=1m").json()
    assert set(body) == {"api_version", "stock", "metrics", "series", "last_pick"}
    assert body["stock"]["yahoo_symbol"] == "AAAA.JK"
    assert set(body["metrics"]) == {
        "close", "sma20", "sma50", "rsi14", "atr14", "ret_1d", "ret_1w", "ret_1m", "median_turnover_20d_idr",
        "rs_ratio", "rs_momentum", "quadrant", "stock_score", "margin_to_min_turnover",
    }
    assert body["metrics"]["margin_to_min_turnover"] == pytest.approx(body["metrics"]["median_turnover_20d_idr"] / 1_000_000_000, abs=0.1)
    assert body["last_pick"]["week_end"] == "2026-10-09" and body["last_pick"]["streak_weeks"] == 3
    assert body["series"] and set(body["series"][0]) == {"date", "close", "volume"}

    assert client.get("/api/v1/stocks/ZZZZ").status_code == 404
    assert client.get("/api/v1/stocks/ZZZZ").json()["error"]["code"] == "not_found"


# --- §2 matriks, heatmap, series ---------------------------------------------


def test_matrix_heatmap_series(client):
    matrix = client.get("/api/v1/rotation/matrix").json()
    assert set(matrix) == {"api_version", "timeframe", "from", "to", "cells", "changes"}  # alias "from" benar
    assert matrix["to"] == "2026-10-14" and matrix["from"] < matrix["to"]
    assert all(set(c) == {"from", "to", "count", "refs"} for c in matrix["cells"])

    heat = client.get("/api/v1/heatmap").json()
    assert heat["columns"] == ["1d", "1w", "1m", "3m"]
    assert len(heat["rows"]) == 11 and set(heat["rows"][0]) == {"code", "name_id", "values"}
    assert set(heat["rows"][0]["values"]) == {"1d", "1w", "1m", "3m"}

    series = client.get("/api/v1/series/sector/IDXFINANCE?from=2026-09-01").json()
    assert series["code"] == "IDXFINANCE" and series["points"]
    assert set(series["points"][0]) == {"date", "index_close", "bench_close", "rs", "turnover_idr"}
    assert all(p["date"] >= "2026-09-01" for p in series["points"])
    assert client.get("/api/v1/series/sector/IDXZZZ").status_code == 404


# --- cache 60 detik (docs/07 B8) ---------------------------------------------


def test_cache_dipakai_dan_dibersihkan(client, read_db):
    first = client.get("/api/v1/sectors/summary").json()
    assert first["total"] == 2
    conn = db.connect(read_db)
    try:
        conn.execute("DELETE FROM sector_metrics")
        conn.commit()
    finally:
        conn.close()
    cached = client.get("/api/v1/sectors/summary").json()
    assert cached["total"] == 2 and json.dumps(cached) == json.dumps(first)  # dari cache, DB sudah kosong
    cache.clear()
    # cache dibersihkan → DB dibaca ulang (kolom dari `sector_metrics` yang sudah dihapus jadi null)
    assert client.get("/api/v1/sectors/summary").json()["items"][0]["ret_1w"] is None
