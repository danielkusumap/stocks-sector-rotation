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

/** Pencarian legenda baru perlu muncul kalau entri banyak (docs/06 §6.2: lebih dari 12). */
export const LEGEND_SEARCH_MIN = 12;

export function legendNeedsSearch(count: number): boolean {
  return count > LEGEND_SEARCH_MIN;
}

/**
 * Entri legenda (docs/06 §6.2). Urutannya **sama dengan urutan chart & Tab** (pemanggil
 * sudah mengurutkan lewat `orderedItems`); pencarian hanya menyaring legenda, tidak
 * mengubah data chart.
 */
export function legendEntries(items: RrgItem[], query = ""): RrgItem[] {
  const needle = query.trim().toLocaleLowerCase("id-ID");
  if (!needle) return items;
  return items.filter((item) =>
    `${item.name} ${item.ref_id}`.toLocaleLowerCase("id-ID").includes(needle),
  );
}

// ── Posisi kartu hover (docs/06 §6.3) ────────────────────────────────────────
// Kartu TIDAK BOLEH menutupi ekor & arah gerak titik yang sedang dibaca. Offset tetap
// (+12px/-50%) selalu menutupi ekor di salah satu sisi chart, jadi sisinya dihitung dari
// datanya sendiri: arah gerak = vektor `tail[-2] → tail[-1]`, kartu diletakkan **searah
// gerak** (sisi yang baru ditinggalkan titik, jadi berlawanan dengan ekor).
// Semua satuan viewBox; pemanggil mengonversi px → viewBox (`/scale`) dan ukuran kartu
// diukur dari DOM (lebar `w-60` = 240 px, tinggi tergantung isi).

/** Lebar kartu (`w-60`) — dipakai sebelum kartu sempat diukur. */
export const CARD_WIDTH_PX = 240;
/** Perkiraan tinggi kartu sebelum diukur (7 baris metrik + 2 tautan). */
export const CARD_HEIGHT_PX = 196;
/** Jarak kartu dari titik & tepi minimum ke kotak chart (docs/06 §6.3). */
export const CARD_GAP_PX = 12;
export const CARD_MARGIN_PX = 8;

export type CardSide = "right" | "left" | "bottom" | "top";

/** Vektor arah tiap sisi (y ke bawah, seperti SVG). */
export const CARD_SIDE_VECTOR: Record<CardSide, { x: number; y: number }> = {
  right: { x: 1, y: 0 },
  left: { x: -1, y: 0 },
  bottom: { x: 0, y: 1 },
  top: { x: 0, y: -1 },
};

export interface CardPlacement {
  side: CardSide;
  /** sisi pilihan kurang ruang → dibalik ke sisi seberang pada sumbu itu */
  flipped: boolean;
  /** sudut kiri-atas kartu di satuan viewBox, sudah dijepit di dalam kotak chart */
  x: number;
  y: number;
}

export interface CardPlacementInput {
  /** titik aktif (viewBox) */
  point: { x: number; y: number };
  /** `tail[-2]` — arah gerak; `null` saat warmup (ekor < 2 titik) */
  previous: { x: number; y: number } | null;
  /** kotak chart (viewBox) yang tidak boleh dilewati kartu */
  box: { x0: number; y0: number; x1: number; y1: number };
  /** ukuran kartu (viewBox) */
  card: { w: number; h: number };
  gap?: number;
  margin?: number;
  /** jari-jari titik + ring (viewBox) — kartu tidak boleh menutupi titiknya sendiri */
  pointRadius?: number;
  /** titik ekor (viewBox, tanpa titik terakhir) yang tidak boleh tertutup kartu */
  tail?: readonly { x: number; y: number }[];
}

/** Sisi dominan kartu relatif ke titik (label debug & test). */
export function cardSideOf(
  dx: number,
  dy: number,
  box: { x0: number; y0: number; x1: number; y1: number },
  point: { x: number; y: number },
): CardSide {
  if (dx === 0 && dy === 0) {
    // tanpa gerak: sisi menjauhi pusat chart, sumbu dengan jarak relatif terbesar
    const rx = (point.x - (box.x0 + box.x1) / 2) / Math.max(1, (box.x1 - box.x0) / 2);
    const ry = (point.y - (box.y0 + box.y1) / 2) / Math.max(1, (box.y1 - box.y0) / 2);
    if (Math.abs(rx) >= Math.abs(ry)) return rx >= 0 ? "right" : "left";
    return ry >= 0 ? "bottom" : "top";
  }
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "bottom" : "top";
}

