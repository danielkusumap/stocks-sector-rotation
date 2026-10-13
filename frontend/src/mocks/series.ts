import { HttpResponse, http } from "msw";
import type { Candle, StockSeriesResponse } from "../lib/api";
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
}

function bodyFor({ ticker, lastClose, name, knob }: SeriesQuery): StockSeriesResponse {
  const candles = knob === "nocandle" ? [] : candlesFor(ticker, lastClose);
  const closes = candles.map((c) => c.close);
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
    // F19 hanya lapisan dasar; `indicators`/`smc`/`elliott` menyusul di F21/F22
    layers: [],
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
    return HttpResponse.json(
      bodyFor({
        ticker,
        name: stock.name,
        lastClose: stock.close,
        knob: new URL(request.url).searchParams.get("mock"),
      }),
    );
  }),
];

