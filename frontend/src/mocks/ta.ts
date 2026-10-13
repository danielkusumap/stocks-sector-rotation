import { HttpResponse, http } from "msw";
import type {
  DataStatus,
  TaBreakout,
  TaCoverage,
  TaDetailResponse,
  TaStats,
  TaStatsMaybe,
  TaSummaryItem,
  TaSummaryResponse,
} from "../lib/api";
import taJson from "./fixtures/ta.json";
import sectorsJson from "./fixtures/sectors.json";
import stocksJson from "./fixtures/stocks.json";

/**
 * Mock `/ta/*` (docs/05 §2, dipakai `docs/08` F17). Mock berperan sebagai backend:
 * angka apa adanya dari `fixtures/ta.json` (dibuat sekali oleh scratch/generate-ta-fixture.py) —
 * frontend tidak menghitung apa pun, dan `/ta/summary` + `/ta/{scope}/{ref_id}` membaca
 * **sumber yang sama** sehingga angka kolom tabel selalu sama dengan angka panel.
 *
 */

const API = "/api/v1";
const AS_OF = "2026-10-12";
const PREV_AS_OF = "2026-10-02";
const LAST_DATA = "2026-10-12T16:10:00+07:00";
const COMPUTED = "2026-10-12T16:31:02+07:00";

type Fixture = typeof taJson;
const FIXTURE = taJson as Fixture;

interface TaRun {
  stats: TaStats;
  latest: TaBreakout | null;
  events: TaBreakout[];
}

const NULL_STATS: TaStatsMaybe = {
  n_events: null,
  win: null,
  loss: null,
  expired: null,
  open: null,
  win_rate: null,
  median_periods_win: null,
  median_periods_loss: null,
};

interface UniverseRef {
  ref_id: string;
  name: string;
  sector_code: string | null;
}

/** Universe tabel: `scope=sector` → 11 sektor fixture, `scope=stock` → daftar emiten fixture. */
function universe(scope: string): UniverseRef[] {
  if (scope === "stock") {
    return stocksJson.map((s) => ({ ref_id: s.ticker, name: s.name, sector_code: s.sector_code }));
  }
  return sectorsJson.map((s) => ({ ref_id: s.code, name: s.name_id, sector_code: null }));
}

function runOf(refId: string, maPeriod: number, trendFilter: boolean): TaRun | null {
  const ref = FIXTURE.refs[refId as keyof Fixture["refs"]] as { runs: Record<string, TaRun> } | undefined;
  return ref?.runs[`${maPeriod}|${trendFilter ? "on" : "off"}`] ?? null;
}

function itemOf(ref: UniverseRef, maPeriod: number, trendFilter: boolean): TaSummaryItem {
  const source = FIXTURE.refs[ref.ref_id as keyof Fixture["refs"]] as
    | { close: number | null; ma: Record<string, number> }
    | undefined;
  const run = runOf(ref.ref_id, maPeriod, trendFilter);
  const close = source?.close ?? null;
  const ma = source?.ma?.[String(maPeriod)] ?? null;
  return {
    ref_id: ref.ref_id,
    name: ref.name,
    sector_code: ref.sector_code,
    close,
    ma,
    above_ma: close === null || ma === null ? null : close > ma,
    ...(run ? run.stats : NULL_STATS),
    last_breakout: run?.latest ?? null,
  };
}

function sortValue(item: TaSummaryItem, sort: string): number | string | null {
  if (sort === "ref_id") return item.ref_id;
  if (sort === "events") return item.n_events;
  if (sort === "median_periods") return item.median_periods_win;
  if (sort === "last_breakout") return item.last_breakout?.signal_date ?? null;
  if (sort === "gain_since_breakout") return item.last_breakout?.gain_since ?? null;
  return item.win_rate;
}

/** Urut seperti backend: `null` di belakang, arah `dir` (docs/05 §2). */
function sortItems(items: TaSummaryItem[], sort: string, dir: string): TaSummaryItem[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const va = sortValue(a, sort);
    const vb = sortValue(b, sort);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === "string" || typeof vb === "string") return sign * String(va).localeCompare(String(vb));
    return sign * (va - vb);
  });
}

function coverage(scope: string): TaCoverage {
  const key = scope === "stock" ? "stock" : "sector";
  return FIXTURE.coverage[key];
}

