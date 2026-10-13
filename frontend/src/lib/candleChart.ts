import type { Candle } from "./api";
import { formatNum, formatRp } from "./format";

/**
 * Helper murni grafik candle (docs/06 §6.5, docs/08 F19). **Tidak ada rumus finansial**:
 * harga, MA, Donchian, kanal, level, dan penanda event semuanya dari API
 * (`GET /series/stock/{ticker}`). Di sini hanya skala/layout SVG, aturan tampil overlay,
 * dan teks label Bahasa Indonesia — semuanya bisa diuji tanpa DOM.
 */

/** Padding atas-bawah domain harga: 5% rentang supaya wick tidak menempel tepi. */
export const PRICE_PAD = 0.05;
/** Body minimum 1 px supaya bar "doji" tidak hilang (docs/06 §6.5). */
export const MIN_BODY_PX = 1;

export interface Plot {
  /** tinggi area gambar (px) */
  height: number;
  /** lebar area gambar (px) */
  width: number;
  /** jarak kiri untuk label harga */
  padLeft?: number;
}

export interface PriceDomain {
  min: number;
  max: number;
}

/**
 * Domain harga: `min/max` candle **digabung** dengan semua nilai overlay & level
 * (MA, Donchian, kanal, SL/TP, POC) supaya tidak ada garis keluar kotak; padding simetris.
 */
export function priceDomain(
  candles: readonly Candle[],
  extras: readonly (number | null | undefined)[] = [],
  pad = PRICE_PAD,
): PriceDomain {
  const values = [
    ...candles.flatMap((c) => [c.low, c.high]),
    ...extras.filter((v): v is number => typeof v === "number" && Number.isFinite(v)),
  ].filter((v) => Number.isFinite(v));
  if (values.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(1, Math.abs(max) * 0.01);
  return { min: min - span * pad, max: max + span * pad };
}

/** Skala nilai harga → y px (0 = atas). */
export function scaleY(value: number, domain: PriceDomain, plot: Plot): number {
  const span = domain.max - domain.min || 1;
  return plot.height - ((value - domain.min) / span) * plot.height;
}

/** Skala volume → tinggi bar px (volume 0 → 0). */
export function volumeHeight(volume: number, maxVolume: number, height: number): number {
  if (!Number.isFinite(volume) || maxVolume <= 0) return 0;
  return Math.max(1, (volume / maxVolume) * height);
}

export interface CandleLayout {
  index: number;
  /** x tengah candle (px) */
  x: number;
  /** naik = close ≥ open → token `--up` */
  up: boolean;
  bodyY: number;
  bodyHeight: number;
  wickTop: number;
  wickBottom: number;
}

/**
 * Layout candle: body `max(1px, |close−open|)`, wick 1 px. Lebar bar dihitung dari
 * jumlah bar supaya tidak ada bar "kembar" (docs/06 §6.5).
 */
export function layoutCandles(
  candles: readonly Candle[],
  domain: PriceDomain,
  plot: Plot,
): CandleLayout[] {
  const count = candles.length;
  const band = count > 0 ? plot.width / count : plot.width;
  return candles.map((candle, index) => {
    const x = band * index + band / 2;
    const openY = scaleY(candle.open, domain, plot);
    const closeY = scaleY(candle.close, domain, plot);
    const up = candle.close >= candle.open;
    const top = Math.min(openY, closeY);
    const height = Math.abs(openY - closeY);
    return {
      index,
      x,
      up,
      bodyY: top,
      bodyHeight: Math.max(MIN_BODY_PX, height),
      wickTop: scaleY(candle.high, domain, plot),
      wickBottom: scaleY(candle.low, domain, plot),
    };
  });
}

/** Lebar band per bar (px) — dipakai untuk menentukan apakah body perlu border `--surface`. */
export function bandWidth(plot: Plot, count: number): number {
  return count > 0 ? plot.width / count : plot.width;
}

/** Body tipis (< 2 px) diberi border `--surface` supaya tidak terlihat kembar. */
export function needsBorder(bodyHeight: number): boolean {
  return bodyHeight < 2;
}

export interface OverlayVisibility {
  /** MA20/MA50 & Donchian selalu tampil (docs/06 §6.5). */
  ma: boolean;
  donchian: boolean;
  /** Kanal S/R pivot **hanya** di rezim range/tipis (skill: bukan alat utama saat tren). */
  channel: boolean;
}

/** Aturan tampil overlay per rezim — satu tempat, dipakai chart & legenda (docs/03 §6.4.9). */
export function overlayVisibility(regime: string | null | undefined): OverlayVisibility {
  const range = regime === "range" || regime === "tipis";
  return { ma: true, donchian: true, channel: range };
}

/** Nama token warna per hasil event (`Pill`/SVG memakai `var(--…)`, bukan hex). */
export function eventToken(result: string | null | undefined): string {
  if (result === "win") return "--up";
  if (result === "loss") return "--down";
  return "--fg-faint";
}

/** Tanggal → x px (untuk garis bidik & penanda event). */
export function xOfIndex(index: number, count: number, plot: Plot): number {
  const band = bandWidth(plot, count);
  return band * index + band / 2;
}

/** Indeks bar terdekat dari posisi x (hover bar), `null` kalau di luar area gambar. */
export function indexAtX(x: number, count: number, plot: Plot): number | null {
  if (count === 0) return null;
  const band = bandWidth(plot, count);
  const index = Math.floor(x / band);
  if (index < 0 || index >= count) return null;
  return index;
}

/**
 * Teks kotak hover (docs/06 §6.5): O/H/L/C + volume dari bar yang **dari API**.
 * % perubahan **tidak** ditampilkan: `candles` di kontrak tidak memuat persen per bar
 * dan frontend tidak menghitung sendiri (lihat docs/DECISIONS.md).
 */
export function hoverSummary(candle: Candle): string {
  return [
    `O ${formatRp(candle.open)}`,
    `H ${formatRp(candle.high)}`,
    `L ${formatRp(candle.low)}`,
    `C ${formatRp(candle.close)}`,
    `Vol ${formatNum(candle.volume, 0)}`,
  ].join(" · ");
}

/** Label level plan di grafik: `SL 3.991 (−2,85%)` — persen dari API (`pct` level). */
export function levelLabel(name: string, level: number | null | undefined, pctText?: string | null): string {
  const value = formatRp(level);
  return pctText ? `${name} ${value} (${pctText})` : `${name} ${value}`;
}

/** Ringkasan `aria-label` grafik (docs/06 §6.5): tren, rezim, ada/tidaknya level plan. */
export function chartAriaLabel({
  ticker,
  regime,
  bars,
  hasLevels,
}: {
  ticker: string;
  regime: string | null | undefined;
  bars: number;
  hasLevels: boolean;
}): string {
  return [
    `Grafik candle ${ticker}, ${formatNum(bars, 0)} bar`,
    regime ? `rezim ${regime.replace(/_/g, " ")}` : "rezim belum diketahui",
    hasLevels ? "dengan level rencana" : "tanpa level rencana",
    "harga penyesuaian",
  ].join(" · ");
}
