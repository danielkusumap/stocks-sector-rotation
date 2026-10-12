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
  last_ingest: {
    prices_daily: string | null;
    intraday: string | null;
    signals_weekly: string | null;
  };
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
  is_final: boolean;
  sectors: WeeklySectorPick[];
  stocks: WeeklyStockPick[];
}

export interface BriefingParams {
  as_of?: string;
  include_series?: boolean;
  top_n?: number;
}

export interface BriefingResponse {
  api_version: string;
  generated_at: string;
  data_status: DataStatus;
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
  stage: "index" | "rrg" | "signals" | "all";
  timeframe?: Timeframe;
  as_of?: string | null;
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
  const qs = toSearchParams((params ?? {}) as Record<string, QueryValue>).toString();
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
