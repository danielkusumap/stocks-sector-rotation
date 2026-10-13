import type { WeeklySectorPick, WeeklyStockPick } from "./api";
import { parseIso } from "./calendar";
import { formatDate } from "./format";
import { QUADRANT_LABEL } from "./quadrant";

/**
 * Halaman Weekly: parameter URL, daftar pekan, dan `rule_hits` apa adanya.
 * Semua angka datang dari API — di sini hanya bentuk tampilan yang dirakit
 * (docs/08 aturan 1: tidak ada rumus finansial di frontend).
 */

export const WEEKLY_DEFAULT_MIN_STREAK = 1; // docs/06 §7: default halaman Weekly = 1
export const WEEKLY_DEFAULT_SCOPE = "sector,stock";
export type WeeklyScope = "sector" | "stock" | "sector,stock";

/** Urutan opsi mengikuti panel: keduanya dulu, baru satu blok. */
export const WEEKLY_SCOPES: readonly WeeklyScope[] = ["sector,stock", "sector", "stock"];

export const WEEKLY_SCOPE_LABEL: Record<WeeklyScope, string> = {
  "sector,stock": "Sektor & saham",
  sector: "Sektor saja",
  stock: "Saham saja",
};

export interface WeeklyParams {
  /** `null` = biarkan backend memilih minggu final terakhir (docs/05 §3). */
  week_end: string | null;
  min_streak: number;
  scope: WeeklyScope;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Filter halaman Weekly hidup di URL seperti filter lain (docs/08 aturan 4). */
export function readWeeklyParams(search: URLSearchParams): WeeklyParams {
  const weekEnd = search.get("week_end");
  const raw = search.get("min_streak");
  const value = raw === null || raw === "" ? WEEKLY_DEFAULT_MIN_STREAK : Number(raw);
  const scope = search.get("scope") ?? "";
  return {
    week_end: weekEnd !== null && DATE_RE.test(weekEnd) ? weekEnd : null,
    min_streak: Number.isFinite(value)
      ? Math.min(Math.max(Math.trunc(value), 0), 8)
      : WEEKLY_DEFAULT_MIN_STREAK,
    scope: (WEEKLY_SCOPES as readonly string[]).includes(scope)
      ? (scope as WeeklyScope)
      : WEEKLY_DEFAULT_SCOPE,
  };
}

/** Tulis balik ke URL: nilai default dibuang, kunci lain (mis. `mock` di dev) dibiarkan. */
export function writeWeeklyParams(
  search: URLSearchParams,
  patch: Partial<WeeklyParams>,
): URLSearchParams {
  const next = { ...readWeeklyParams(search), ...patch };
  const params = new URLSearchParams(search);
  const values: Record<string, string | null> = {
    week_end: next.week_end,
    min_streak: next.min_streak === WEEKLY_DEFAULT_MIN_STREAK ? null : String(next.min_streak),
    scope: next.scope === WEEKLY_DEFAULT_SCOPE ? null : next.scope,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  return params;
}

export interface RuleRow {
  key: string;
  label: string;
  /** `null` = baris informasi (kuadran), bukan aturan yang bisa lolos/gagal. */
  ok: boolean | null;
}

// Label Indonesia dari nama aturan docs/03 §6.1 & §6.2. Ambangnya tidak ditulis
// karena berasal dari config (docs/08 aturan 1).
type SectorRuleKey = Exclude<keyof WeeklySectorPick["rule_hits"], "quadrant">;

const SECTOR_RULES: readonly (readonly [SectorRuleKey, string])[] = [
  ["age_ok", "umur kuadran ≥ 2 periode dan sudah Memimpin/Membaik sebelumnya"],
  ["momentum_ok", "RS-Momentum > 100 dan masih naik"],
  ["ret_4w_ok", "return 4 minggu > 0"],
  ["constituents_ok", "konstituen ≥ 3 saham"],
];

const STOCK_RULES: readonly (readonly [keyof WeeklyStockPick["rule_hits"], string])[] = [
  ["liquidity_ok", "likuiditas: median turnover 20 hari ≥ ambang config"],
  ["price_ok", "harga ≥ ambang minimum config"],
  ["trend_ok", "tren: close > SMA20 > SMA50"],
  ["rs_ok", "RS-Ratio saham vs sektornya > 100"],
  ["momentum_ok", "momentum: return 5 hari > 0"],
  ["rsi_ok", "RSI(14) di bawah ambang overbought"],
  ["no_suspension", "tidak suspend (ada bar di 5 hari bursa terakhir)"],
];

/** SEMUA `rule_hits` apa adanya — yang `false` ikut tampil (docs/08 F9 AC). */
export function ruleRows(
  hits: WeeklySectorPick["rule_hits"] | WeeklyStockPick["rule_hits"],
): RuleRow[] {
  if ("quadrant" in hits) {
    return [
      { key: "quadrant", label: `kuadran ${QUADRANT_LABEL[hits.quadrant]}`, ok: null },
      ...SECTOR_RULES.map(([key, label]) => ({ key, label, ok: hits[key] })),
    ];
  }
  return STOCK_RULES.map(([key, label]) => ({ key, label, ok: hits[key] }));
}

const DAY_MS = 86_400_000;
const JAKARTA = "Asia/Jakarta"; // zona waktu tunggal aplikasi (AGENTS.md aturan 8)

function utcTime(iso: string): number | null {
  const parts = parseIso(iso);
  return parts ? Date.UTC(parts.year, parts.month, parts.day) : null;
}

function isoOf(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** `'2026-10-09'` → `'2026-10-05'` (Senin pekan itu); `null` kalau bukan ISO. */
export function weekStart(weekEnd: string): string | null {
  const time = utcTime(weekEnd);
  return time === null ? null : isoOf(time - 4 * DAY_MS);
}

/** Jumat pekan yang memuat tanggal ini — pekan berjalan belum punya sinyal final. */
export function weekEndOf(iso: string): string | null {
  const time = utcTime(iso);
  if (time === null) return null;
  const sinceMonday = (new Date(time).getUTCDay() + 6) % 7;
  return isoOf(time - sinceMonday * DAY_MS + 4 * DAY_MS);
}

/** `'2026-10-09'` → `'6–10 Okt 2026'` (tanggal diformat oleh lib/format). */
export function weekRangeLabel(weekEnd: string): string {
  const start = weekStart(weekEnd);
  const from = start ? parseIso(start) : null;
  const to = parseIso(weekEnd);
  if (!from || !to) return weekEnd;
  // beda bulan → tulis bulan keduanya, jangan "28–1 Agu"
  return `${from.month === to.month ? from.day : formatDate(start)}–${formatDate(weekEnd)}`;
}

/** Hari ini di zona Asia/Jakarta; `en-CA` memberi bentuk ISO langsung. */
export function jakartaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: JAKARTA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export interface WeekOption {
  value: string;
  label: string;
  final: boolean;
}

function isFriday(iso: string): boolean {
  const time = utcTime(iso);
  return time !== null && new Date(time).getUTCDay() === 5;
}

/**
 * Opsi pemilih pekan: pekan berjalan (belum final) di atas, lalu Jumat yang sudah
 * punya hasil hitung. `dates` dari `meta/dates?timeframe=w1_fri` — disaring ke Jumat
 * supaya tanggal harian (kalau backend mengirimnya) tidak ikut jadi opsi.
 */
export function weekOptions({
  dates,
  running,
  selected,
}: {
  dates: readonly string[];
  running: string | null;
  selected: string | null;
}): WeekOption[] {
  const finals = [...new Set(dates.filter(isFriday))].sort().reverse();
  // pekan yang sedang dipilih tapi belum ada di daftar hasil hitung: tetap bisa dipilih ulang
  if (selected && selected !== running && !finals.includes(selected)) finals.unshift(selected);
  const options: WeekOption[] = finals.map((value) => ({
    value,
    label: `pekan ${weekRangeLabel(value)}`,
    final: true,
  }));
  if (running && !finals.includes(running)) {
    options.unshift({
      value: running,
      label: `pekan ${weekRangeLabel(running)} — belum final`,
      final: false,
    });
  }
  return options;
}
