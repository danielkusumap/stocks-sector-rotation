import { SECTOR_SORTS, type Dir, type SectorSort } from "./api";

/** Kolom tabel sektor boleh diurutkan hanya lewat kunci yang ada di `/sectors/summary`. */
export function sectorSortOf(sort: string): SectorSort {
  return (SECTOR_SORTS as readonly string[]).includes(sort) ? (sort as SectorSort) : "score";
}

export interface SectorColumn {
  key: string;
  label: string;
  /** kunci `sort` yang diterima `/sectors/summary` (docs/05 §2); `null` = header tidak bisa diklik. */
  sort: SectorSort | null;
  align: "left" | "right";
  hint?: string;
}

/**
 * Kolom `SectorTable` (docs/06 §5). Yang bisa diklik hanya kolom yang punya padanan di
 * `sort` `/sectors/summary` — tabel ini dipaginasi, jadi mengurutkan di frontend akan salah.
 */
export const SECTOR_COLUMNS: readonly SectorColumn[] = [
  { key: "sector", label: "Sektor", sort: null, align: "left" },
  { key: "quadrant", label: "Kuadran", sort: null, align: "left" },
  { key: "age", label: "Umur", sort: null, align: "right", hint: "jumlah periode di kuadran sekarang" },
  { key: "rs_ratio", label: "RS-Ratio", sort: "rs_ratio", align: "right" },
  { key: "rs_momentum", label: "RS-Mom", sort: "rs_momentum", align: "right" },
  { key: "delta", label: "Δ1p", sort: null, align: "right", hint: "perubahan RS-Ratio 1 periode" },
  // 1M = 1 minggu, 1B = 1 bulan (skema singkatan docs/06 §5); nilainya ret_1w/ret_1m/ret_3m
  { key: "ret_1w", label: "1M", sort: "ret_1w", align: "right", hint: "return 1 minggu" },
  { key: "ret_1m", label: "1B", sort: "ret_1m", align: "right", hint: "return 1 bulan" },
  { key: "ret_3m", label: "3B", sort: null, align: "right", hint: "return 3 bulan" },
  { key: "turnover", label: "Turnover", sort: "turnover", align: "right", hint: "turnover periode aktif (filter likuiditas memakai median 20 hari)" },
  { key: "streak", label: "Streak", sort: null, align: "right", hint: "minggu berturut-turut masuk sinyal" },
  { key: "score", label: "Skor", sort: "score", align: "right" },
];

/** Klik header: kolom lain → `desc`, kolom yang sama → balik arah (docs/08 F5). */
export function nextSort(
  current: { sort: string; dir: Dir },
  column: SectorColumn,
): { sort: SectorSort; dir: Dir } | null {
  if (!column.sort) return null;
  if (current.sort !== column.sort) return { sort: column.sort, dir: "desc" };
  return { sort: column.sort, dir: current.dir === "desc" ? "asc" : "desc" };
}
