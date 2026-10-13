import type { Candle, ElliottLayers, Layer, SmcLayers } from "./api";
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

// ── F21: lapisan indikator (Ultimate RSI, VWAP+σ, POC) — docs/06 §6.6 ─────────

/** Skala URSI **selalu** 0–100 (docs/06 §6.6); nilai dari API dijepit ke rentang itu. */
export function ursiY(value: number, height: number): number {
  const clamped = Math.max(0, Math.min(100, value));
  return height - (clamped / 100) * height;
}

export interface UrisGuides {
  y50: number;
  /** Ambang overbought (`ob`) & oversold (`os`) dari API — bukan angka di frontend. */
  yOb: number;
  yOs: number;
}

/** Garis bantu panel URSI: 50, ambang `ob`, `os` (nilainya dari respons backend). */
export function ursiGuides(ob: number, os: number, height: number): UrisGuides {
  return { y50: ursiY(50, height), yOb: ursiY(ob, height), yOs: ursiY(os, height) };
}

/** Label panel URSI: `Ultimate RSI (14, SMA)` — parameter dari API. */
export function ursiTitle(len: number | null | undefined, method: string | null | undefined): string {
  const parts = [len === null || len === undefined ? null : formatNum(len, 0), method ? method.toUpperCase() : null]
    .filter((part): part is string => part !== null);
  return parts.length > 0 ? `Ultimate RSI (${parts.join(", ")})` : "Ultimate RSI";
}

/** Di rezim range panel URSI disembunyikan dan diganti catatan ini (docs/06 §6.6). */
export function ursiRangeNote(regime: string | null | undefined): string | null {
  return regime === "range" ? "di rentang, pakai RSI klasik (kontrarian)" : null;
}

/** Header panel VWAP: `VWAP 20 · anchor 14 Sep` (anchor dari API, diformat lib/format). */
export function vwapAnchorLabel(len: number | null | undefined, anchorDate: string | null | undefined): string {
  const head = `VWAP ${len === null || len === undefined ? "—" : formatNum(len, 0)}`;
  if (!anchorDate) return head;
  const parsed = new Date(`${anchorDate}T00:00:00+07:00`);
  if (Number.isNaN(parsed.getTime())) return head;
  const short = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(parsed);
  return `${head} · anchor ${short}`;
}

/**
 * Peringatan jujur saat VWAP dipaksa tampil di luar rezim range (docs/06 §6.6):
 * VWAP bukan alat utama saat tren (skill `idx-ta-trading-plan`).
 */
export function vwapWarning(regime: string | null | undefined): string | null {
  if (regime === "range" || regime === "tipis") return null;
  return "bukan alat utama saat tren";
}

/** Label POC **wajib** basisnya (docs/06 §6.6): `daily` → "perkiraan", intraday → menit. */
export function pocLabel(basis: string | null | undefined, barsUsed: number | null | undefined): string {
  const bars = barsUsed === null || barsUsed === undefined ? null : `${formatNum(barsUsed, 0)} bar`;
  if (basis === "intraday") return `dari bar 5 menit${bars ? ` (${bars})` : ""}`;
  return `perkiraan dari bar harian${bars ? ` (${bars})` : ""}`;
}

/** Lapisan yang diminta user dari URL (default `indicators`, docs/06 §6.6). */
export const LAYERS_DEFAULT: readonly Layer[] = ["indicators"];

export function layerList(search: URLSearchParams): Layer[] {
  const raw = search.get("layers");
  if (raw === null) return [...LAYERS_DEFAULT];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is Layer => item === "indicators" || item === "smc" || item === "elliott");
}