const rect = (x: number, y: number, card: { w: number; h: number }) => ({
  x,
  y,
  w: card.w,
  h: card.h,
});

const insideRect = (p: { x: number; y: number }, r: ReturnType<typeof rect>) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** Apakah segmen menyentuh kotak? (dicuplik — cukup untuk keputusan tampilan) */
export function segmentHitsRect(
  from: { x: number; y: number },
  to: { x: number; y: number },
  r: ReturnType<typeof rect>,
  samples = 24,
): boolean {
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    if (insideRect({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, r)) {
      return true;
    }
  }
  return false;
}

/**
 * Titik kiri-atas kartu. Kartu dicoba di empat sisi (urut: **searah gerak** dulu, lalu
 * sumbu tegak lurus, terakhir sisi seberang) dan yang dipakai adalah kandidat yang
 * (a) muat di dalam kotak chart, (b) tidak menutupi titiknya sendiri, dan (c) paling
 * sedikit menyentuh ekor titik itu. Jadi "flip" di docs/06 §6.3 tetap berlaku untuk
 * sumbu yang tidak cukup ruang, tapi tidak pernah menukar kartu ke atas ekornya sendiri
 * (ADR-041) — penting karena kartu `w-60` selebar ⅓ chart.
 */
export function cardPlacement({
  point,
  previous,
  box,
  card,
  gap = CARD_GAP_PX,
  margin = CARD_MARGIN_PX,
  pointRadius = POINT_RADIUS + FOCUS_RING_WIDTH,
  tail = [],
}: CardPlacementInput): CardPlacement {
  const dx = previous ? point.x - previous.x : 0;
  const dy = previous ? point.y - previous.y : 0;
  const sx = Math.abs(dx) > 0.001 ? Math.sign(dx) : 0;
  const sy = Math.abs(dy) > 0.001 ? Math.sign(dy) : 0;
  const preferred = cardSideOf(sx, sy, box, point);

  const minX = box.x0 + margin;
  const minY = box.y0 + margin;
  const maxX = box.x1 - margin - card.w;
  const maxY = box.y1 - margin - card.h;
  const clamp = (value: number, min: number, max: number) =>
    max < min ? min : Math.min(Math.max(value, min), max);

  // kandidat: sisi searah gerak dulu (dot positif terbesar), lalu tegak lurus, terakhir seberang
  const sides: readonly CardSide[] = ["right", "left", "bottom", "top"];
  const ordered = [...sides].sort(
    (a, b) =>
      CARD_SIDE_VECTOR[b].x * dx +
        CARD_SIDE_VECTOR[b].y * dy -
        (CARD_SIDE_VECTOR[a].x * dx + CARD_SIDE_VECTOR[a].y * dy) ||
      sides.indexOf(a) - sides.indexOf(b),
  );

  const at = (side: CardSide): { x: number; y: number } => {
    if (side === "right") return { x: point.x + gap, y: point.y - card.h / 2 };
    if (side === "left") return { x: point.x - gap - card.w, y: point.y - card.h / 2 };
    if (side === "bottom") return { x: point.x - card.w / 2, y: point.y + gap };
    return { x: point.x - card.w / 2, y: point.y - gap - card.h };
  };

  const inBox = (position: { x: number; y: number }) => ({
    x: clamp(position.x, minX, maxX),
    y: clamp(position.y, minY, maxY),
  });

  const tailHits = (position: { x: number; y: number }) => {
    const r = rect(position.x, position.y, card);
    return tail.reduce(
      (hits, from, index) =>
        hits +
        (segmentHitsRect(from, index + 1 < tail.length ? tail[index + 1] : point, r) ? 1 : 0),
      0,
    );
  };

  const coversPoint = (position: { x: number; y: number }) =>
    point.x >= position.x - pointRadius &&
    point.x <= position.x + card.w + pointRadius &&
    point.y >= position.y - pointRadius &&
    point.y <= position.y + card.h + pointRadius;

  const candidates = ordered.map((side) => {
    const position = inBox(at(side));
    return { side, ...position, covers: coversPoint(position), hits: tailHits(position) };
  });

  const usable = candidates.filter((candidate) => !candidate.covers);
  const pool = usable.length > 0 ? usable : candidates;
  const best = pool.reduce<(typeof candidates)[number]>(
    (acc, candidate) => (candidate.hits < acc.hits ? candidate : acc),
    pool[0],
  );

  return { side: best.side, flipped: best.side !== preferred, x: best.x, y: best.y };
}
