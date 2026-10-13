/**
 * Kontrak API v1 — cermin `docs/05-API-CONTRACT.md`, satu tipe per endpoint.
 * Tanpa `any`, tanpa adapter yang mengubah nama field (docs/08 aturan 5).
 *
 * Aturan null: field yang bisa kosong karena warmup / partial / belum tersedia
 * diketik `| null` (docs/05 konvensi: belum bisa dihitung → null, bukan 0).
 */

export const TIMEFRAMES = ["d1", "w1", "w1_fri", "midday"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const WINDOWS = ["1w", "1m", "3m", "6m", "1y", "ytd"] as const;
export type Window = (typeof WINDOWS)[number];

export const WEIGHTINGS = ["equal", "turnover", "captier"] as const;
export type Weighting = (typeof WEIGHTINGS)[number];

export const QUADRANTS = ["leading", "weakening", "lagging", "improving"] as const;
export type Quadrant = (typeof QUADRANTS)[number];

export const SECTOR_SORTS = [
  "score",
  "rs_ratio",
  "rs_momentum",
  "ret_1w",
  "ret_1m",
  "turnover",
  "rank_score",
] as const;
export type SectorSort = (typeof SECTOR_SORTS)[number];

export const STOCK_SORTS = [
  "stock_score",
  "rs_ratio",
  "ret_1d",
  "ret_1w",
  "turnover",
  "ticker",
] as const;
export type StockSort = (typeof STOCK_SORTS)[number];

export type Dir = "asc" | "desc";
export type DataStatusKind = "ok" | "stale" | "partial";

/** Blok yang menemani setiap response hasil hitung (docs/05 konvensi). */
export interface DataStatus {
  as_of: string;
  timeframe: Timeframe;
  status: DataStatusKind;
  last_data_at: string | null;
  computed_at: string;
  /** Rentang yang BENAR-BENAR dipakai hitungan (`docs/05` §1). Backend belum mengirim → opsional. */
  range_from?: string | null;
  range_to?: string | null;
  /** Label rentang Bahasa Indonesia, **disusun backend** — frontend tidak menyusun sendiri. */
  range_label?: string | null;
  /** Rentang jendela return/ekor; `null`/tidak ada → kurungnya tidak ditampilkan (lihat ADR F13). */
  window_range_label?: string | null;
  partial_sectors: string[];
}

export interface ApiErrorBody {
  api_version: string;
  error: { code: string; message: string; detail?: unknown };
}

/** Parameter umum yang dipakai banyak endpoint (docs/05). */
export interface CommonParams {
  timeframe?: Timeframe;
  as_of?: string;
  window?: Window;
  weighting?: Weighting;
  sector?: string[];
}

// ── §1 Meta ─────────────────────────────────────────────────────────────────

export interface HealthResponse {
  api_version: string;
  status: string;
  db: string;
  tables: number;
  uptime_s: number;
}

export interface SectorMeta {
  code: string;
  name_id: string;
  name_en: string;
  color_token: string;
  color_hex: string;
  sort_order: number;
  constituents_active: number;
}

export interface MetaSectorsResponse {
  api_version: string;
  items: SectorMeta[];
}

/** `GET /meta/dates` (docs/05 §1): tanggal yang benar-benar punya hasil hitung, urut menurun. */
export interface MetaDatesParams {
  timeframe?: Timeframe;
  limit?: number;
}

export interface MetaDatesResponse {
  api_version: string;
  timeframe: Timeframe;
  /** `null` kalau belum ada hasil hitung sama sekali. */
  latest: string | null;
  dates: string[];
}

export interface MetaConfigResponse {
  api_version: string;
  universe: { min_turnover_idr: number; min_price_idr: number; max_rsi: number };
  rrg: {
    ema_span: number;
    roc_lag: number;
    weekly: { ema_span: number; roc_lag: number };
    /** per timeframe (docs/05 §1 terkoreksi): { d1: 60, w1: 30, w1_fri: 30, midday: 60 } */
    min_points: Record<Timeframe, number>;
  };
  timeframes: Timeframe[];
  windows: Window[];
  midday_gate_min_bar_time: string;
  /** Analisa teknikal (`config.ta`) — default kontrol panel TA (docs/06 §5.1). */
  ta?: {
    ma_periods: number[];
    ma_default: number;
    trend_filter: boolean;
    trend_filter_period: number;
    target_pct: number;
    timeout_periods: number;
    min_history: number;
    entry_basis: string;
  } | null;
  /** Kutipan IHSG (docs/05 §1 `meta/market`): UI membaca `poll_seconds` untuk interval poll. */
  market?: { live_enabled?: boolean; live_ttl_seconds?: number; poll_seconds?: number } | null;
  last_ingest: {
    prices_daily: string | null;
    intraday: string | null;
    signals_weekly: string | null;
  };
}

/**
 * `GET /meta/market` (docs/05 §1) — kutipan **IHSG saja** untuk kartu Overview.
 * `delayed` selalu `true` di feed IDX: UI wajib menampilkan "per <waktu>" + kata "delay".
 */
export interface MarketResponse {
  api_version: string;
  benchmark: string;
  symbol: string;
  close: number | null;
  prev_close: number | null;
  ret_1d: number | null;
  ret_1w: number | null;
  /** `null` bila `session != "open"` (docs/05 §1) → barisnya tidak ditampilkan. */
  ret_intraday: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  as_of: string | null;
  last_bar_at: string | null;
  session: "open" | "break" | "closed";
  /** `live` = dari Yahoo, `db` = data tersimpan (live gagal / `live=false`). */
  source: "live" | "db";
  delayed: boolean;
  cached: boolean;
  cache_age_s: number;
  data_status: DataStatus;
}

export interface FreshnessProbe {
  ticker: string;
  last_bar_at: string | null;
}

export interface FreshnessResponse {
  api_version: string;
  midday_gate: {
    status: "ok" | "stale";
    as_of_date: string;
    last_bar_at: string | null;
    required_bar_time: string;
    probes: FreshnessProbe[];
  };
  daily_ingest: { status: DataStatusKind; last_data_at: string | null };
}

// ── §2 Diagram & tabel ──────────────────────────────────────────────────────

export interface RrgTailPoint {
  as_of: string;
  rs_ratio: number;
  rs_momentum: number;
}

export interface RrgItem {
  ref_id: string;
  name: string;
  color_hex: string;
  rs_ratio: number;
  rs_momentum: number;
  /** docs/05 §2 (api 1.1): perubahan 1 periode; `null` kalau `rrg_daily` belum punya — jangan 0. */
  rs_ratio_change_1p: number | null;
  rs_momentum_change_1p: number | null;
  quadrant: Quadrant;
  quadrant_prev: Quadrant | null;
  transition: string | null;
  quadrant_age_periods: number;
  score: number | null;
  rank_score: number | null;
  /** docs/05 §2: 0 bila `ref_id` tidak pernah muncul di sinyal mingguan. */
  streak_weeks: number;
  ret_1w: number | null;
  median_turnover_20d_idr: number | null;
  tail: RrgTailPoint[];
}

export interface RrgParams extends CommonParams {
  scope?: "sector" | "stock";
  tail_points?: number;
}

export interface RrgResponse {
  api_version: string;
  timeframe: Timeframe;
  as_of: string;
  window: Window;
  weighting: Weighting;
  quadrants: Record<Quadrant, number>;
  items: RrgItem[];
  data_status: DataStatus;
}

export interface SectorSummaryItem {
  code: string;
  name_id: string;
  color_hex: string;
  quadrant: Quadrant;
  quadrant_label: string;
  quadrant_desc: string;
  quadrant_prev: Quadrant | null;
  transition: string | null;
  quadrant_age_periods: number;
  rs_ratio: number;
  rs_momentum: number;
  rs_ratio_change_1p: number | null;
  rs_momentum_change_1p: number | null;
  ret_1w: number | null;
  ret_1m: number | null;
  ret_3m: number | null;
  ret_6m: number | null;
  ret_ytd: number | null;
  turnover_idr: number | null;
  median_turnover_20d_idr: number | null;
  turnover_growth: number | null;
  advancers: number;
  decliners: number;
  unchanged: number;
  constituents_count: number;
  partial: boolean;
  score: number | null;
  rank_score: number | null;
  streak_weeks: number;
  top_stock: { ticker: string; stock_score: number } | null;
}

export interface SectorSummaryParams extends CommonParams {
  quadrant?: Quadrant[];
  transition?: string;
  min_streak?: number;
  min_turnover_idr?: number;
  /** hanya baris dengan nilai kolom return jendela aktif > 0 (docs/05 §2). */
  ret_positive_only?: boolean;
  only_partial?: boolean;
  sort?: SectorSort;
  dir?: Dir;
  limit?: number;
  offset?: number;
}

export interface SectorSummaryResponse {
  api_version: string;
  total: number;
  limit: number;
  offset: number;
  items: SectorSummaryItem[];
  data_status: DataStatus;
}

export interface Constituent {
  ticker: string;
  name: string;
  close: number;
  ret_1d: number | null;
  ret_1w: number | null;
  median_turnover_20d_idr: number | null;
  rs_ratio: number | null;
  rs_momentum: number | null;
  quadrant: Quadrant | null;
  stock_score: number | null;
  rsi14: number | null;
  atr14: number | null;
}

export interface SectorDetailParams {
  timeframe?: Timeframe;
  window?: Window;
  weighting?: Weighting;
  as_of?: string;
  constituents_limit?: number;
  constituent_sort?: string;
  min_turnover_idr?: number;
  min_price_idr?: number;
}

export interface SectorDetailResponse {
  api_version: string;
  sector: { code: string; name_id: string; color_hex: string };
  metrics: {
    quadrant: Quadrant;
    rs_ratio: number;
    rs_momentum: number;
    ret_1w: number | null;
    score: number | null;
    streak_weeks: number;
    constituents_count: number;
    advancers: number;
    decliners: number;
  };
  series: { date: string; index_close: number; ret_1d: number | null }[];
  constituents: { total: number; items: Constituent[] };
  data_status: DataStatus;
}

export interface StockRow {
  ticker: string;
  name: string;
  sector_code: string;
  close: number;
  ret_1d: number | null;
  ret_1w: number | null;
  ret_1m: number | null;
  median_turnover_20d_idr: number | null;
  rs_ratio: number | null;
  rs_momentum: number | null;
  quadrant: Quadrant | null;
  quadrant_label: string | null;
  stock_score: number | null;
  rsi14: number | null;
  atr14: number | null;
}

export interface StocksParams {
  timeframe?: Timeframe;
  as_of?: string;
  sector?: string[];
  quadrant?: Quadrant[];
  ret_positive_only?: boolean;
  q?: string;
  min_turnover_idr?: number;
  min_price_idr?: number;
  sort?: StockSort;
  dir?: Dir;
  limit?: number;
  offset?: number;
}

export interface StocksResponse {
  api_version: string;
  total: number;
  limit: number;
  offset: number;
  items: StockRow[];
  data_status: DataStatus;
}

export interface StockDetailResponse {
  api_version: string;
  stock: { ticker: string; name: string; sector_code: string; yahoo_symbol: string };
  metrics: {
    close: number;
    sma20: number | null;
    sma50: number | null;
    rsi14: number | null;
    atr14: number | null;
    ret_1d: number | null;
    ret_1w: number | null;
    ret_1m: number | null;
    median_turnover_20d_idr: number | null;
    rs_ratio: number | null;
    rs_momentum: number | null;
    quadrant: Quadrant | null;
    stock_score: number | null;
    margin_to_min_turnover: number | null;
  };
  series: { date: string; close: number; volume: number }[];
  last_pick: {
    week_end: string;
    rank: number;
    streak_weeks: number;
    entry_ref: number;
    stop: number;
    target: number;
    rationale: string;
  } | null;
}

export interface RotationMatrixParams {
  timeframe?: Timeframe;
  window?: Window;
  scope?: "sector" | "stock";
}

export interface RotationMatrixResponse {
  api_version: string;
  timeframe: Timeframe;
  from: string;
  to: string;
  cells: { from: Quadrant; to: Quadrant; count: number; refs: string[] }[];
  changes: { ref_id: string; name: string; from: Quadrant; to: Quadrant; as_of: string }[];
}

export interface HeatmapResponse {
  api_version: string;
  columns: string[];
  rows: {
    code: string;
    name_id: string;
    /** kunci = nilai di `columns` (mis. "1d", "1w", "1m", "3m"). */
    values: Record<string, number | null>;
  }[];
}

export interface SectorSeriesParams {
  from?: string;
  to?: string;
  timeframe?: Timeframe;
  weighting?: Weighting;
}

export interface SectorSeriesResponse {
  api_version: string;
  code: string;
  points: {
    date: string;
    index_close: number;
    bench_close: number;
    rs: number;
    turnover_idr: number | null;
  }[];
}

// ── §2b Analisa teknikal — `/ta/*` (docs/05 §2, rumus docs/03 §10) ────────────
// Frontend TIDAK menghitung apa pun di sini: win rate, median periode, event, dan
// `gain_since` semuanya datang jadi dari backend. Yang dirakit di UI hanya label.

/** Kunci `sort` yang diterima `/ta/summary` (docs/05 §2). */
export const TA_SORTS = [
  "win_rate",
  "median_periods",
  "events",
  "last_breakout",
  "gain_since_breakout",
  "ref_id",
] as const;
export type TaSort = (typeof TA_SORTS)[number];

export type TaScope = "sector" | "stock";

/** Hasil satu event: menang/kalah ±`target_pct`; `expired`/`open` bukan kekalahan (docs/05 §2). */
export type TaResult = "win" | "loss" | "expired" | "open";

export interface TaStats {
  n_events: number;
  win: number;
  loss: number;
  expired: number;
  open: number;
  /** `win / (win + loss)`; `null` = belum ada event yang selesai → UI menulis `—`, bukan `0%`. */
  win_rate: number | null;
  median_periods_win: number | null;
  median_periods_loss: number | null;
}

/** Statistik saat semua angka belum tersedia (`min_events`) — tetap `null`, bukan 0. */
export type TaStatsMaybe = { [K in keyof TaStats]: TaStats[K] | null };

/** Konteks event terbaru "sampai sekarang" (docs/03 §10.6): dihitung backend per permintaan. */
export interface TaBreakout {
  signal_date: string;
  entry_date: string;
  /** Harga **penyesuaian** (`adj_close`/indeks) — wajib berlabel "harga penyesuaian" di UI. */
  entry_price: number;
  entry_basis: string;
  periods_since: number;
  gain_since: number | null;
  result: TaResult;
  exit_date: string | null;
  exit_price: number | null;
  periods: number | null;
}

export interface TaSummaryItem extends TaStatsMaybe {
  ref_id: string;
  name: string;
  sector_code: string | null;
  close: number | null;
  ma: number | null;
  above_ma: boolean | null;
  last_breakout: TaBreakout | null;
}

/** Cakupan data (docs/05 §2: **wajib** ada) — DB dev masih universe parsial. */
export interface TaCoverage {
  refs_tested: number;
  refs_skipped_short_history: number;
  bars_from: string | null;
  bars_to: string | null;
  price_basis: string;
}

export interface TaSummaryParams extends CommonParams {
  scope?: TaScope;
  ma_period?: number;
  trend_filter?: boolean;
  q?: string;
  min_events?: number;
  sort?: TaSort;
  dir?: Dir;
  limit?: number;
  offset?: number;
}

export interface TaSummaryResponse {
  api_version: string;
  scope: TaScope;
  timeframe: Timeframe;
  ma_period: number;
  trend_filter: boolean;
  total: number;
  limit: number;
  offset: number;
  items: TaSummaryItem[];
  coverage: TaCoverage;
  data_status: DataStatus;
}

/** Satu baris tabel event (`events` di `/ta/{scope}/{ref_id}`). */
export interface TaEventRow {
  signal_date: string;
  entry_date: string;
  entry_price: number;
  result: TaResult;
  periods: number | null;
  exit_date: string | null;
  exit_price: number | null;
}

export interface TaDetailParams {
  timeframe?: Timeframe;
  weighting?: Weighting;
  ma_period?: number;
  trend_filter?: boolean;
  window?: Window;
  as_of?: string;
  events?: number;
}

export interface TaDetailResponse {
  api_version: string;
  scope: TaScope;
  ref_id: string;
  name: string;
  ma_period: number;
  trend_filter: boolean;
  price_basis: string;
  ma_series: { date: string; close: number; ma: number }[];
  /** **Selalu** dua varian (docs/05 §2) → perbandingan filter tidak butuh dua permintaan. */
  stats: { filter_on: TaStats; filter_off: TaStats };
  latest: TaBreakout | null;
  events: TaEventRow[];
  coverage: TaCoverage;
  data_status: DataStatus;
}

// ── §2c Grafik candle saham — `/series/stock/{ticker}` (docs/05 §2, docs/06 §6.5) ──
// Semua overlay (MA, Donchian, kanal, level plan, penanda event, volume) datang dari API.
// Frontend tidak menghitung satu pun indikator (docs/08 aturan 1).

/** Satu bar harian **harga penyesuaian** (`adj_close`; `open` sudah diskalakan, ADR-040). */
export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SeriesPoint {
  date: string;
  value: number;
}

/** Lapisan tambahan yang bisa dinyalakan user (`docs/06` §6.6/§6.7, `docs/05` §2 v2). */
export type Layer = "indicators" | "smc" | "elliott";

export interface StockSeriesParams extends CommonParams {
  /** Panjang jendela grafik (default `6m`). */
  window?: Window;
  /** Jumlah bar (default `config.chart.window_bars`, maks 400). */
  bars?: number;
  /** Lapisan tambahan: `indicators` (Ultimate RSI/VWAP/POC), `smc`, `elliott`; kosong = dasar saja. */
  layers?: readonly Layer[];
  /** Jumlah event (default `config.chart.events`, maks 100). */
  events?: number;
  /** Periode MA (default `config.ta.ma_periods`). */
  ma?: readonly number[];
}

export interface StockSeriesEvent {
  signal_date: string;
  entry_date: string;
  entry_price: number;
  result: TaResult;
  periods: number | null;
  mfe_pct: number | null;
  mae_pct: number | null;
}

/** Kanal S/R pivot (`strength` = jumlah pivot yang dikelompokkan, docs/03 §6.4.9). */
export interface SrChannel {
  low: number;
  high: number;
  strength: number;
  kind: string;
  from: string | null;
  to: string | null;
}

export interface StockSeriesResponse {
  api_version: string;
  ticker: string;
  name: string;
  price_basis: string;
  /** `tren_naik|range|turun|tipis` — menentukan overlay yang digambar (docs/03 §6.4.0). */
  regime: string;
  active_tools: string[];
  regime_reason: string;
  candles: Candle[];
  overlays: {
    /** Berkunci periode sebagai **string**; nilai `null` (warmup) sudah dibuang backend. */
    ma: Record<string, SeriesPoint[]>;
    donchian: { fast: { high: SeriesPoint[]; low: SeriesPoint[] }; slow: { high: SeriesPoint[]; low: SeriesPoint[] } };
    /** Selalu dikirim; UI hanya menggambar saat rezim `range|tipis` (docs/06 §6.5). */
    channels: SrChannel[];
    volume_ma: SeriesPoint[];
  };
  /** Level plan pick terakhir; `null` = belum ada pick → garis level disembunyikan, bukan error. */
  levels: {
    week_end: string;
    entry_zone: { low: number; high: number };
    stop: number;
    tp1: number;
    tp2: number;
    rr_tp2: number | null;
    plan_ok: boolean;
  } | null;
  events: StockSeriesEvent[];
  volume_confirm_mult: number;
  /** Lapisan yang benar-benar dikirim backend (v2: `indicators`, `smc`, `elliott`). */
  layers: Layer[];
  indicators?: StockIndicators;
  smc?: SmcLayers;
  elliott?: ElliottLayers;
  data_status: DataStatus;
}

/** Lapisan `indicators` (docs/03 §11.1–§11.3) — dipakai F21. */
export interface StockIndicators {
  ursi?: { len: number; method: string; ob: number; os: number; points: { date: string; value: number; signal: number }[] };
  vwap?: {
    len: number;
    anchor: string;
    anchor_date: string | null;
    points: { date: string; vwap: number; upper1: number; lower1: number; upper2: number; lower2: number }[];
  };
  poc?: { basis: string; bars_used: number; bins: number; poc: number; value_area: { low: number; high: number } };
}

/** Lapisan `smc` (docs/03 §11.4) — dipakai F22. */
export interface SmcLayers {
  bos: { date: string; direction: string; level: number }[];
  choch: { date: string; direction: string; level: number }[];
  order_blocks: { kind: string; from: string; to: string; low: number; high: number; mitigated: boolean }[];
  fvg: { kind: string; date: string; low: number; high: number; mitigated: boolean }[];
  equal_levels: { kind: string; level: number; count: number }[];
  range: { low: number; high: number; premium_from: number; discount_to: number } | null;
}

/** Lapisan `elliott` (docs/03 §11.5) — dipakai F22; `invalidated` → UI menggambar garis putus. */
export interface ElliottLayers {
  status: string;
  invalidated: boolean;
  zigzag: { date: string; price: number; kind: string }[];
  waves: { label: string; from: string; to: string; price_from: number; price_to: number }[];
  fib_zones: { ratio: number; level: number }[];
  note: string;
}

// ── §2d Analisa lengkap satu saham — `/plan/stock/{ticker}` (docs/05 §2, docs/06 §5.3) ──

/** Skenario historis: frekuensi "kena dulu" dari event masa lalu (`scenario` `null` = sampel kecil). */
export interface PlanScenario {
  p_tp1_first: number | null;
  p_sl_first: number | null;
  p_timeout: number | null;
  p_tp2_first: number | null;
  median_periods_tp1: number | null;
  median_periods_sl: number | null;
  n_events: number;
  /** Event yang masih berjalan — dikeluarkan dari hitungan peluang (ditampilkan terpisah). */
  n_open_dikeluarkan: number;
  basis: string;
}

/** Satu baris daftar level (`levels_table`, urutan tetap dari backend). */
export interface LevelRow {
  label: string;
  level?: number | null;
  low?: number | null;
  high?: number | null;
}

export interface StockPlanCoverage {
  bars_available: number;
  bars_from: string | null;
  bars_to: string | null;
  n_events: number;
  price_basis: string;
}

/** `GET /plan/stock/{ticker}` — satu sumber untuk panel analisa di halaman detail. */
export interface StockPlanResponse {
  api_version: string;
  as_of: string;
  stock: { ticker: string; name: string; sector_code: string | null; board: string | null };
  price: { close: number | null; prev_close: number | null; ret_1d: number | null; price_basis: string };
  regime: { code: string; label: string; reason: string; active_tools: string[] };
  summary_lines: string[];
  /** `null` = tidak ada rencana beli / riwayat kurang (bukan error). */
  plan: WeeklyPlan | null;
  scenario: PlanScenario | null;
  levels_table: LevelRow[];
  coverage: StockPlanCoverage;
  data_status: DataStatus;
}

export interface StockPlanParams {
  as_of?: string;
}

// ── §3 Weekly picks & briefing ───────────────────────────────────────────────

export interface WeeklySectorPick {
  ref_id: string;
  name: string;
  rank: number;
  score: number | null;
  streak_weeks: number;
  rule_hits: {
    quadrant: Quadrant;
    age_ok: boolean;
    momentum_ok: boolean;
    ret_4w_ok: boolean;
    constituents_ok: boolean;
  };
  rationale: string;
}

/** Rezim pasar untuk plan (`docs/03` §6.4.0, skill `idx-ta-trading-plan`): alat dipilih per rezim. */
export type TaRegime = "tren_naik" | "range" | "turun" | "tipis";
export type PlanEntryTool = "pullback_ma20" | "breakout_donchian" | "sr_channel" | "pivot_level" | "none";
export type PlanConfirmTool = "volume" | "rsi_tepi_range" | "none";

/** Satu level plan (`stop`/`tp1`/`tp2`): angka apa adanya dari API — frontend tidak menghitung. */
export interface PlanLevel {
  level: number | null;
  /** Perubahan dari zona entry (rasio, mis. `-0.0285`); `null` saat `no_trade`. */
  pct: number | null;
  /** Imbal hasil terhadap risiko **bersih biaya** (`docs/05` §3) — jangan dihitung ulang. */
  rr?: number | null;
  basis: string | null;
  reason: string;
}

export interface PlanHold {
  median_periods: number | null;
  n_events: number | null;
  win_rate: number | null;
  /** Peluang historis kena TP1/TP2; `null` = riwayat kurang (`docs/05` §3). */
  hit_tp1: number | null;
  hit_tp2: number | null;
  reason: string;
}

/** `plan` pada pick mingguan (`docs/05` §3, `api_version` 1.2) — sumber kebenaran plan. */
export interface WeeklyPlan {
  regime: TaRegime;
  entry_tool: PlanEntryTool;
  confirm_tool: PlanConfirmTool;
  entry_mode: "pullback" | "breakout" | "wait_pullback" | "no_trade" | string;
  entry_zone: { low: number | null; high: number | null; reason: string };
  stop: PlanLevel;
  tp1: PlanLevel;
  tp2: PlanLevel;
  hold: PlanHold;
  invalidation: string | null;
  plan_ok: boolean;
  notes: string[];
  /** Alasan alat/konfirmasi: belum ada di contoh `docs/05` §3 → opsional (lihat DECISIONS). */
  entry_tool_reason?: string | null;
  confirm_reason?: string | null;
}

export interface WeeklyStockPick {
  ticker: string;
  name: string;
  sector_code: string;
  rank: number;
  score: number | null;
  streak_weeks: number;
  entry_ref: number;
  stop: number;
  target: number;
  atr14: number | null;
  lots_hint: number | null;
  rule_hits: {
    liquidity_ok: boolean;
    price_ok: boolean;
    trend_ok: boolean;
    rs_ok: boolean;
    momentum_ok: boolean;
    rsi_ok: boolean;
    no_suspension: boolean;
  };
  rationale: string;
  /** `null` = plan pekan ini belum tersedia untuk ticker ini (bukan error, `docs/06` §5.2). */
  plan?: WeeklyPlan | null;
}

export interface WeeklyPicksParams {
  week_end?: string;
  scope?: "sector" | "stock" | "sector,stock";
  sector?: string[];
  min_streak?: number;
  limit?: number;
}

export interface WeeklyPicksResponse {
  api_version: string;
  week_end: string;
  /** API 1.1 (`docs/05` §3): Senin pekan itu + label Bahasa Indonesia dari backend. */
  week_start?: string | null;
  week_label?: string | null;
  is_final: boolean;
  sectors: WeeklySectorPick[];
  stocks: WeeklyStockPick[];
}

export interface BriefingParams {
  as_of?: string;
  include_series?: boolean;
  top_n?: number;
}

/** Satu item "Perlu dipantau" (`docs/05` §3) — sektor (`name`) atau saham (`ref_id` = ticker). */
export interface WatchItem {
  kind: "sector" | "stock";
  ref_id: string;
  name: string;
  quadrant: Quadrant | null;
  streak_weeks: number;
  reason: string;
}

export interface BriefingResponse {
  api_version: string;
  generated_at: string;
  data_status: DataStatus;
  /** 3–6 kalimat ringkas dari backend (`docs/05` §3); `[]` = belum ada hasil hitung. */
  summary_lines: string[];
  /** Maks 3 item; `[]` → blok "Perlu dipantau" disembunyikan. */
  watchlist: WatchItem[];
  market: {
    ihsg_close: number;
    ihsg_ret_1d: number | null;
    ihsg_ret_1w: number | null;
    sectors_up: number;
    sectors_down: number;
    breadth: { advancers: number; decliners: number; unchanged: number };
    regime: string;
    regime_note: string;
  };
  leaders: {
    code: string;
    name_id: string;
    quadrant: Quadrant;
    score: number | null;
    ret_1w: number | null;
    streak_weeks: number;
  }[];
  laggards: BriefingResponse["leaders"];
  changes: { ref_id: string; name: string; from: Quadrant; to: Quadrant; as_of: string }[];
  weekly_focus: {
    week_end: string;
    sectors: { code: string; streak_weeks: number; rationale: string }[];
    stocks: {
      ticker: string;
      entry_ref: number;
      stop: number;
      target: number;
      streak_weeks: number;
      rationale: string;
    }[];
  };
  midday: {
    available: boolean;
    as_of: string;
    gate: "ok" | "stale";
    moves: {
      code: string;
      ret_intraday: number | null;
      direction: string;
      projected_quadrant: Quadrant;
    }[];
  };
  watch: { level: string; message: string }[];
  notes_for_report: string;
}

// ── §4 Admin / jobs — dipicu halaman Data (docs/08 F12) ──────────────────────

export type RunStatus = "queued" | "running" | "ok" | "partial" | "failed" | "skipped";

/** Status akhir: polling wajib berhenti di sini (docs/05 §5.1). */
export const RUN_FINAL: readonly RunStatus[] = ["ok", "partial", "failed", "skipped"];

export interface IngestRun {
  run_id: number;
  kind: string;
  status: RunStatus;
  started_at: string | null;
  finished_at: string | null;
  phase: string | null;
  rows: number | null;
  rows_total: number | null;
  /** null = rows_total belum diketahui → UI pakai spinner + message (docs/05 §4.3). */
  percent: number | null;
  message: string | null;
  failed_tickers: string[];
  params_json?: unknown;
  result_json?: unknown;
}

export interface RunsResponse {
  api_version: string;
  runs: IngestRun[];
}

export interface RunResponse {
  api_version: string;
  run: IngestRun;
}

export interface StartRunResponse {
  run_id: number;
  status: RunStatus;
}

export interface ImportResult {
  import_id: number;
  inserted: number;
  updated: number;
  deactivated: number;
  errors: { sheet: string; row_no: number; raw_value: string; reason: string }[];
}

/** `result_json` per kind — bentuk baku `docs/05` §4.6. */
export interface PricesResult {
  rows: number;
  batches: number;
  failed_tickers: string[];
}

export interface ComputeAllResult {
  timeframe: Timeframe;
  sectors: number;
  tickers: number;
  duration_s: number;
}

export interface ComputeSignalsResult {
  week_end: string;
  sectors: number;
  stocks: number;
}

export interface IngestPricesBody {
  mode: "daily" | "intraday";
  from?: string | null;
  to?: string | null;
  sectors?: string[] | null;
  tickers?: string[] | null;
}

export interface ComputeBody {
  stage: "index" | "rrg" | "signals" | "all" | "ta";
  timeframe?: Timeframe;
  as_of?: string | null;
}

/** `result_json` `compute_ta` (docs/05 §4.6) — ditampilkan di panel riwayat run. */
export interface ComputeTaResult {
  events: number;
  refs: number;
  ma_periods: number[];
  variants: string[];
  win_rate: number | null;
  duration_s: number;
}

export interface MiddayResult {
  gate: "ok" | "stale";
  last_bar_at: string | null;
  computed: boolean;
}

// ── Transport ───────────────────────────────────────────────────────────────

/** Semua endpoint web app hidup di bawah prefiks ini (diproxikan Vite → :8000). */
export const API_BASE = "/api/v1";

export type QueryValue = string | number | boolean | readonly string[] | null | undefined;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Array dikirim koma-separated (bentuk di docs/05 §5: `quadrant=leading,improving`). */
export function toSearchParams(params: Record<string, QueryValue>): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length > 0) sp.set(key, value.join(","));
      continue;
    }
    sp.set(key, String(value));
  }
  return sp;
}

