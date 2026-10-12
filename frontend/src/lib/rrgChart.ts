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
/** Ambang anti-tumpuk label, dalam satuan viewBox (docs/06 §6: "< 24px"). */
export const MIN_LABEL_DISTANCE = 24;
export const STOCK_SCOPE_LIMIT = 25;

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
 * Titik yang boleh diberi label supaya tidak bertumpuk: ambil berurutan, lewati titik
 * yang lebih dekat dari `minDistance` ke titik yang sudah dipilih (docs/06 §6).
 */
export function labelledRefIds(
  points: readonly { refId: string; x: number; y: number }[],
  minDistance = MIN_LABEL_DISTANCE,
): Set<string> {
  const chosen: { x: number; y: number }[] = [];
  const labels = new Set<string>();
  for (const point of points) {
    const tooClose = chosen.some(
      (other) => Math.hypot(point.x - other.x, point.y - other.y) < minDistance,
    );
    if (tooClose) continue;
    chosen.push({ x: point.x, y: point.y });
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