/** Tulis pilihan lapisan ke URL; `layers=` kosong = tanpa lapisan (default dibuang dari URL). */
export function setLayers(search: URLSearchParams, layers: readonly Layer[]): URLSearchParams {
  const params = new URLSearchParams(search);
  const list = [...layers];
  const isDefault = list.length === LAYERS_DEFAULT.length && list.every((layer, index) => LAYERS_DEFAULT[index] === layer);
  if (list.length === 0) params.set("layers", "");
  else if (isDefault) params.delete("layers");
  else params.set("layers", list.join(","));
  return params;
}

/** Nilai `layers` untuk request API: `undefined` = biarkan default backend (tanpa parameter). */
export function layersParam(search: URLSearchParams): Layer[] | undefined {
  const raw = search.get("layers");
  if (raw === null) return undefined;
  const list = layerList(search);
  return list;
}

/** Label tombol toggle lapisan + keterangan yang ditampilkan sebagai `title` (docs/06 §6.6/§6.7). */
export const LAYER_LABEL: Record<Layer, string> = {
  indicators: "Indikator",
  smc: "SMC",
  elliott: "Elliott",
};

/** Urutan tombol lapisan di UI (docs/06 §6.6/§6.7) — dipakai LayerToggles. */
export const LAYER_ORDER: readonly Layer[] = ["indicators", "smc", "elliott"];

export const LAYER_HINT: Record<Layer, string> = {
  indicators: "Ultimate RSI, VWAP+σ, dan POC",
  smc: "lapisan konteks, bukan sinyal",
  elliott: "kandidat, bisa berubah",
};

/** Nyalakan/matikan satu lapisan, urutan tetap (docs/06 §6.6). */
export function toggleLayer(layers: readonly Layer[], layer: Layer): Layer[] {
  return layers.includes(layer) ? layers.filter((item) => item !== layer) : [...layers, layer];
}

// ── F22: lapisan konteks SMC & Elliott (docs/06 §6.7) ────────────────────────

/** Pemetaan tanggal/harga → koordinat SVG; disuntik supaya helper bisa diuji tanpa DOM. */
export interface ShapeScale {
  x: (date: string) => number | null;
  y: (price: number) => number;
  /** Tepi kiri/kanan area plot (dari komponen) — garis level penuh memakai ini. */
  left: number;
  right: number;
}

/** Gaya siap pakai: `opacity` + `dashed` (pola termitigasi/batal → lebih redup + putus). */
export interface ShapeStyle {
  opacity: number;
  dashed: boolean;
  /** Pola garis putus khusus (mis. equal level → titik `1 3`); default `3 3`. */
  dash?: string;
}

export interface SmcShape {
  kind: "box" | "line" | "band";
  x1: number;
  x2: number;
  /** garis: harga level; kotak/pita: tepi atas. */
  y1: number;
  /** kotak/pita: tepi bawah; garis: sama dengan `y1`. */
  y2: number;
  tone: "up" | "down" | "border";
  label?: string;
  style: ShapeStyle;
}

/** Teks wajib legenda: kedua lapisan konteks tidak boleh terbaca sebagai sinyal (docs/06 §6.7). */
export function layerNotice(layer: Layer): string | null {
  return layer === "indicators" ? null : "lapisan konteks, bukan sinyal";
}

const box = (x1: number, x2: number, y1: number, y2: number, tone: SmcShape["tone"], style: ShapeStyle, label?: string): SmcShape => ({
  kind: "box",
  x1,
  x2,
  y1: Math.min(y1, y2),
  y2: Math.max(y1, y2),
  tone,
  label,
  style,
});

/**
 * SMC → bentuk siap render (docs/06 §6.7): BOS/CHoCH garis putus + label, order block kotak
 * `--up`/`--down` (termitigasi lebih redup + putus), FVG kotak `--border`, equal level garis
 * titik + label `N×`, premium/discount dua pita + garis tengah 50%. Semua opacity dari sini —
 * komponen tidak menghitung gaya sendiri.
 */
