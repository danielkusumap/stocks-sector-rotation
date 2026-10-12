import type { RrgItem } from "./api";
import { formatNum } from "./format";
import { QUADRANT_LABEL } from "./quadrant";

/**
 * Hitungan geometri & aturan tampilan diagram RRG (docs/06 §6 + §6.1).
 * Semua fungsi murni supaya bisa diuji tanpa DOM; komponen hanya menggambar.
 * Tidak ada rumus finansial di sini — kuadran/RS selalu dari API.
 */

export const AXIS_CENTER = 100;
export const POINT_RADIUS = 7;
export const FOCUS_RADIUS = 8;
export const FOCUS_RING_WIDTH = 2;
export const DIM_POINT_OPACITY = 0.22;
export const DIM_TAIL_OPACITY = 0.18;
/** Ambang anti-tumpuk label, dalam **pixel layar** (docs/06 §6). */
export const MIN_LABEL_DISTANCE_PX = 24;

/**
 * Jarak layar (px) → satuan viewBox. Chart digambar dengan `viewBox` tetap lalu
 * diskalakan, jadi ambang 24 px harus dikonversi: `24 / (lebar_render / lebar_viewBox)`.
 */
export function viewBoxDistanceForScreenPx(
  screenPx: number,
  renderedWidthPx: number,
  viewBoxWidth: number,
): number {
  if (renderedWidthPx <= 0) return screenPx;
  return screenPx / (renderedWidthPx / viewBoxWidth);
}
export const STOCK_SCOPE_LIMIT = 25;

/**
 * Perkiraan lebar 1 karakter label (fontSize 11 di satuan viewBox).
 * shortcut: lebar teks diperkirakan, bukan diukur; naikkan ke `getBBox()` kalau ada label bertumpuk.
 */
const LABEL_CHAR_W = 6.4;
const LABEL_DX = 11;
const LABEL_HALF_H = 7;

/** `pad = max(0.6, 1.15 × max|nilai − 100|)` → rentang sumbu selalu memuat 100 & simetris. */
export function axisPad(values: number[]): number {
  const max = values.reduce((acc, value) => Math.max(acc, Math.abs(value - AXIS_CENTER)), 0);
  return Math.max(0.6, 1.15 * max);
}

/** Ticks di 100 dan ±pad × 0.5. */
export function axisTicks(pad: number): number[] {
  return [AXIS_CENTER - pad * 0.5, AXIS_CENTER, AXIS_CENTER + pad * 0.5];
}

export function tickLabel(value: number): string {
  return formatNum(value, Number.isInteger(value) ? 0 : 2);
}

/** Opasitas bertingkat ekor 0.25 → 1.0 ke arah titik terakhir. Ekor 2 titik = rata (tak bisa bertingkat). */
export function tailSegmentOpacity(index: number, points: number): number {
  if (points <= 2) return 1;
  return 0.25 + 0.75 * (index / (points - 2));
}

/** Urutan keyboard & gambar: `rank_score` untuk sektor, skor tertinggi untuk saham. */
export function orderedItems(items: RrgItem[], scope: "sector" | "stock"): RrgItem[] {
  return [...items].sort((a, b) => {
    if (scope === "stock") return (b.score ?? 0) - (a.score ?? 0) || a.ref_id.localeCompare(b.ref_id);
    const rankA = a.rank_score ?? Number.MAX_SAFE_INTEGER;
    const rankB = b.rank_score ?? Number.MAX_SAFE_INTEGER;
    return rankA - rankB || (b.score ?? 0) - (a.score ?? 0);
  });
}

/** Scope saham dibatasi 25 titik skor tertinggi (docs/06 §6.1); sisanya lewat tabel. */
export function cappedItems(
  items: RrgItem[],
  scope: "sector" | "stock",
  limit = STOCK_SCOPE_LIMIT,
): { items: RrgItem[]; hiddenCount: number } {
  if (scope !== "stock" || items.length <= limit) return { items, hiddenCount: 0 };
  return { items: items.slice(0, limit), hiddenCount: items.length - limit };
}

/**
 * Titik yang boleh diberi label supaya tidak bertumpuk (docs/06 §6). Label digambar di
 * kanan titik dan lebarnya ikut panjang nama, jadi yang dibandingkan **kotak label**
 * (lebar ≈ panjang teks), bukan jarak titik. `minDistance` sudah dalam satuan viewBox
 * dan berasal dari ambang pixel layar (`viewBoxDistanceForScreenPx`).
 */
export function labelledRefIds(
  points: readonly { refId: string; x: number; y: number; label: string }[],
  minDistance = MIN_LABEL_DISTANCE_PX,
): Set<string> {
  const gap = minDistance / 2;
  const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const labels = new Set<string>();
  for (const point of points) {
    const x1 = point.x + LABEL_DX - gap;
    const y1 = point.y - LABEL_HALF_H - gap;
    const box = {
      x1,
      y1,
      x2: x1 + point.label.length * LABEL_CHAR_W + minDistance,
      y2: y1 + LABEL_HALF_H * 2 + minDistance,
    };
    const collides = placed.some(
      (other) => box.x1 < other.x2 && other.x1 < box.x2 && box.y1 < other.y2 && other.y1 < box.y2,
    );
    if (collides) continue;
    placed.push(box);
    labels.add(point.refId);
  }
  return labels;
}

/** Satu baris untuk `aria-live`: "Keuangan — Memimpin, RS-Ratio 102,31, RS-Momentum 100,84". */
export function describePoint(item: RrgItem): string {
  return `${item.name} — ${QUADRANT_LABEL[item.quadrant]}, RS-Ratio ${formatNum(item.rs_ratio, 2)}, RS-Momentum ${formatNum(item.rs_momentum, 2)}`;
}

/** Titik yang punya ekor layak gambar (≥ 2 titik); selain itu cukup titiknya saja. */
export function hasTail(item: RrgItem): boolean {
  return item.tail.length >= 2;
}
