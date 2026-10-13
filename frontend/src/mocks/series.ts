import { HttpResponse, http } from "msw";
import type { Candle, Layer, StockSeriesResponse } from "../lib/api";
import stocksJson from "./fixtures/stocks.json";
import taJson from "./fixtures/ta.json";
import weeklyJson from "./fixtures/weekly.json";

/**
 * Mock `GET /series/stock/{ticker}` (docs/05 §2, dipakai `docs/08` F19).
 * Bar **diturunkan deterministik** dari angka fixture (`stocks.json`) sehingga candle,
 * level plan (`weekly.json`), dan penanda event (`ta.json`) saling konsisten — angka
 * indikator di sini dihitung mock (mock berperan backend), frontend tidak menghitung apa pun.
 *
 * Knob: `?mock=range` → rezim `range` (kanal S/R tampil), `?mock=nocandle` → `candles: []`.
 */

const API = "/api/v1";
const BARS = 120;
/** MA yang digambar (docs/06 §6.5: MA20 solid, MA50 putus-putus). */
const MA_PERIODS = [20, 50];

/** SMA; warmup → `null` (docs/05: nilai null dibuang saat dikirim). */
function sma(values: number[], period: number): (number | null)[] {
  return values.map((_, index) => {
    if (index + 1 < period) return null;
    const slice = values.slice(index + 1 - period, index + 1);
    return slice.reduce((total, value) => total + value, 0) / period;
  });
}

/** Donchian: high/low ekstrem `period` bar ke belakang. */
function donchian(candles: Candle[], period: number) {
  const points = (pick: (c: Candle) => number) =>
    candles
      .map((candle, index) => {
        if (index + 1 < period) return null;
        const window = candles.slice(index + 1 - period, index + 1).map(pick);
        return { date: candle.date, value: Math.round(Math.max(...window)) };
      })
      .filter((point): point is { date: string; value: number } => point !== null);
  return { high: points((c) => c.high), low: points((c) => c.low) };
}

/** LCG kecil: bar yang sama setiap kali dimuat (tidak ada data acak per request). */
function rng(seed: string) {
  let state = sumSeed(seed) || 7;
  return (lo: number, hi: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return lo + (state % (hi - lo + 1));
  };
}

function sumSeed(seed: string): number {
  let total = 0;
  for (let i = 0; i < seed.length; i += 1) total += seed.charCodeAt(i) * (i + 7);
  return total;
}

