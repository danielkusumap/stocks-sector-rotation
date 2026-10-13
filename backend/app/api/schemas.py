"""Model respons pydantic untuk `docs/05` §1–§2 (dipakai sebagai `response_model`)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class DataStatus(BaseModel):
    as_of: str | None
    timeframe: str
    status: str
    last_data_at: str | None
    computed_at: str | None
    range_from: str | None
    range_to: str | None
    range_label: str | None
    partial_sectors: list[str]
    detail: str | None = None


class Envelope(BaseModel):
    api_version: str


# --- §1 meta ------------------------------------------------------------------


class SectorMaster(BaseModel):
    code: str
    name_id: str
    name_en: str
    color_token: str
    color_hex: str
    sort_order: int
    constituents_active: int


class MetaSectorsResponse(Envelope):
    items: list[SectorMaster]


class LastIngest(BaseModel):
    prices_daily: str | None
    intraday: str | None
    signals_weekly: str | None


class MarketLimits(BaseModel):
    """`config.market` yang dipakai UI untuk interval poll kutipan IHSG (docs/05 §1 `/meta/config`)."""

    live_enabled: bool
    live_ttl_seconds: int
    poll_seconds: int
    move_flat_pct: float


class MetaConfigResponse(Envelope):
    universe: dict[str, Any]
    rrg: dict[str, Any]
    timeframes: list[str]
    windows: list[str]
    midday_gate_min_bar_time: str
    market: MarketLimits
    ta: dict[str, Any]  # docs/05 §1: UI tidak boleh menghardcode MA default/target/timeout
    last_ingest: LastIngest


class MarketQuoteResponse(Envelope):
    """Kutipan IHSG (docs/05 §1 `/meta/market`) — hanya benchmark, tidak untuk emiten/sektor."""

    benchmark: str
    symbol: str
    close: float | None
    prev_close: float | None
    ret_1d: float | None
    ret_1w: float | None
    ret_intraday: float | None
    open: float | None
    high: float | None
    low: float | None
    volume: int | None
    as_of: str | None
    last_bar_at: str | None
    session: str
    source: str
    delayed: bool
    cached: bool
    cache_age_s: int | None
    data_status: DataStatus


class MetaDatesResponse(Envelope):
    timeframe: str
    latest: str | None
    dates: list[str]


# --- §1 freshness ---------------------------------------------------------------


class GateProbe(BaseModel):
    ticker: str
    last_bar_at: str | None


class MiddayGate(BaseModel):
    status: str
    as_of_date: str | None
    last_bar_at: str | None
    required_bar_time: str | None
    probes: list[GateProbe]
    checked_at: str | None


class DailyIngest(BaseModel):
    status: str
    last_data_at: str | None
    last_bar_date: str | None
    expected_bar_date: str


class FreshnessResponse(Envelope):
    midday_gate: MiddayGate
    daily_ingest: DailyIngest


# --- §2 diagram & tabel ------------------------------------------------------


class TailPoint(BaseModel):
    as_of: str
    rs_ratio: float
    rs_momentum: float


class RrgItem(BaseModel):
    ref_id: str
    name: str | None
    color_hex: str | None
    rs_ratio: float
    rs_momentum: float
    rs_ratio_change_1p: float | None
    rs_momentum_change_1p: float | None
    quadrant: str
    quadrant_prev: str | None
    transition: str | None
    quadrant_age_periods: int
    score: float | None
    rank_score: int | None
    streak_weeks: int
    ret_1w: float | None
    median_turnover_20d_idr: int | None
    tail: list[TailPoint]


class RrgResponse(Envelope):
    timeframe: str
    as_of: str | None
    window: str
    weighting: str
    quadrants: dict[str, int]
    items: list[RrgItem]
    data_status: DataStatus


class TopStock(BaseModel):
    ticker: str
    stock_score: float | None


class SectorSummaryItem(BaseModel):
    code: str
    name_id: str
    color_hex: str
    quadrant: str
    quadrant_label: str | None
    quadrant_desc: str | None
    quadrant_prev: str | None
    transition: str | None
    quadrant_age_periods: int
    rs_ratio: float
    rs_momentum: float
    rs_ratio_change_1p: float | None
    rs_momentum_change_1p: float | None
    ret_1w: float | None
    ret_1m: float | None
    ret_3m: float | None
    ret_6m: float | None
    ret_ytd: float | None
    turnover_idr: int | None
    median_turnover_20d_idr: int | None
    turnover_growth: float | None
    advancers: int
    decliners: int
    unchanged: int
    constituents_count: int
    partial: bool
    score: float | None
    rank_score: int | None
    streak_weeks: int
    top_stock: TopStock | None


class SectorSummaryResponse(Envelope):
    total: int
    limit: int
    offset: int
    items: list[SectorSummaryItem]
    data_status: DataStatus


class SectorHead(BaseModel):
    code: str
    name_id: str
    color_hex: str


class SectorDetailMetrics(BaseModel):
    quadrant: str | None
    rs_ratio: float | None
    rs_momentum: float | None
    ret_1w: float | None
    score: float | None
    streak_weeks: int
    constituents_count: int | None
    advancers: int | None
    decliners: int | None


class SeriesPoint(BaseModel):
    date: str
    index_close: float
    ret_1d: float | None


class ConstituentItem(BaseModel):
    ticker: str
    name: str | None
    close: float | None
    ret_1d: float | None
    ret_1w: float | None
    median_turnover_20d_idr: int | None
    rs_ratio: float | None
    rs_momentum: float | None
    quadrant: str | None
    stock_score: float | None
    rsi14: float | None
    atr14: float | None


class ConstituentPage(BaseModel):
    total: int
    items: list[ConstituentItem]


class SectorDetailResponse(Envelope):
    sector: SectorHead
    metrics: SectorDetailMetrics
    series: list[SeriesPoint]
    constituents: ConstituentPage
    data_status: DataStatus


class StockListItem(BaseModel):
    ticker: str
    name: str | None
    sector_code: str
    close: float | None
    ret_1d: float | None
    ret_1w: float | None
    ret_1m: float | None
    median_turnover_20d_idr: int | None
    rs_ratio: float | None
    rs_momentum: float | None
    quadrant: str | None
    quadrant_label: str | None
    stock_score: float | None
    rsi14: float | None
    atr14: float | None


class StockListResponse(Envelope):
    total: int
    limit: int
    offset: int
    items: list[StockListItem]
    data_status: DataStatus


class StockHead(BaseModel):
    ticker: str
    name: str | None
    sector_code: str
    yahoo_symbol: str


class StockDetailMetrics(BaseModel):
    close: float | None
    sma20: float | None
    sma50: float | None
    rsi14: float | None
    atr14: float | None
    ret_1d: float | None
    ret_1w: float | None
    ret_1m: float | None
    median_turnover_20d_idr: int | None
    rs_ratio: float | None
    rs_momentum: float | None
    quadrant: str | None
    stock_score: float | None
    margin_to_min_turnover: float | None


class StockBar(BaseModel):
    date: str
    close: float | None
    volume: int | None


class LastPick(BaseModel):
    week_end: str
    rank: int
    streak_weeks: int
    entry_ref: float | None
    stop: float | None
    target: float | None
    rationale: str


class StockDetailResponse(Envelope):
    stock: StockHead
    metrics: StockDetailMetrics
    series: list[StockBar]
    last_pick: LastPick | None
    data_status: DataStatus


class SeriesSectorPoint(BaseModel):
    date: str
    index_close: float
    bench_close: float | None
    rs: float | None
    turnover_idr: int | None


class SeriesSectorResponse(Envelope):
    code: str
    range_from: str | None
    range_to: str | None
    range_label: str | None
    points: list[SeriesSectorPoint]


class MatrixCell(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: str | None = Field(default=None, alias="from")
    to: str | None = None
    count: int
    refs: list[str]


class MatrixChange(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    ref_id: str
    name: str | None
    from_: str | None = Field(default=None, alias="from")
    to: str | None = None
    as_of: str


class MatrixResponse(Envelope):
    model_config = ConfigDict(populate_by_name=True)

    timeframe: str
    from_: str | None = Field(default=None, alias="from")
    to: str | None = None
    cells: list[MatrixCell]
    changes: list[MatrixChange]
    data_status: DataStatus


class HeatmapRow(BaseModel):
    code: str
    name_id: str
    values: dict[str, float | None]


class HeatmapResponse(Envelope):
    columns: list[str]
    rows: list[HeatmapRow]
    data_status: DataStatus


# --- §2 analisa teknikal & backtest MA (docs/03 §10) ----------------------------


class TaStats(BaseModel):
    n_events: int | None
    win: int | None
    loss: int | None
    expired: int | None
    open: int | None
    win_rate: float | None
    median_periods_win: float | None
    median_periods_loss: float | None


class TaBreakout(BaseModel):
    signal_date: str
    entry_date: str
    entry_price: float
    entry_basis: str
    periods_since: int | None
    gain_since: float | None
    result: str | None
    exit_date: str | None
    exit_price: float | None
    periods: int | None


class TaSummaryItem(TaStats):
    ref_id: str
    name: str | None
    sector_code: str | None
    close: float | None
    ma: float | None
    above_ma: bool | None
    last_breakout: TaBreakout | None


class TaCoverage(BaseModel):
    refs_tested: int
    refs_skipped_short_history: int
    bars_from: str | None
    bars_to: str | None
    price_basis: str


class TaSummaryResponse(Envelope):
    scope: str
    timeframe: str
    ma_period: int
    trend_filter: bool
    total: int
    limit: int
    offset: int
    items: list[TaSummaryItem]
    coverage: TaCoverage
    data_status: DataStatus


class TaMaPoint(BaseModel):
    date: str
    close: float
    ma: float


class TaEvent(BaseModel):
    signal_date: str
    entry_date: str
    entry_price: float
    result: str | None
    periods: int | None
    exit_date: str | None
    exit_price: float | None


class TaStatsPair(BaseModel):
    filter_on: TaStats
    filter_off: TaStats


class TaDetailResponse(Envelope):
    scope: str
    ref_id: str
    name: str | None
    ma_period: int
    trend_filter: bool
    price_basis: str
    ma_series: list[TaMaPoint]
    stats: TaStatsPair
    latest: TaBreakout | None
    events: list[TaEvent]
    coverage: TaCoverage
    data_status: DataStatus


# --- §3 briefing pagi --------------------------------------------------------


class Market(BaseModel):
    ihsg_close: float | None
    ihsg_ret_1d: float | None
    ihsg_ret_1w: float | None
    sectors_up: int
    sectors_down: int
    breadth: dict[str, int]
    regime: str
    regime_note: str


class BriefItem(BaseModel):
    code: str
    name_id: str
    quadrant: str | None
    score: float | None
    ret_1w: float | None
    streak_weeks: int
    series: list[dict[str, Any]] | None = None


class BriefChange(BaseModel):
    ref_id: str
    name: str | None
    from_: str | None = Field(default=None, alias="from")
    to: str | None = None
    as_of: str

    model_config = ConfigDict(populate_by_name=True)


class WeeklyFocusSector(BaseModel):
    code: str
    streak_weeks: int
    rationale: str


class WeeklyFocusStock(BaseModel):
    ticker: str
    entry_ref: float | None
    stop: float | None
    target: float | None
    streak_weeks: int
    rationale: str


class WeeklyFocus(BaseModel):
    week_end: str | None
    sectors: list[WeeklyFocusSector]
    stocks: list[WeeklyFocusStock]


class MiddayMove(BaseModel):
    code: str
    ret_intraday: float | None
    direction: str | None
    projected_quadrant: str | None


class MiddayBlock(BaseModel):
    available: bool
    as_of: str | None
    gate: str
    moves: list[MiddayMove]


class WatchItem(BaseModel):
    level: str
    message: str


class WatchlistItem(BaseModel):
    """Sektor/saham yang menarik dipantau (docs/05 §3), dihitung ulang tiap panggilan — bukan tabel DB."""

    kind: str  # sector | stock
    ref_id: str
    name: str
    quadrant: str | None
    streak_weeks: int
    reason: str


class BriefingResponse(Envelope):
    generated_at: str
    data_status: DataStatus
    market: Market
    leaders: list[BriefItem]
    laggards: list[BriefItem]
    changes: list[BriefChange]
    weekly_focus: WeeklyFocus
    midday: MiddayBlock
    watch: list[WatchItem]
    notes_for_report: str
    summary_lines: list[str]
    watchlist: list[WatchlistItem]


# --- §3 weekly picks ------------------------------------------------------------


class WeeklyRuleHits(BaseModel):
    model_config = ConfigDict(extra="allow")  # nilai ikut dikirim untuk audit (docs/03 §6)

    quadrant: str | None = None
    age_ok: bool | None = None
    momentum_ok: bool | None = None
    ret_4w_ok: bool | None = None
    constituents_ok: bool | None = None
    liquidity_ok: bool | None = None
    price_ok: bool | None = None
    trend_ok: bool | None = None
    rs_ok: bool | None = None
    rsi_ok: bool | None = None
    no_suspension: bool | None = None


class WeeklySectorPick(BaseModel):
    ref_id: str
    name: str | None
    rank: int
    score: float
    streak_weeks: int
    rule_hits: dict[str, Any]
    rationale: str


class PlanEntryZone(BaseModel):
    low: float | None
    high: float | None
    reason: str


class PlanStop(BaseModel):
    level: float | None
    pct: float | None
    basis: str | None
    reason: str


class PlanTarget(BaseModel):
    level: float | None
    pct: float | None
    rr: float | None
    basis: str | None
    reason: str


class PlanHold(BaseModel):
    median_periods: float | None
    n_events: int | None
    win_rate: float | None
    hit_tp1: float | None
    hit_tp2: float | None
    reason: str | None


class TaPlan(BaseModel):
    """Trading plan TA (docs/03 §6.4, docs/05 §3) — `plan` menggantikan `stop`/`target` sebagai acuan."""

    regime: str
    entry_tool: str
    entry_tool_reason: str | None = None  # ADR-044 (aditif, api_version tetap 1.2)
    confirm_tool: str
    confirm_reason: str | None = None
    entry_mode: str
    entry_zone: PlanEntryZone
    stop: PlanStop
    tp1: PlanTarget
    tp2: PlanTarget
    hold: PlanHold
    invalidation: str | None
    plan_ok: bool
    notes: list[str]
    risk_pct: float | None = None  # B18c: |stop.pct| supaya UI bisa menampilkan risiko per lembar


class WeeklyStockPick(BaseModel):
    ticker: str
    name: str | None
    sector_code: str | None
    rank: int
    score: float
    streak_weeks: int
    entry_ref: float | None
    stop: float | None
    target: float | None
    atr14: float | None
    lots_hint: int | None
    rule_hits: dict[str, Any]
    rationale: str
    plan: TaPlan | None = None  # docs/05 §3 (api_version 1.2); baris lama → null


class WeeklyPicksResponse(Envelope):
    week_end: str | None
    week_start: str | None
    week_label: str | None
    is_final: bool
    sectors: list[WeeklySectorPick]
    stocks: list[WeeklyStockPick]


# --- §4.3/§4.6 admin runs -------------------------------------------------------


class RunItem(BaseModel):
    run_id: int
    kind: str  # docs/05 §4.6: import_excel | prices_daily | prices_intraday | compute_all | compute_signals | midday
    status: str
    phase: str | None
    started_at: str
    finished_at: str | None
    rows: int
    rows_total: int | None
    percent: float | None
    message: str | None
    triggered_by: str
    failed_tickers: list[str]
    params_json: dict[str, Any] | None
    result_json: dict[str, Any] | None


class RunsResponse(Envelope):
    total: int
    runs: list[RunItem]  # kuncinya `runs`, bukan `items` (docs/05 §4.6)


class RunDetailResponse(Envelope):
    run: RunItem
