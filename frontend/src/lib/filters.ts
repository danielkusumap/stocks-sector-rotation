import { TIMEFRAMES, WEIGHTINGS, WINDOWS } from "./api";
import type { Quadrant, Timeframe, Weighting, Window } from "./api";
import { formatNum, formatRpCompact } from "./format";
import { QUADRANT_LABEL } from "./quadrant";
import { DEFAULT_FILTERS, type FilterState } from "./urlFilters";

/** Label kontrol filter — teks dari docs/06 §5 & §7 (bahasa Indonesia). */
export const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  d1: "Harian",
  w1: "Mingguan",
  w1_fri: "Mingguan (Sen–Jum)",
  midday: "Tengah Hari",
};

export const WINDOW_LABEL: Record<Window, string> = {
  "1w": "1 mgg",
  "1m": "1 bln",
  "3m": "3 bln",
  "6m": "6 bln",
  "1y": "1 thn",
  ytd: "YTD",
};

export const WEIGHTING_LABEL: Record<Weighting, string> = {
  equal: "Equal",
  turnover: "Turnover",
  captier: "Cap-tier",
};

/** Opsi kontrol (dipakai topbar di `AppShell` & `FilterBar`) — satu sumber, tanpa duplikat. */
export const TIMEFRAME_OPTIONS = TIMEFRAMES.map((value) => ({ value, label: TIMEFRAME_LABEL[value] }));
export const WINDOW_OPTIONS = WINDOWS.map((value) => ({ value, label: WINDOW_LABEL[value] }));
export const WEIGHTING_OPTIONS = WEIGHTINGS.map((value) => ({ value, label: WEIGHTING_LABEL[value] }));

/** Urutan chip kuadran: yang paling sering dicari lebih dulu (docs/06 §7). */
export const QUADRANT_OPTIONS: readonly Quadrant[] = ["leading", "improving", "weakening", "lagging"];

/** Preset likuiditas docs/06 §7: 0 / 1 M / 5 M / 10 M / 50 M. */
export const TURNOVER_PRESETS: readonly { value: number; label: string }[] = [
  { value: 0, label: "0" },
  { value: 1_000_000_000, label: "1 M" },
  { value: 5_000_000_000, label: "5 M" },
  { value: 10_000_000_000, label: "10 M" },
  { value: 50_000_000_000, label: "50 M" },
];

export interface FilterChip {
  key: string;
  label: string;
  /** pengganti saat chip dihapus: satu filter saja, bukan reset semua. */
  patch: Partial<FilterState>;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** Chip filter aktif (docs/06 §5) — chip = nilai yang berbeda dari default. */
export function activeChips(
  filters: FilterState,
  sectorNames: Record<string, string> = {},
): FilterChip[] {
  const chips: FilterChip[] = [];
  const d = DEFAULT_FILTERS;

  if (filters.timeframe !== d.timeframe) {
    chips.push({ key: "timeframe", label: TIMEFRAME_LABEL[filters.timeframe], patch: { timeframe: d.timeframe } });
  }
  if (filters.window !== d.window) {
    chips.push({ key: "window", label: `jendela ${WINDOW_LABEL[filters.window]}`, patch: { window: d.window } });
  }
  if (filters.weighting !== d.weighting) {
    chips.push({ key: "weighting", label: `bobot ${WEIGHTING_LABEL[filters.weighting]}`, patch: { weighting: d.weighting } });
  }
  if (filters.as_of) {
    chips.push({ key: "as_of", label: `per ${filters.as_of}`, patch: { as_of: null } });
  }
  for (const quadrant of filters.quadrant) {
    chips.push({
      key: `quadrant:${quadrant}`,
      label: QUADRANT_LABEL[quadrant],
      patch: { quadrant: filters.quadrant.filter((q) => q !== quadrant) },
    });
  }
  for (const code of filters.sector) {
    chips.push({
      key: `sector:${code}`,
      label: sectorNames[code] ?? code,
      patch: { sector: filters.sector.filter((s) => s !== code) },
    });
  }
  if (filters.min_streak > 0) {
    chips.push({ key: "min_streak", label: `streak ≥ ${filters.min_streak}`, patch: { min_streak: d.min_streak } });
  }
  if (filters.min_turnover_idr !== null) {
    chips.push({
      key: "min_turnover_idr",
      label: `likuiditas ≥ Rp ${formatRpCompact(filters.min_turnover_idr)}`,
      patch: { min_turnover_idr: d.min_turnover_idr },
    });
  }
  if (filters.min_price_idr !== null) {
    chips.push({
      key: "min_price_idr",
      label: `harga ≥ Rp ${formatNum(filters.min_price_idr, 0)}`,
      patch: { min_price_idr: d.min_price_idr },
    });
  }
  if (filters.ret_positive_only) {
    chips.push({ key: "ret_positive_only", label: "return positif", patch: { ret_positive_only: false } });
  }
  if (filters.sort !== d.sort || filters.dir !== d.dir) {
    chips.push({
      key: "sort",
      label: `urut ${filters.sort} ${filters.dir === "asc" ? "↑" : "↓"}`,
      patch: { sort: d.sort, dir: d.dir },
    });
  }
  if (filters.q) {
    chips.push({ key: "q", label: `cari “${filters.q}”`, patch: { q: "" } });
  }
  return chips;
}

/**
 * Kelompok *penyaring* (bukan lingkup): preset mengganti seluruh kelompok ini supaya
 * klik "Pemimpin" lalu "Rotasi aktif" tidak menyisakan streak dari preset sebelumnya.
 */
const FILTER_GROUP: Partial<FilterState> = {
  quadrant: [],
  sector: [],
  min_streak: 0,
  min_turnover_idr: null,
  min_price_idr: null,
  ret_positive_only: false,
  q: "",
  sort: "score",
  dir: "desc",
};

/** Preset cepat docs/06 §7 — hanya menulis URL, tidak menghitung apa pun. */
export const FILTER_PRESETS: readonly { id: string; label: string; patch: Partial<FilterState> }[] = [
  {
    id: "rotasi",
    label: "Rotasi aktif",
    // docs/06 §7 menulis `dir=rs_momentum`; `dir` hanya asc|desc, jadi maksudnya sort=rs_momentum
    patch: { ...FILTER_GROUP, quadrant: ["improving"], sort: "rs_momentum", dir: "desc" },
  },
  {
    id: "pemimpin",
    label: "Pemimpin",
    patch: { ...FILTER_GROUP, quadrant: ["leading"], min_streak: 2 },
  },
  { id: "semua", label: "Semua lingkup", patch: { ...DEFAULT_FILTERS } },
];

export function toggleQuadrant(filters: FilterState, quadrant: Quadrant): Partial<FilterState> {
  return { quadrant: toggle(filters.quadrant, quadrant) };
}

export function toggleSector(filters: FilterState, code: string): Partial<FilterState> {
  return { sector: toggle(filters.sector, code) };
}