function dataStatus(): DataStatus {
  return {
    as_of: AS_OF,
    timeframe: "d1",
    status: "ok",
    last_data_at: LAST_DATA,
    computed_at: COMPUTED,
    range_from: PREV_AS_OF,
    range_to: AS_OF,
    range_label: "3–9 Okt 2026",
    window_range_label: null,
    partial_sectors: [],
  };
}

function summaryHandler(request: Request) {
  const sp = new URL(request.url).searchParams;
  const scope = sp.get("scope") === "stock" ? "stock" : "sector";
  const maPeriod = Number(sp.get("ma_period") ?? 20) || 20;
  const trendFilter = (sp.get("trend_filter") ?? "true") !== "false";
  const minEvents = Number(sp.get("min_events") ?? 0) || 0;
  const limit = Math.max(1, Math.min(500, Number(sp.get("limit") ?? 50) || 50));
  const offset = Math.max(0, Number(sp.get("offset") ?? 0) || 0);
  const wanted = (sp.get("sector") ?? "").split(",").filter(Boolean);
  const q = (sp.get("q") ?? "").trim().toLowerCase();

  let items = universe(scope).map((ref) => itemOf(ref, maPeriod, trendFilter));
  if (wanted.length > 0) items = items.filter((i) => i.sector_code !== null && wanted.includes(i.sector_code));
  if (q) items = items.filter((i) => i.ref_id.toLowerCase().includes(q) || i.name.toLowerCase().includes(q));
  // `min_events`: baris tetap tampil tapi angkanya `null` (docs/05 §2)
  if (minEvents > 0) items = items.map((i) => ((i.n_events ?? 0) < minEvents ? { ...i, ...NULL_STATS } : i));
  items = sortItems(items, sp.get("sort") ?? "win_rate", sp.get("dir") ?? "desc");

  const body: TaSummaryResponse = {
    api_version: "1.0",
    scope,
    timeframe: "d1",
    ma_period: maPeriod,
    trend_filter: trendFilter,
    total: items.length,
    limit,
    offset,
    items: items.slice(offset, offset + limit),
    coverage: coverage(scope),
    data_status: dataStatus(),
  };
  return HttpResponse.json(body);
}

function detailHandler(scope: string, refId: string, request: Request) {
  const sp = new URL(request.url).searchParams;
  const maPeriod = Number(sp.get("ma_period") ?? 20) || 20;
  const trendFilter = (sp.get("trend_filter") ?? "true") !== "false";
  const events = Math.max(1, Math.min(200, Number(sp.get("events") ?? 20) || 20));
  const ref = universe(scope).find((r) => r.ref_id === refId);
  if (!ref) {
    return HttpResponse.json(
      { api_version: "1.0", error: { code: "not_found", message: `${scope} ${refId} tidak ada`, detail: null } },
      { status: 404 },
    );
  }

  const on = runOf(refId, maPeriod, true);
  const off = runOf(refId, maPeriod, false);
  const chosen = trendFilter ? on : off;
  const body: TaDetailResponse = {
    api_version: "1.0",
    scope: scope === "stock" ? "stock" : "sector",
    ref_id: refId,
    name: ref.name,
    ma_period: maPeriod,
    trend_filter: trendFilter,
    price_basis: "adj_close",
    // grafik harga + garis MA = opsional v1 (docs/06 §5.1) → seri tidak dibuat di mock
    ma_series: [],
    stats: {
      filter_on: on?.stats ?? (NULL_STATS as unknown as TaStats),
      filter_off: off?.stats ?? (NULL_STATS as unknown as TaStats),
    },
    latest: chosen?.latest ?? null,
    events: (chosen?.events ?? []).slice(0, events),
    coverage: coverage(scope === "stock" ? "stock" : "sector"),
    data_status: dataStatus(),
  };
  return HttpResponse.json(body);
}

export const taHandlers = [
  // `/ta/summary` didaftarkan lebih dulu supaya tidak tertangkap `:scope/:ref_id`
  http.get(`${API}/ta/summary`, ({ request }) => summaryHandler(request)),
  http.get(`${API}/ta/:scope/:ref_id`, ({ request, params }) =>
    detailHandler(String(params.scope), String(params.ref_id), request),
  ),
];
