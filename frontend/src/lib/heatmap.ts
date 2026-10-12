import type { HeatmapResponse } from "./api";

/** Label kolom heatmap (docs/06 §5): H = hari, M = minggu, B = bulan. */
export const HEATMAP_COLUMN_LABEL: Record<string, string> = {
  "1d": "1H",
  "1w": "1M",
  "1m": "1B",
  "3m": "3B",
};

export const HEATMAP_ALPHA_MIN = 0.08;
export const HEATMAP_ALPHA_MAX = 0.55;

/** Skala grid = |nilai| terbesar, supaya intensitas antar sel bisa dibandingkan (docs/06 §5). */
export function heatmapScale(rows: HeatmapResponse["rows"]): number {
  let max = 0;
  for (const row of rows) {
    for (const value of Object.values(row.values)) {
      if (value !== null && Number.isFinite(value)) max = Math.max(max, Math.abs(value));
    }
  }
  return max;
}

/** Alpha latar sel: 0,08 (nilai terkecil) → 0,55 (nilai terbesar); `null` = tanpa latar. */
export function heatmapAlpha(value: number | null | undefined, scale: number): number {
  if (value === null || value === undefined || !Number.isFinite(value) || scale <= 0) return 0;
  const ratio = Math.min(1, Math.abs(value) / scale);
  return HEATMAP_ALPHA_MIN + ratio * (HEATMAP_ALPHA_MAX - HEATMAP_ALPHA_MIN);
}

/** Token warna arah — warna **selalu** ditemani angka bertanda (docs/06 §9 no.2). */
export function heatmapToken(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return null;
  return value > 0 ? "var(--up)" : "var(--down)";
}

export function heatmapColumnLabel(column: string): string {
  return HEATMAP_COLUMN_LABEL[column] ?? column;
}
