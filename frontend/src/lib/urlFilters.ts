import {
  QUADRANTS,
  SECTOR_SORTS,
  STOCK_SORTS,
  TIMEFRAMES,
  WEIGHTINGS,
  WINDOWS,
  toSearchParams,
  type Dir,
  type Quadrant,
  type QueryValue,
  type SectorSort,
  type StockSort,
  type Timeframe,
  type Weighting,
  type Window,
} from "./api";

/**
 * Satu-satunya sumber kebenaran filter: URL query (docs/08 aturan 4, docs/06 §7).
 * Nilai default tidak ditulis ke URL supaya URL pendek & shareable.
 */
export interface FilterState {
  timeframe: Timeframe;
  window: Window;
  weighting: Weighting;
  as_of: string | null;
  sector: string[];
  quadrant: Quadrant[];
  min_streak: number;
  min_turnover_idr: number | null;
  min_price_idr: number | null;
  ret_positive_only: boolean;
  sort: SectorSort | StockSort;
  dir: Dir;
  q: string;
  limit: number;
  offset: number;
  /** Lapisan grafik apa adanya dari URL (`docs/06` §6.6); `null` = parameter tak ada = default. */
  layers: string | null;
}

export const DEFAULT_FILTERS: FilterState = {
  timeframe: "d1",
  window: "3m",
  weighting: "equal",
  as_of: null,
  sector: [],
  quadrant: [],
  min_streak: 0,
  min_turnover_idr: null,
  min_price_idr: null,
  ret_positive_only: false,
  sort: "score",
  dir: "desc",
  q: "",
  limit: 50,
  offset: 0,
  layers: null,
};

const SORTS: readonly string[] = [...SECTOR_SORTS, ...STOCK_SORTS];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function oneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function intIn(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), min), max) : fallback;
}

function optionalPositive(raw: string | null, fallback: number | null): number | null {
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function list(raw: string | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function readFilters(
  search: URLSearchParams | string,
  defaults: FilterState = DEFAULT_FILTERS,
): FilterState {
  const p = typeof search === "string" ? new URLSearchParams(search) : search;
  const q = (p.get("q") ?? "").trim();
  const asOf = p.get("as_of");
  return {
    timeframe: oneOf(p.get("timeframe"), TIMEFRAMES, defaults.timeframe),
    window: oneOf(p.get("window"), WINDOWS, defaults.window),
    weighting: oneOf(p.get("weighting"), WEIGHTINGS, defaults.weighting),
    as_of: asOf && DATE_RE.test(asOf) ? asOf : defaults.as_of,
    sector: list(p.get("sector")),
    quadrant: list(p.get("quadrant")).filter((v): v is Quadrant =>
      (QUADRANTS as readonly string[]).includes(v),
    ),
    min_streak: intIn(p.get("min_streak"), defaults.min_streak, 0, 8),
    min_turnover_idr: optionalPositive(p.get("min_turnover_idr"), defaults.min_turnover_idr),
    min_price_idr: optionalPositive(p.get("min_price_idr"), defaults.min_price_idr),
    ret_positive_only: p.get("ret_positive_only") === "1" || p.get("ret_positive_only") === "true",
    sort: oneOf<SectorSort | StockSort>(p.get("sort"), SORTS as (SectorSort | StockSort)[], defaults.sort),
    dir: oneOf(p.get("dir"), ["asc", "desc"] as const, defaults.dir),
    q,
    limit: intIn(p.get("limit"), defaults.limit, 1, 500),
    offset: intIn(p.get("offset"), defaults.offset, 0, 1_000_000),
    // apa adanya (termasuk ""): `layers=` berarti "tanpa lapisan", `null` berarti default backend
    layers: p.get("layers"),
  };
}

/** Urutan kunci tetap supaya URL stabil dan enak dibaca; nilai default dibuang. */
export function toSearch(
  filters: FilterState,
  defaults: FilterState = DEFAULT_FILTERS,
): URLSearchParams {
  const params: Record<string, QueryValue> = {};
  if (filters.timeframe !== defaults.timeframe) params.timeframe = filters.timeframe;
  if (filters.window !== defaults.window) params.window = filters.window;
  if (filters.weighting !== defaults.weighting) params.weighting = filters.weighting;
  if (filters.as_of !== defaults.as_of) params.as_of = filters.as_of;
  if (filters.sector.length > 0) params.sector = filters.sector;
  if (filters.quadrant.length > 0) params.quadrant = filters.quadrant;
  if (filters.min_streak !== defaults.min_streak) params.min_streak = filters.min_streak;
  if (filters.min_turnover_idr !== defaults.min_turnover_idr) {
    params.min_turnover_idr = filters.min_turnover_idr;
  }
  if (filters.min_price_idr !== defaults.min_price_idr) params.min_price_idr = filters.min_price_idr;
  if (filters.ret_positive_only) params.ret_positive_only = 1;
  if (filters.sort !== defaults.sort) params.sort = filters.sort;
  if (filters.dir !== defaults.dir) params.dir = filters.dir;
  if (filters.q !== defaults.q) params.q = filters.q;
  if (filters.limit !== defaults.limit) params.limit = filters.limit;
  if (filters.offset !== defaults.offset) params.offset = filters.offset;
  if (filters.layers !== defaults.layers) params.layers = filters.layers;
  return toSearchParams(params);
}
