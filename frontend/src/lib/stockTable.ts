import { STOCK_SORTS, type Dir, type StockSort } from "./api";

export interface StockColumn {
  key: string;
  label: string;
  /** kunci `sort` yang diterima `/stocks` (docs/05 §2); `null` = header tidak bisa diklik. */
  sort: StockSort | null;
  align: "left" | "right";
  hint?: string;
}

/**
 * Kolom `StockTable` (docs/06 §5: "kolom seperti `SectorTable` + Ticker, Nama, Harga, RSI, ATR, Skor").
 * Yang bisa diklik hanya kolom yang punya kunci di `STOCK_SORTS` — tabel dipaginasi, jadi
 * mengurutkan di frontend akan salah.
 */
export const STOCK_COLUMNS: readonly StockColumn[] = [
  { key: "ticker", label: "Ticker", sort: "ticker", align: "left" },
  { key: "name", label: "Nama", sort: null, align: "left" },
  { key: "quadrant", label: "Kuadran", sort: null, align: "left" },
  { key: "rs_ratio", label: "RS-Ratio", sort: "rs_ratio", align: "right" },
  {
    key: "rs_momentum",
    label: "RS-Mom",
    sort: null,
    align: "right",
    hint: "RS-Momentum tidak punya kunci urut di /stocks (docs/05 §2)",
  },
  { key: "ret_1d", label: "1H", sort: "ret_1d", align: "right", hint: "return 1 hari" },
  { key: "ret_1w", label: "1M", sort: "ret_1w", align: "right", hint: "return 1 minggu" },
  { key: "close", label: "Harga", sort: null, align: "right" },
  { key: "rsi14", label: "RSI", sort: null, align: "right", hint: "RSI 14 periode" },
  { key: "atr14", label: "ATR", sort: null, align: "right", hint: "ATR 14 periode (rupiah)" },
  { key: "turnover", label: "Turnover 20h", sort: "turnover", align: "right", hint: "median turnover 20 hari" },
  { key: "stock_score", label: "Skor", sort: "stock_score", align: "right" },
  // Kolom insight analisa teknikal (docs/08 F17) — sama seperti `SectorTable`, angka dari
  // `/ta/summary` (satu permintaan per halaman) dan tidak bisa diurutkan dari sini.
  {
    key: "ta_win_rate",
    label: "+5% dulu",
    sort: null,
    align: "right",
    hint: "persen event yang menembus +5% sebelum −5% (backtest MA default config)",
  },
  {
    key: "ta_median",
    label: "Median periode",
    sort: null,
    align: "right",
    hint: "median periode sampai +5% (median, bukan rata-rata)",
  },
  {
    key: "ta_breakout",
    label: "Terakhir breakout",
    sort: null,
    align: "right",
    hint: "tanggal sinyal terakhir · umur sejak entry",
  },
];

/** Hanya kunci yang dikenal `/stocks` boleh dikirim; selain itu jatuh ke `stock_score`. */
export function stockSortOf(sort: string): StockSort {
  return (STOCK_SORTS as readonly string[]).includes(sort) ? (sort as StockSort) : "stock_score";
}

/** Paginasi `limit`/`offset` (docs/05 §2). Semua fungsi murni supaya bisa diuji tanpa DOM. */
export function pageCount(total: number, limit: number): number {
  if (limit <= 0) return 1;
  return Math.max(1, Math.ceil(total / limit));
}

/** Halaman 1-based dari sebuah `offset`. */
export function pageOf(offset: number, limit: number): number {
  if (limit <= 0) return 1;
  return Math.floor(Math.max(0, offset) / limit) + 1;
}

export function offsetOf(page: number, limit: number): number {
  return Math.max(0, (Math.max(1, page) - 1) * limit);
}

/** "11–20 dari 30"; kalau tidak ada baris yang tampil (offset di luar rentang) → "0 dari 30". */
export function rangeLabel(offset: number, shown: number, total: number): string {
  if (total === 0 || shown === 0) return `0 dari ${total}`;
  const from = offset + 1;
  const to = offset + shown;
  return `${from}–${to} dari ${total}`;
}

/** Batas `offset` yang masih valid (klik "berikutnya" tidak boleh melewati halaman terakhir). */
export function clampOffset(offset: number, total: number, limit: number): number {
  const max = (pageCount(total, limit) - 1) * limit;
  return Math.min(Math.max(0, offset), Math.max(0, max));
}

export function nextSort<T extends string>(
  current: { sort: string; dir: Dir },
  column: { sort: T | null },
): { sort: T; dir: Dir } | null {
  if (!column.sort) return null;
  if (current.sort !== column.sort) return { sort: column.sort, dir: "desc" };
  return { sort: column.sort, dir: current.dir === "desc" ? "asc" : "desc" };
}