export function smcShapes(smc: SmcLayers | undefined, scale: ShapeScale): SmcShape[] {
  if (!smc) return [];
  const shapes: SmcShape[] = [];
  const push = (shape: SmcShape) => {
    if (Number.isFinite(shape.x1) && Number.isFinite(shape.x2)) shapes.push(shape);
  };

  for (const { list, label } of [
    { list: smc.bos, label: "BOS" },
    { list: smc.choch, label: "CHoCH" },
  ]) {
    for (const point of list) {
      const x = scale.x(point.date);
      if (x === null) continue;
      push({ kind: "line", x1: x, x2: scale.right, y1: scale.y(point.level), y2: scale.y(point.level), tone: "border", label, style: { opacity: 1, dashed: true } });
    }
  }

  for (const block of smc.order_blocks) {
    push(
      box(
        scale.x(block.from) ?? NaN,
        scale.x(block.to) ?? NaN,
        scale.y(block.high),
        scale.y(block.low),
        block.kind === "bullish" ? "up" : "down",
        block.mitigated ? { opacity: 0.04, dashed: true } : { opacity: 0.08, dashed: false },
      ),
    );
  }

  for (const gap of smc.fvg) {
    push(
      box(
        scale.x(gap.date) ?? NaN,
        scale.right,
        scale.y(gap.high),
        scale.y(gap.low),
        "border",
        gap.mitigated ? { opacity: 0.04, dashed: true } : { opacity: 0.08, dashed: false },
      ),
    );
  }

  for (const level of smc.equal_levels) {
    push({
      kind: "line",
      x1: scale.left,
      x2: scale.right,
      y1: scale.y(level.level),
      y2: scale.y(level.level),
      tone: "border",
      label: `${formatNum(level.count, 0)}×`,
      style: { opacity: 1, dashed: true, dash: "1 3" },
    });
  }

  if (smc.range) {
    const { low, high, premium_from, discount_to } = smc.range;
    push(box(scale.left, scale.right, scale.y(high), scale.y(premium_from), "up", { opacity: 0.04, dashed: false }, "premium"));
    push(box(scale.left, scale.right, scale.y(discount_to), scale.y(low), "down", { opacity: 0.04, dashed: false }, "discount"));
    push({
      kind: "line",
      x1: scale.left,
      x2: scale.right,
      y1: scale.y((high + low) / 2),
      y2: scale.y((high + low) / 2),
      tone: "border",
      label: "50%",
      style: { opacity: 1, dashed: true },
    });
  }

  return shapes;
}

export interface ElliottShape {
  kind: "zigzag" | "label" | "fib";
  points?: { x: number; y: number }[];
  x?: number;
  y?: number;
  label?: string;
  style: ShapeStyle;
}

/**
 * Elliott → ZigZag + label wave + zona Fib (docs/06 §6.7). Pola `invalidated` digambar
 * putus-putus + opacity 0,5; `note` dari API ditampilkan apa adanya di legenda.
 */
export function elliottShapes(elliott: ElliottLayers | undefined, scale: ShapeScale): ElliottShape[] {
  if (!elliott) return [];
  const shapes: ElliottShape[] = [];
  const zigStyle: ShapeStyle = elliott.invalidated ? { opacity: 0.5, dashed: true } : { opacity: 1, dashed: false };

  const points = elliott.zigzag
    .map((pivot) => {
      const x = scale.x(pivot.date);
      return x === null ? null : { x, y: scale.y(pivot.price) };
    })
    .filter((point): point is { x: number; y: number } => point !== null);
  if (points.length > 1) shapes.push({ kind: "zigzag", points, style: zigStyle });

  for (const wave of elliott.waves) {
    const x = scale.x(wave.to);
    if (x === null) continue;
    shapes.push({ kind: "label", x, y: scale.y(wave.price_to), label: wave.label, style: zigStyle });
  }

  for (const zone of elliott.fib_zones) {
    shapes.push({
      kind: "fib",
      x: scale.right,
      y: scale.y(zone.level),
      label: `${formatNum(zone.ratio * 100, 1)}%`,
      style: { opacity: 1, dashed: true },
    });
  }

  return shapes;
}