const dateOf = (barsAgo: number): string => {
  const day = new Date(Date.UTC(2026, 9, 12));
  let left = barsAgo;
  while (left > 0) {
    day.setUTCDate(day.getUTCDate() - 1);
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return day.toISOString().slice(0, 10);
};

/**
 * Lapisan `indicators` (F21): Ultimate RSI, VWAP+σ, POC — **dihitung mock** dari candle
 * fixture supaya angkanya konsisten dengan grafik (mock berperan backend; frontend tidak
 * menghitung apa pun). POC di sini berbasis bar **harian** → UI wajib menulis "perkiraan".
 */
function indicatorsFor(candles: Candle[]): NonNullable<StockSeriesResponse["indicators"]> {
  const closes = candles.map((c) => c.close);
  const sma14 = sma(closes, 14);
  const sma20 = sma(closes, 20);

  const ursiPoints = candles
    .map((candle, index) => {
      const base = sma14[index];
      if (base === null) return null;
      const raw = 50 + ((candle.close - base) / base) * 220;
      const value = Math.round(Math.max(5, Math.min(95, raw)) * 10) / 10;
      const previous = index > 0 ? candle.close : candle.open;
      const signalBase = sma14[index - 1] ?? base;
      const signalRaw = 50 + ((previous - signalBase) / signalBase) * 220;
      const signal = Math.round(Math.max(5, Math.min(95, signalRaw)) * 10) / 10;
      return { date: candle.date, value, signal };
    })
    .filter((point): point is { date: string; value: number; signal: number } => point !== null);

  const vwapPoints = candles
    .map((candle, index) => {
      const base = sma20[index];
      if (base === null || index + 1 < candles.length - 60) return null;
      return {
        date: candle.date,
        vwap: Math.round(base * 10) / 10,
        upper1: Math.round(base * 1.008 * 10) / 10,
        lower1: Math.round(base * 0.992 * 10) / 10,
        upper2: Math.round(base * 1.016 * 10) / 10,
        lower2: Math.round(base * 0.984 * 10) / 10,
      };
    })
    .filter((point): point is { date: string; vwap: number; upper1: number; lower1: number; upper2: number; lower2: number } => point !== null);

  const last60 = closes.slice(-60).sort((a, b) => a - b);
  const poc = last60.length > 0 ? last60[Math.floor(last60.length / 2)] : closes.at(-1) ?? 0;

  return {
    ursi: { len: 14, method: "sma", ob: 70, os: 30, points: ursiPoints },
    vwap: {
      len: 20,
      anchor: "rolling",
      anchor_date: candles.at(-21)?.date ?? candles[0]?.date ?? null,
      points: vwapPoints,
    },
    poc: {
      basis: "daily",
      bars_used: Math.min(60, candles.length),
      bins: 24,
      poc: Math.round(poc),
      value_area: { low: Math.round(poc * 0.98), high: Math.round(poc * 1.02) },
    },
  };
}

/**
 * Lapisan `smc` (F22): BOS/CHoCH, order block, FVG, equal level, range premium/discount —
 * diturunkan mock dari bar terakhir (mock berperan backend; frontend tidak menghitung).
 */
function smcFor(candles: Candle[]): NonNullable<StockSeriesResponse["smc"]> {
  const recent = candles.slice(-40);
  if (recent.length < 5) {
    return { bos: [], choch: [], order_blocks: [], fvg: [], equal_levels: [], range: null };
  }
  const highs = recent.map((c) => c.high);
  const lows = recent.map((c) => c.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const bosDate = recent[recent.length - 8];
  const chochDate = recent[recent.length - 3];
  const blocks = recent.slice(-6, -3).map((candle, index) => ({
    kind: index % 2 === 0 ? "bullish" : "bearish",
    from: candle.date,
    to: recent[recent.length - 2].date,
    low: Math.min(candle.open, candle.close),
    high: Math.max(candle.open, candle.close),
    mitigated: index === 1,
  }));
  const gaps = recent
    .map((candle, index) => {
      const before = recent[index - 1];
      const after = recent[index + 1];
      if (!before || !after || before.high >= after.low) return null;
      return { kind: "bullish", date: candle.date, low: before.high, high: after.low, mitigated: index % 3 === 0 };
    })
    .filter((gap): gap is { kind: string; date: string; low: number; high: number; mitigated: boolean } => gap !== null);
  const rounded = (value: number) => Math.round(value);
  const equalHigh = rounded(Math.max(...highs.slice(-10)));
  const equalLow = rounded(Math.min(...lows.slice(-10)));

  return {
    bos: [{ date: bosDate.date, direction: "up", level: rounded(bosDate.high) }],
    choch: [{ date: chochDate.date, direction: "down", level: rounded(chochDate.low) }],
    order_blocks: blocks,
    fvg: gaps,
    equal_levels: [
      { kind: "high", level: equalHigh, count: 2 },
      { kind: "low", level: equalLow, count: 3 },
    ],
    range: {
      low: rounded(min),
      high: rounded(max),
      premium_from: rounded(min + (max - min) * 0.7),
      discount_to: rounded(min + (max - min) * 0.3),
    },
  };
}

/**
 * Lapisan `elliott` (F22): ZigZag 6 pivot, wave `1..5`, zona Fib dari rentang; `invalidated`
 * hanya saat diminta (knob `?mock=smc`) supaya gaya putus + catatan bisa diperiksa.
 */
function elliottFor(candles: Candle[], invalidated: boolean): NonNullable<StockSeriesResponse["elliott"]> {
  const step = Math.max(1, Math.floor(candles.length / 6));
  const zigzag = Array.from({ length: 6 }, (_, index) => candles[Math.max(0, candles.length - 1 - index * step)])
    .filter((candle): candle is Candle => candle !== undefined)
    .reverse()
    .map((candle) => ({ date: candle.date, price: candle.high, kind: "high" }));
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const top = Math.max(...highs);
  const bottom = Math.min(...lows);

  return {
    status: invalidated ? "invalidated" : "candidate",
    invalidated,
    zigzag,
    waves: zigzag.slice(0, 5).map((pivot, index) => ({
      label: String(index + 1),
      from: zigzag[index].date,
      to: pivot.date,
      price_from: zigzag[index].price,
      price_to: pivot.price,
    })),
    fib_zones: [0.382, 0.5, 0.618].map((ratio) => ({
      ratio,
      level: Math.round(bottom + (top - bottom) * ratio),
    })),
    note: "kandidat, bisa berubah",
  };
}

/** Bar harian mundur dari harga penutupan fixture; rentang wajar (bukan simulasi pasar nyata). */
function candlesFor(ticker: string, lastClose: number): Candle[] {
  const rnd = rng(ticker);
  const bars: Candle[] = [];
  let close = lastClose;
  for (let i = 0; i < BARS; i += 1) {
    const drift = rnd(-25, 25) / 1000; // ±2,5% per bar
    const open = close / (1 + drift);
    const high = Math.max(open, close) * (1 + rnd(1, 12) / 1000);
    const low = Math.min(open, close) * (1 - rnd(1, 12) / 1000);
    bars.push({
      date: dateOf(i),
      open: Math.round(open),
      high: Math.round(high),
      low: Math.round(low),
      close: Math.round(close),
      volume: rnd(20_000_000, 180_000_000),
    });
    close = open;
  }
  return bars.reverse(); // docs/05: urut lama → baru
}

interface SeriesQuery {
  ticker: string;
  lastClose: number;
  name: string;
  knob: string | null;
  /** Lapisan yang diminta UI (`docs/06` §6.6); default backend = `indicators`. */
  layers: Layer[];
}

function bodyFor({ ticker, lastClose, name, knob, layers }: SeriesQuery): StockSeriesResponse {
  const candles = knob === "nocandle" ? [] : candlesFor(ticker, lastClose);
  const closes = candles.map((c) => c.close);
  // lapisan indikator (F21) hanya dibuat bila diminta — mock berperan backend
  const indicators = layers.includes("indicators") ? indicatorsFor(candles) : undefined;
  // lapisan konteks (F22): `?mock=smc` mengirim smc+elliott **walau tidak diminta** (AC 1: UI
  // harus tetap 0 elemen saat toggle mati); elliott `invalidated` untuk menguji gaya putus
  const smc = knob === "smc" || layers.includes("smc") ? smcFor(candles) : undefined;
  const elliott = knob === "smc" || layers.includes("elliott") ? elliottFor(candles, knob === "smc") : undefined;
  const maSeries = (period: number) =>
    sma(closes, period)
      .map((value, index) => (value === null ? null : { date: candles[index].date, value: Math.round(value * 10) / 10 }))
      .filter((point): point is { date: string; value: number } => point !== null);

  const ma: Record<string, { date: string; value: number }[]> = {};
  for (const period of MA_PERIODS) {
    if (closes.length >= period) ma[String(period)] = maSeries(period);
  }

  const fast = donchian(candles, 20);
  const slow = donchian(candles, 40);
  const volumeMa = sma(
    candles.map((c) => c.volume),
    20,
  );

  const pick = weeklyJson.stocks.find((s) => s.ticker === ticker) ?? null;
  const last = candles.at(-1);
  const regime = knob === "range" ? "range" : "tren_naik";
  const levels = pick
    ? {
        week_end: weeklyJson.week_end,
        entry_zone: { low: Math.round(lastClose * 0.99), high: Math.round(lastClose * 1.01) },
        stop: pick.stop,
        tp1: Math.round((lastClose + pick.target) / 2),
        tp2: pick.target,
        rr_tp2: 2.05,
        plan_ok: true,
      }
    : null;

  const taRuns = (taJson.refs as Record<string, { runs: Record<string, { events: unknown[] }> }>)[ticker];
  const events = (taRuns?.runs["20|on"]?.events ?? []).slice(0, 12);

  return {
    api_version: "1.0",
    ticker,
    name,
    price_basis: "adj_close",
    regime,
    active_tools: regime === "range" ? ["sr_channel", "rsi_tepi_range"] : ["pullback_ma20", "volume"],
    regime_reason:
      regime === "range"
        ? "Penyangga 20 & 50 hari berdekatan dan mendatar — alat utama pantulan di kanal, bukan breakout."
        : "Harga di atas penyangga 20 & 50 hari dan sektornya Memimpin — alat utama pantulan ke penyangga.",
    candles,
    overlays: {
      ma,
      donchian: {
        fast: { high: fast.high, low: fast.low },
        slow: { high: slow.high, low: slow.low },
      },
      channels:
        regime === "range"
          ? [
              { low: Math.round(lastClose * 0.94), high: Math.round(lastClose * 0.97), strength: 3, kind: "support", from: candles[10]?.date ?? null, to: null },
              { low: Math.round(lastClose * 1.03), high: Math.round(lastClose * 1.06), strength: 2, kind: "resistance", from: candles[4]?.date ?? null, to: null },
            ]
          : [],
      volume_ma: volumeMa
        .map((value, index) => (value === null ? null : { date: candles[index].date, value: Math.round(value) }))
        .filter((point): point is { date: string; value: number } => point !== null),
    },
    levels,
    events: events as StockSeriesResponse["events"],
    volume_confirm_mult: 1.5,
    // lapisan sesuai permintaan URL (`layers`); kosong = hanya lapisan dasar (F19)
    layers,
    indicators,
    smc,
    elliott,
    data_status: {
      // `as_of` wajib string di kontrak; saat `candles: []` pakai tanggal hasil hitung terakhir
      as_of: last?.date ?? "2026-10-12",
      timeframe: "d1",
      status: "ok",
      last_data_at: "2026-10-12T16:10:00+07:00",
      computed_at: "2026-10-12T16:31:02+07:00",
      range_from: candles.at(-2)?.date ?? null,
      range_to: last?.date ?? null,
      range_label: null,
      window_range_label: null,
      partial_sectors: [],
    },
  };
}

export const seriesHandlers = [
  http.get(`${API}/series/stock/:ticker`, ({ request, params }) => {
    const ticker = String(params.ticker).toUpperCase();
    const stock = stocksJson.find((s) => s.ticker === ticker);
    if (!stock) {
      return HttpResponse.json(
        { api_version: "1.0", error: { code: "not_found", message: `saham ${ticker} tidak ada`, detail: null } },
        { status: 404 },
      );
    }
    const url = new URL(request.url);
    const knob = url.searchParams.get("mock");
    const rawLayers = url.searchParams.get("layers");
    // kontrak: default backend `indicators`; `layers=` (kosong) = hanya lapisan dasar (F19)
    const layers: Layer[] =
      knob === "nolayer"
        ? []
        : rawLayers === null
          ? ["indicators"]
          : rawLayers
              .split(",")
              .map((item) => item.trim())
              .filter((item): item is Layer => item === "indicators" || item === "smc" || item === "elliott");
    return HttpResponse.json(
      bodyFor({
        ticker,
        name: stock.name,
        lastClose: stock.close,
        knob,
        layers,
      }),
    );
  }),
];

