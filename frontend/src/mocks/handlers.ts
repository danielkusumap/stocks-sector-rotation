import { HttpResponse, http } from "msw";
import type {
  BriefingResponse,
  DataStatus,
  FreshnessResponse,
  HeatmapResponse,
  MetaConfigResponse,
  MetaSectorsResponse,
  Quadrant,
  RrgItem,
  RrgResponse,
  RrgTailPoint,
  RotationMatrixResponse,
  SectorDetailResponse,
  SectorSeriesResponse,
  SectorSummaryItem,
  SectorSummaryResponse,
  StockDetailResponse,
  StockRow,
  StocksResponse,
  Timeframe,
  WeeklyPicksResponse,
} from "../lib/api";
import sectorsJson from "./fixtures/sectors.json";
import stocksJson from "./fixtures/stocks.json";
import weeklyJson from "./fixtures/weekly.json";
import { adminHandlers } from "./admin";

/**
 * Mock server (MSW) — dibangun dari bentuk JSON di docs/05 apa adanya, supaya UI
 * bisa dikerjakan sebelum backend siap. Handler hanya meniru pekerjaan server
 * (filter/sort/paginasi SQL). Tidak ada rumus finansial di sini: angka kuadran,
 * RS, skor, streak semuanya sudah ada di fixture.
 *
 * Knob dev: `?mock=ok` memaksa data_status `ok`; `?mock=stale` memaksa gate midday
 * `stale` (dipakai halaman Status untuk melihat dua skenario).
 *
 * Backend nyata: jalankan dev tanpa mock dengan `VITE_MOCKS=off npm run dev`.
 */

type SectorRow = SectorSummaryItem & {
  name_en: string;
  color_token: string;
  color_hex_dark: string;
  sort_order: number;
  constituents_active: number;
  /** hanya di fixture: dipakai kolom `1d` heatmap & rekap briefing, tidak ada di docs/05 §2 */
  ret_1d: number | null;
  tail: RrgTailPoint[];
};

const sectors = sectorsJson as unknown as SectorRow[];
const stocks = stocksJson as unknown as StockRow[];
const weekly = weeklyJson as unknown as WeeklyPicksResponse;

const API = "/api/v1";
const AS_OF = "2026-10-12";
const PREV_AS_OF = "2026-10-02";
const LAST_DATA = "2026-10-12T16:10:00+07:00";
const COMPUTED = "2026-10-12T16:31:02+07:00";

const list = (sp: URLSearchParams, key: string) =>
  (sp.get(key) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const num = (sp: URLSearchParams, key: string, fallback = 0) => {
  const raw = sp.get(key);
  const value = Number(raw);
  return raw === null || raw === "" || !Number.isFinite(value) ? fallback : value;
};

function dataStatus(sp: URLSearchParams, kind: "sector" | "stock" = "sector"): DataStatus {
  const forceOk = sp.get("mock") === "ok";
  return {
    as_of: sp.get("as_of") ?? (kind === "sector" ? AS_OF : AS_OF),
    timeframe: (sp.get("timeframe") ?? "d1") as Timeframe,
    status: forceOk ? "ok" : "partial",
    last_data_at: LAST_DATA,
    computed_at: COMPUTED,
    partial_sectors: forceOk ? [] : sectors.filter((s) => s.partial).map((s) => s.code),
  };
}

const transition = (row: { quadrant: Quadrant; quadrant_prev: Quadrant | null }) =>
  row.quadrant_prev ? `${row.quadrant_prev}→${row.quadrant}` : null;

const SORT_FIELD: Record<string, keyof SectorRow> = {
  score: "score",
  rs_ratio: "rs_ratio",
  rs_momentum: "rs_momentum",
  ret_1w: "ret_1w",
  ret_1m: "ret_1m",
  turnover: "median_turnover_20d_idr",
  rank_score: "rank_score",
};
const STOCK_SORT_FIELD: Record<string, keyof StockRow> = {
  stock_score: "stock_score",
  rs_ratio: "rs_ratio",
  ret_1d: "ret_1d",
  ret_1w: "ret_1w",
  turnover: "median_turnover_20d_idr",
  ticker: "ticker",
};

/** `ret_positive_only` → kolom return jendela aktif (docs/05 §2). `1y` tidak punya kolom → diabaikan. */
const WINDOW_RET_FIELD: Record<string, keyof SectorSummaryItem> = {
  "1w": "ret_1w",
  "1m": "ret_1m",
  "3m": "ret_3m",
  "6m": "ret_6m",
  ytd: "ret_ytd",
};

function sortRows<T>(rows: T[], field: keyof T, dir: string): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[field];
    const y = b[field];
    if (typeof x === "string" || typeof y === "string") {
      return sign * String(x).localeCompare(String(y));
    }
    // nilai null selalu di bawah, apa pun arahnya
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return sign * (Number(x) - Number(y));
  });
}