// ── F23: zoom & pan (docs/06 §6.8) ──────────────────────────────────────────

/** Rentang bar yang terlihat: `[start, end)` dalam indeks `candles`. */
export interface ViewRange {
  start: number;
  end: number;
}

/** Minimal 20 bar terlihat (docs/06 §6.8); data < 20 bar tidak bisa di-zoom. */
export const MIN_ZOOM_BARS = 20;

/** Zoom dianggap "dalam" saat ≤ 2/3 data terlihat — pan vertikal baru berguna (docs/06 §6.8). */
export const DEEP_ZOOM_RATIO = 2 / 3;

export function clampRange(range: ViewRange, total: number): ViewRange {
  if (total <= MIN_ZOOM_BARS) return { start: 0, end: total };
  const width = Math.min(Math.max(MIN_ZOOM_BARS, Math.round(range.end - range.start)), total);
  const start = Math.max(0, Math.min(total - width, Math.round(range.start)));
  return { start, end: start + width };
}

/** `null` = seluruh data (keadaan awal). */
export function visibleRange(state: ViewRange | null, total: number): ViewRange {
  return state === null ? { start: 0, end: total } : clampRange(state, total);
}

/**
 * Zoom dengan **titik jangkar di kursor** (docs/06 §6.8): `factor < 1` = memperbesar, dan bar di
 * bawah kursor tetap di posisi yang sama. Selalu dijepit ke `MIN_ZOOM_BARS` & tepi data.
 */
export function zoomAt(state: ViewRange | null, total: number, factor: number, anchorIndex: number): ViewRange {
  const current = visibleRange(state, total);
  const width = current.end - current.start;
  const nextWidth = Math.min(Math.max(MIN_ZOOM_BARS, Math.round(width * factor)), total);
  const anchor = Math.max(current.start, Math.min(current.end - 1, anchorIndex));
  const ratio = width <= 1 ? 0.5 : (anchor - current.start) / width;
  const start = Math.round(anchor - ratio * nextWidth);
  return clampRange({ start, end: start + nextWidth }, total);
}

/** Geser rentang sejumlah bar; dijepit ke tepi data (docs/06 §6.8). */
export function panBy(state: ViewRange | null, total: number, deltaBars: number): ViewRange {
  const current = visibleRange(state, total);
  return clampRange({ start: current.start + deltaBars, end: current.end + deltaBars }, total);
}

/** Benar saat rentang terlihat cukup sempit untuk pan vertikal (> 1,5×, docs/06 §6.8). */
export function deepZoom(state: ViewRange | null, total: number): boolean {
  const current = visibleRange(state, total);
  return total > MIN_ZOOM_BARS && current.end - current.start <= total * DEEP_ZOOM_RATIO;
}

/** Sumbu harga digeser sesuai pan vertikal: `fraction` negatif = domain naik (harga tampak turun). */
export function shiftDomain(domain: { min: number; max: number }, fraction: number): { min: number; max: number } {
  if (fraction === 0) return domain;
  const span = domain.max - domain.min;
  const delta = span * Math.max(-1, Math.min(1, fraction));
  return { min: domain.min + delta, max: domain.max + delta };
}

/** Teks `aria-live` rentang terlihat (docs/08 F23): `12 Agu – 9 Okt, 40 bar`. */
export function visibleLabel(dates: string[]): string {
  if (dates.length === 0) return "tidak ada bar terlihat";
  const short = (date: string) => {
    const parsed = new Date(`${date}T00:00:00+07:00`);
    return Number.isNaN(parsed.getTime())
      ? date
      : new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" }).format(parsed);
  };
  return `${short(dates[0])} – ${short(dates[dates.length - 1])}, ${formatNum(dates.length, 0)} bar`;
}
