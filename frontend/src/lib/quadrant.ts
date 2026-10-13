import { QUADRANTS, type Quadrant } from "./api";

/**
 * Label, keterangan, dan warna kuadran — teks dari `docs/03` §3.
 * Warna selalu dari token tema (ADR-010), bukan hex dari API, supaya ikut berubah
 * saat tema berganti. Dipakai hanya untuk RRG, badge kuadran, dan heatmap (docs/06 §2).
 */
export const QUADRANT_LABEL: Record<Quadrant, string> = {
  leading: "Memimpin",
  weakening: "Melemah",
  lagging: "Tertinggal",
  improving: "Membaik",
};

export const QUADRANT_DESC: Record<Quadrant, string> = {
  leading: "Tren relatif naik dan masih dipercepat.",
  weakening: "Masih di atas pasar, tapi laju mulai berkurang.",
  lagging: "Di bawah pasar dan masih melemah.",
  improving: "Masih di bawah pasar, tapi mulai berbalik naik.",
};

/** Warna garis/titik (memakai token `--q-*`). */
export const QUADRANT_COLOR: Record<Quadrant, string> = {
  leading: "var(--q-leading)",
  weakening: "var(--q-weakening)",
  lagging: "var(--q-lagging)",
  improving: "var(--q-improving)",
};

/** Warna latar lembut (zona chart, sel heatmap kuadran). */
export const QUADRANT_BG: Record<Quadrant, string> = {
  leading: "var(--q-leading-bg)",
  weakening: "var(--q-weakening-bg)",
  lagging: "var(--q-lagging-bg)",
  improving: "var(--q-improving-bg)",
};

export function quadrantLabel(quadrant: Quadrant | null | undefined): string {
  return quadrant ? QUADRANT_LABEL[quadrant] : "—";
}

/**
 * Saring item per kuadran **sebelum** digambar/dikirim (docs/06 §6.4: chip kuadran saham
 * di `SectorDrawer`). `null` = semua (perilaku lama). Item tanpa kuadran (`null`) hanya
 * ikut saat "Semua" — dia tidak bisa diklaim milik salah satu kuadran.
 */
export function filterByQuadrant<T extends { quadrant: Quadrant | null }>(
  items: readonly T[],
  quadrant: Quadrant | null,
): T[] {
  return quadrant === null ? [...items] : items.filter((item) => item.quadrant === quadrant);
}

export function isQuadrant(value: string): value is Quadrant {
  return (QUADRANTS as readonly string[]).includes(value);
}