/** Deret tiruan untuk grafik (bukan hasil hitung: nilai sintetis, jelas-jelas mock). */
function datesBack(count: number): string[] {
  const end = new Date(`${AS_OF}T00:00:00Z`).getTime();
  return Array.from({ length: count }, (_, i) =>
    new Date(end - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

function sectorSeries(row: SectorRow, count: number) {
  const end = 100 + (row.rs_ratio - 100) * 3;
  const dates = datesBack(count);
  return dates.map((date, i) => {
    const t = i / (count - 1);
    return {
      date,
      index_close: Math.round((100 + (end - 100) * t * t) * 100) / 100,
      bench_close: Math.round(5936.15 * (1 - 0.02 * (1 - t)) * 100) / 100,
      rs: row.rs_ratio,
      turnover_idr: Math.round((row.turnover_idr ?? 0) * (0.8 + 0.4 * t)),
    };
  });
}

function stockSeries(row: StockRow, count: number) {
  const dates = datesBack(count);
  return dates.map((date, i) => {
    const t = i / (count - 1);
    return {
      date,
      close: Math.round(row.close * (0.93 + 0.07 * t * t)),
      volume: Math.round(((row.median_turnover_20d_idr ?? 0) / row.close) * (0.7 + 0.6 * t)),
    };
  });
}

function tailFor(rs: number, mom: number): RrgTailPoint[] {
  return [
    { as_of: "2026-09-25", rs_ratio: Math.round((100 + (rs - 100) * 0.35) * 100) / 100, rs_momentum: Math.round((100 + (mom - 100) * 0.45) * 100) / 100 },
    { as_of: PREV_AS_OF, rs_ratio: Math.round((100 + (rs - 100) * 0.78) * 100) / 100, rs_momentum: Math.round((100 + (mom - 100) * 0.8) * 100) / 100 },
    { as_of: "2026-10-09", rs_ratio: rs, rs_momentum: mom },
  ];
}

const notFound = (code: string, message: string) =>
  HttpResponse.json(
    { api_version: "1.0", error: { code, message, detail: null } },
    { status: 404 },
  );

/**
 * Mock: satu sektor bisa punya 60+ saham (AC F4 #6), sedangkan fixture hanya 30 saham
 * total. Titik tambahan ini sintetis (`FIX***`) — kuadran hanya ditempel dari daftar,
 * bukan dihitung dari RS.
 */
const QUADRANT_RANGE: Record<Quadrant, [number, number, number, number]> = {
  leading: [100.4, 101.8, 100.2, 101.6],
  improving: [98.2, 99.8, 100.2, 101.4],
  weakening: [100.3, 101.9, 98.2, 99.8],
  lagging: [97.8, 99.9, 97.6, 99.9],
};
const QUADRANT_CYCLE: Quadrant[] = ["leading", "improving", "weakening", "lagging"];

function padStockItems(items: RrgItem[], sectorCode: string | null, upto = 60): RrgItem[] {
  if (sectorCode === null || items.length >= upto) return items;
  const color = sectors.find((s) => s.code === sectorCode)?.color_hex ?? "#888888";
  const padded = [...items];
  for (let i = padded.length; i < upto; i += 1) {
    const quadrant = QUADRANT_CYCLE[i % QUADRANT_CYCLE.length];
    const [rsMin, rsMax, momMin, momMax] = QUADRANT_RANGE[quadrant];
    const rs = Math.round((rsMin + ((rsMax - rsMin) * (i % 7)) / 6) * 100) / 100;
    const mom = Math.round((momMin + ((momMax - momMin) * ((i * 3) % 7)) / 6) * 100) / 100;
    padded.push({
      ref_id: `FIX${String(i).padStart(3, "0")}`,
      name: `Emiten Uji ${i}`,
      color_hex: color,
      rs_ratio: rs,
      rs_momentum: mom,
      quadrant,
      quadrant_prev: null,
      transition: null,
      quadrant_age_periods: 1,
      score: Math.round((80 - i * 0.6) * 10) / 10,
      rank_score: null,
      ret_1w: Math.round((0.03 - i * 0.001) * 10_000) / 10_000,
      median_turnover_20d_idr: Math.max(1_000_000_000, 300_000_000_000 - i * 4_000_000_000),
      tail: tailFor(rs, mom),
    });
  }
  return padded;
}

export const handlers = [
  http.get(`${API}/meta/sectors`, () => {
    const body: MetaSectorsResponse = {
      api_version: "1.0",
      items: sectors.map((s) => ({
        code: s.code,
        name_id: s.name_id,
        name_en: s.name_en,
        color_token: s.color_token,
        color_hex: s.color_hex,
        sort_order: s.sort_order,
        constituents_active: s.constituents_active,
      })),
    };
    return HttpResponse.json(body);
  }),

  http.get(`${API}/meta/config`, () => {
    // Salinan nilai aktif dari config/default.yaml (mock; sumber asli tetap backend).
    const body: MetaConfigResponse = {
      api_version: "1.0",
      universe: { min_turnover_idr: 1_000_000_000, min_price_idr: 100, max_rsi: 75 },
      rrg: {
        ema_span: 14,
        roc_lag: 10,
        weekly: { ema_span: 14, roc_lag: 4 },
        min_points: { d1: 60, w1: 30, w1_fri: 30, midday: 60 },
      },
      timeframes: ["d1", "w1", "w1_fri", "midday"],
      windows: ["1w", "1m", "3m", "6m", "1y", "ytd"],
      midday_gate_min_bar_time: "11:30",
      last_ingest: {
        prices_daily: LAST_DATA,
        intraday: "2026-10-12T16:31:40+07:00",
        signals_weekly: "2026-10-09T17:02:11+07:00",
      },
    };
    return HttpResponse.json(body);
  }),

  http.get(`${API}/freshness`, ({ request }) => {
    const sp = new URL(request.url).searchParams;
    const stale = sp.get("mock") === "stale";
    const lastBar = stale ? "2026-10-13T11:05:00+07:00" : "2026-10-13T11:42:00+07:00";
    const body: FreshnessResponse = {
      api_version: "1.0",
      midday_gate: {
        status: stale ? "stale" : "ok",
        as_of_date: "2026-10-13",
        last_bar_at: lastBar,
        required_bar_time: "11:30",
        probes: ["BBCA", "BBRI", "BMRI", "TLKM", "ASII"].map((ticker) => ({
          ticker,
          last_bar_at: lastBar,
        })),
      },
      daily_ingest: { status: "ok", last_data_at: LAST_DATA },
    };
    return HttpResponse.json(body);
  }),

  http.get(`${API}/rrg`, ({ request }) => {
    const sp = new URL(request.url).searchParams;
    const scope = sp.get("scope") === "stock" ? "stock" : "sector";
    const wanted = list(sp, "sector");
    const tailPoints = Math.max(1, Math.min(60, num(sp, "tail_points", 3)));

    const items: RrgItem[] =
      scope === "sector"
        ? sectors.map((s) => ({
            ref_id: s.code,
            name: s.name_id,
            color_hex: s.color_hex,
            rs_ratio: s.rs_ratio,
            rs_momentum: s.rs_momentum,
            quadrant: s.quadrant,
            quadrant_prev: s.quadrant_prev,
            transition: transition(s),
            quadrant_age_periods: s.quadrant_age_periods,
            score: s.score,
            rank_score: s.rank_score,
            ret_1w: s.ret_1w,
            median_turnover_20d_idr: s.median_turnover_20d_idr,
            tail: s.tail.slice(-tailPoints),
          }))
        : padStockItems(
            stocks
              .filter((s) => wanted.length === 0 || wanted.includes(s.sector_code))
              .map((s) => {
                const sector = sectors.find((x) => x.code === s.sector_code);
                return {
                  ref_id: s.ticker,
                  name: s.name,
                  color_hex: sector?.color_hex ?? "#888888",
                  rs_ratio: s.rs_ratio ?? 100,
                  rs_momentum: s.rs_momentum ?? 100,
                  quadrant: (s.quadrant ?? "lagging") as Quadrant,
                  quadrant_prev: null,
                  transition: null,
                  quadrant_age_periods: 1,
                  score: s.stock_score,
                  rank_score: null,
                  ret_1w: s.ret_1w,
                  median_turnover_20d_idr: s.median_turnover_20d_idr,
                  tail: tailFor(s.rs_ratio ?? 100, s.rs_momentum ?? 100).slice(-tailPoints),
                };
              }),
            wanted.length === 1 ? wanted[0] : null,
          );

    const quadrants = { leading: 0, weakening: 0, lagging: 0, improving: 0 } as RrgResponse["quadrants"];
    for (const item of items) quadrants[item.quadrant] += 1;

    const body: RrgResponse = {
      api_version: "1.0",
      timeframe: (sp.get("timeframe") ?? "d1") as Timeframe,
      as_of: sp.get("as_of") ?? AS_OF,
      window: "3m",
      weighting: "equal",
      quadrants,
      items,
      data_status: dataStatus(sp, scope),
    };
    return HttpResponse.json(body);
  }),

  http.get(`${API}/sectors/summary`, ({ request }) => {
    const sp = new URL(request.url).searchParams;
    const wantedSectors = list(sp, "sector");
    const wantedQuadrants = list(sp, "quadrant");
    const minStreak = num(sp, "min_streak");
    const minTurnover = num(sp, "min_turnover_idr");
    const onlyPartial = sp.get("only_partial") === "true";
    const retPositive = sp.get("ret_positive_only") === "true" || sp.get("ret_positive_only") === "1";
    const retField = WINDOW_RET_FIELD[sp.get("window") ?? "3m"];

    const filtered = sectors.filter(
      (s) =>
        (wantedSectors.length === 0 || wantedSectors.includes(s.code)) &&
        (wantedQuadrants.length === 0 || wantedQuadrants.includes(s.quadrant)) &&
        (sp.get("transition") === null || transition(s) === sp.get("transition")) &&
        s.streak_weeks >= minStreak &&
        (s.median_turnover_20d_idr ?? 0) >= minTurnover &&
        (!retPositive || retField === undefined || Number(s[retField] ?? 0) > 0) &&
        (!onlyPartial || s.partial),
    );

    const sortKey = SORT_FIELD[sp.get("sort") ?? "score"] ?? "score";
    const sorted = sortRows(filtered, sortKey, sp.get("dir") ?? "desc");
    const limit = Math.max(1, Math.min(500, num(sp, "limit", 50)));
    const offset = Math.max(0, num(sp, "offset"));

    const body: SectorSummaryResponse = {
      api_version: "1.0",
      total: sorted.length,
      limit,
      offset,
      // ret_1d dibuang: tidak ada di kontrak /sectors/summary (docs/05 §2)
      items: sorted.slice(offset, offset + limit).map(({ ret_1d: _drop, ...row }) => row),
      data_status: dataStatus(sp),
    };
    return HttpResponse.json(body);
  }),

  http.get(`${API}/sectors/:code`, ({ request, params }) => {
    const sp = new URL(request.url).searchParams;
    const row = sectors.find((s) => s.code === params.code);
    if (!row) return notFound("sector_not_found", `Sektor ${params.code} tidak ada di fixture`);

    const limit = Math.max(1, Math.min(500, num(sp, "constituents_limit", 50)));
    const minTurnover = num(sp, "min_turnover_idr");
    const minPrice = num(sp, "min_price_idr");
    const sortKey = STOCK_SORT_FIELD[sp.get("constituent_sort") ?? "stock_score"] ?? "stock_score";
    const constituents = sortRows(
      stocks.filter(
        (s) =>
          s.sector_code === row.code &&
          (s.median_turnover_20d_idr ?? 0) >= minTurnover &&
          s.close >= minPrice,
      ),
      sortKey,
      "desc",
    );
    const sectorSeriesRow = sectorSeries(row, 60);

    const body: SectorDetailResponse = {
      api_version: "1.0",
      sector: { code: row.code, name_id: row.name_id, color_hex: row.color_hex },
      metrics: {
        quadrant: row.quadrant,
        rs_ratio: row.rs_ratio,
        rs_momentum: row.rs_momentum,
        ret_1w: row.ret_1w,
        score: row.score,
        streak_weeks: row.streak_weeks,
        constituents_count: row.constituents_count,
        advancers: row.advancers,
        decliners: row.decliners,
      },
      series: sectorSeriesRow.map((p) => ({ date: p.date, index_close: p.index_close, ret_1d: row.ret_1d })),
      constituents: {
        total: constituents.length,
        items: constituents.slice(0, limit).map((s) => ({
          ticker: s.ticker,
          name: s.name,
          close: s.close,
          ret_1d: s.ret_1d,
          ret_1w: s.ret_1w,
          median_turnover_20d_idr: s.median_turnover_20d_idr,
          rs_ratio: s.rs_ratio,
          rs_momentum: s.rs_momentum,
          quadrant: s.quadrant,
          stock_score: s.stock_score,
          rsi14: s.rsi14,
          atr14: s.atr14,
        })),
      },
      data_status: dataStatus(sp),
    };
    return HttpResponse.json(body);
  }),

  http.get(`${API}/series/sector/:code`, ({ params }) => {
    const row = sectors.find((s) => s.code === params.code);
    if (!row) return notFound("sector_not_found", `Sektor ${params.code} tidak ada di fixture`);
    const body: SectorSeriesResponse = {
      api_version: "1.0",
      code: row.code,
      points: sectorSeries(row, 60),
    };
    return HttpResponse.json(body);
  }),

  http.get(`${API}/heatmap`, () => {
    const body: HeatmapResponse = {
      api_version: "1.0",
      columns: ["1d", "1w", "1m", "3m"],
      rows: sectors.map((s) => ({
        code: s.code,
        name_id: s.name_id,
        values: { "1d": s.ret_1d, "1w": s.ret_1w, "1m": s.ret_1m, "3m": s.ret_3m },
      })),
    };
    return HttpResponse.json(body);
  }),

  http.get(`${API}/rotation/matrix`, ({ request }) => {
    const sp = new URL(request.url).searchParams;
    const cells = new Map<string, { from: Quadrant; to: Quadrant; count: number; refs: string[] }>();
    for (const s of sectors) {
      if (!s.quadrant_prev) continue;
      const key = `${s.quadrant_prev}→${s.quadrant}`;
      const cell = cells.get(key) ?? { from: s.quadrant_prev, to: s.quadrant, count: 0, refs: [] };
      cell.count += 1;
      cell.refs.push(s.code);
      cells.set(key, cell);
    }
    const body: RotationMatrixResponse = {
      api_version: "1.0",
      timeframe: (sp.get("timeframe") ?? "d1") as Timeframe,
      from: PREV_AS_OF,
      to: sp.get("as_of") ?? AS_OF,
      cells: [...cells.values()],
      changes: sectors
        .filter((s) => s.quadrant_prev && s.quadrant_prev !== s.quadrant)
        .map((s) => ({
          ref_id: s.code,
          name: s.name_id,
          from: s.quadrant_prev as Quadrant,
          to: s.quadrant,
          as_of: "2026-10-09",
        })),
    };
    return HttpResponse.json(body);
  }),

  http.get(`${API}/stocks`, ({ request }) => {
    const sp = new URL(request.url).searchParams;
    const wantedSectors = list(sp, "sector");
    const wantedQuadrants = list(sp, "quadrant");
    const q = (sp.get("q") ?? "").trim().toLowerCase();
    const minTurnover = num(sp, "min_turnover_idr");
    const minPrice = num(sp, "min_price_idr");
    // shortcut mock: /stocks tidak punya param `window`, jadi acuan return positif = ret_1w
    const retPositive = sp.get("ret_positive_only") === "true" || sp.get("ret_positive_only") === "1";

    const filtered = stocks.filter(
      (s) =>
        (wantedSectors.length === 0 || wantedSectors.includes(s.sector_code)) &&
        (wantedQuadrants.length === 0 || wantedQuadrants.includes(s.quadrant ?? "")) &&
        (q === "" || s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)) &&
        (!retPositive || (s.ret_1w ?? 0) > 0) &&
        (s.median_turnover_20d_idr ?? 0) >= minTurnover &&
        s.close >= minPrice,
    );

    const sortKey = STOCK_SORT_FIELD[sp.get("sort") ?? "stock_score"] ?? "stock_score";
    const sorted = sortRows(filtered, sortKey, sp.get("dir") ?? "desc");
    const limit = Math.max(1, Math.min(500, num(sp, "limit", 50)));
    const offset = Math.max(0, num(sp, "offset"));

    const body: StocksResponse = {
      api_version: "1.0",
      total: sorted.length,
      limit,
      offset,
      items: sorted.slice(offset, offset + limit),
      data_status: dataStatus(sp, "stock"),
    };
    return HttpResponse.json(body);
  }),

  http.get(`${API}/stocks/:ticker`, ({ params }) => {
    const row = stocks.find((s) => s.ticker === params.ticker);
    if (!row) return notFound("stock_not_found", `Saham ${params.ticker} tidak ada di fixture`);
    const pick = weekly.stocks.find((p) => p.ticker === row.ticker);

    const body: StockDetailResponse = {
      api_version: "1.0",
      stock: {
        ticker: row.ticker,
        name: row.name,
        sector_code: row.sector_code,
        yahoo_symbol: `${row.ticker}.JK`,
      },
      metrics: {
        close: row.close,
        sma20: Math.round(row.close * 0.985),
        sma50: Math.round(row.close * 0.955),
        rsi14: row.rsi14,
        atr14: row.atr14,
        ret_1d: row.ret_1d,
        ret_1w: row.ret_1w,
        ret_1m: row.ret_1m,
        median_turnover_20d_idr: row.median_turnover_20d_idr,
        rs_ratio: row.rs_ratio,
        rs_momentum: row.rs_momentum,
        quadrant: row.quadrant,
        stock_score: row.stock_score,
        margin_to_min_turnover: row.median_turnover_20d_idr === null ? null : Math.round((row.median_turnover_20d_idr / 1_000_000_000) * 10) / 10,
      },
      series: stockSeries(row, 30),
      last_pick: pick
        ? {
            week_end: weekly.week_end,
            rank: pick.rank,
            streak_weeks: pick.streak_weeks,
            entry_ref: pick.entry_ref,
            stop: pick.stop,
            target: pick.target,
            rationale: pick.rationale,
          }
        : null,
    };
    return HttpResponse.json(body);
  }),

  http.get(`${API}/weekly/picks`, ({ request }) => {
    const sp = new URL(request.url).searchParams;
    const minStreak = num(sp, "min_streak", 1);
    const wantedSectors = list(sp, "sector");
    const sectorCodes = weekly.sectors
      .filter((s) => s.streak_weeks >= minStreak && (wantedSectors.length === 0 || wantedSectors.includes(s.ref_id)))
      .map((s) => s.ref_id);

    const body: WeeklyPicksResponse = {
      api_version: "1.0",
      week_end: sp.get("week_end") ?? weekly.week_end,
      is_final: sp.get("week_end") !== null ? sp.get("week_end") === weekly.week_end : weekly.is_final,
      sectors: weekly.sectors.filter((s) => sectorCodes.includes(s.ref_id)),
      stocks: weekly.stocks.filter((s) => sectorCodes.includes(s.sector_code)),
    };
    return HttpResponse.json(body);
  }),

  http.get(`${API}/briefing/morning`, ({ request }) => {
    const sp = new URL(request.url).searchParams;
    const topN = Math.max(1, Math.min(11, num(sp, "top_n", 3)));
    const stale = sp.get("mock") === "stale";
    const byScore = sortRows(sectors, "score", "desc");
    const ranked = (rows: SectorRow[]) =>
      rows.map((s) => ({
        code: s.code,
        name_id: s.name_id,
        quadrant: s.quadrant,
        score: s.score,
        ret_1w: s.ret_1w,
        streak_weeks: s.streak_weeks,
      }));
    const up = sectors.filter((s) => (s.ret_1d ?? 0) > 0).length;
    const sum = (key: "advancers" | "decliners" | "unchanged") =>
      sectors.reduce((total, s) => total + s[key], 0);

    const body: BriefingResponse = {
      api_version: "1.0",
      generated_at: "2026-10-13T06:30:00+07:00",
      data_status: dataStatus(sp),
      market: {
        ihsg_close: 5936.15,
        ihsg_ret_1d: -0.0259,
        ihsg_ret_1w: -0.0204,
        sectors_up: up,
        sectors_down: sectors.length - up,
        breadth: { advancers: sum("advancers"), decliners: sum("decliners"), unchanged: sum("unchanged") },
        regime: up > sectors.length - up ? "risk_on" : up === sectors.length - up ? "netral" : "risk_off",
        regime_note: `${up} dari ${sectors.length} sektor naik; kekuatan terkumpul di ${byScore[0]?.name_id ?? "-"} dan ${byScore[1]?.name_id ?? "-"}.`,
      },
      leaders: ranked(byScore.slice(0, topN)),
      laggards: ranked(byScore.slice(-topN).reverse()),
      changes: sectors
        .filter((s) => s.quadrant_prev && s.quadrant_prev !== s.quadrant)
        .map((s) => ({
          ref_id: s.code,
          name: s.name_id,
          from: s.quadrant_prev as Quadrant,
          to: s.quadrant,
          as_of: "2026-10-09",
        })),
      weekly_focus: {
        week_end: weekly.week_end,
        sectors: weekly.sectors.map((s) => ({
          code: s.ref_id,
          streak_weeks: s.streak_weeks,
          rationale: s.rationale,
        })),
        stocks: weekly.stocks.map((s) => ({
          ticker: s.ticker,
          entry_ref: s.entry_ref,
          stop: s.stop,
          target: s.target,
          streak_weeks: s.streak_weeks,
          rationale: s.rationale,
        })),
      },
      midday: {
        available: !stale,
        as_of: "2026-10-13",
        gate: stale ? "stale" : "ok",
        moves: byScore.slice(0, 3).map((s) => ({
          code: s.code,
          ret_intraday: s.ret_1d === null ? null : Math.round(s.ret_1d * 1.4 * 10_000) / 10_000,
          direction: (s.ret_1d ?? 0) > 0.0015 ? "naik" : (s.ret_1d ?? 0) < -0.0015 ? "turun" : "datar",
          projected_quadrant: s.quadrant,
        })),
      },
      watch: stale
        ? [{ level: "warning", message: "Data intraday Yahoo belum sampai 11:30 WIB; angka midday = penutupan sebelumnya." }]
        : [{ level: "info", message: "Angka mingguan memakai pekan yang sudah final (9 Okt 2026)." }],
      notes_for_report:
        "Susun 5–8 paragraf: kondisi pasar, sektor kuat/lemah, perubahan kuadran, fokus mingguan (sebut streak), risiko & catatan data.",
    };
    return HttpResponse.json(body);
  }),

  ...adminHandlers,
];