function querySuffix(params?: object): string {
  const sp = toSearchParams((params ?? {}) as Record<string, QueryValue>);
  // dev: knob `?mock=...` di URL halaman diteruskan ke API supaya skenario MSW
  // (stale / notfriday / empty) bisa dicoba langsung dari browser, bukan hanya lewat console.
  if (import.meta.env.DEV) {
    const mock = new URLSearchParams(window.location.search).get("mock");
    if (mock && !sp.has("mock")) sp.set("mock", mock);
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export async function apiGet<T, P extends object>(
  path: string,
  params?: P,
  signal?: AbortSignal,
): Promise<T> {
  return send<T>(`${path}${querySuffix(params)}`, { signal });
}

export function apiPost<T, B extends object>(
  path: string,
  body?: B,
  params?: Record<string, QueryValue>,
  signal?: AbortSignal,
): Promise<T> {
  return send<T>(`${path}${querySuffix(params)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
}

/** Import Excel: multipart, satu field bernama `file` (docs/05 §4). */
export function apiUpload<T>(
  path: string,
  file: File,
  params?: Record<string, QueryValue>,
): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  return send<T>(`${path}${querySuffix(params)}`, { method: "POST", body: form });
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  const apiKey = localStorage.getItem(API_KEY_STORAGE); // docs/05 §4.5: diisi manual user, bukan VITE_*
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...(apiKey ? { "X-API-Key": apiKey } : {}), ...init.headers },
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as ApiErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      error?.code ?? "unknown",
      error?.message ?? `Permintaan gagal (HTTP ${res.status})`,
      error?.detail,
    );
  }
  return body as T;
}

export const API_KEY_STORAGE = "rotation_api_key";
