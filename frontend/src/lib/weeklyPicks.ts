import type { WeeklyPlan, WeeklySectorPick, WeeklyStockPick } from "./api";
import { parseIso } from "./calendar";
import { formatDate, formatNum, formatPct, formatRp } from "./format";
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
  /** `false` = key baru dari backend: label = key apa adanya, gaya netral (docs/08 F11). */
  known: boolean;
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

/** Key baru dari backend tidak boleh hilang: label = key apa adanya, gaya netral. */
function foreignRows(
  entries: [string, unknown][],
  known: readonly string[],
): RuleRow[] {
  return entries
    .filter(([key, value]) => !known.includes(key) && typeof value === "boolean")
    .map(([key, value]) => ({ key, label: key, ok: value as boolean, known: false }));
}

/** SEMUA `rule_hits` apa adanya — yang `false` ikut tampil (docs/08 F9 AC). */
export function ruleRows(
  hits: WeeklySectorPick["rule_hits"] | WeeklyStockPick["rule_hits"],
): RuleRow[] {
  const entries = Object.entries(hits) as [string, unknown][];
  if ("quadrant" in hits) {
    const sectorKeys = SECTOR_RULES.map(([key]) => key);
    return [
      {
        key: "quadrant",
        label: `kuadran ${QUADRANT_LABEL[hits.quadrant]}`,
        ok: null,
        known: true,
      },
      ...SECTOR_RULES.map(([key, label]) => ({ key, label, ok: hits[key], known: true })),
      ...foreignRows(entries, ["quadrant", ...sectorKeys]),
    ];
  }
  return [
    ...STOCK_RULES.map(([key, label]) => ({ key, label, ok: hits[key], known: true })),
    ...foreignRows(
      entries,
      STOCK_RULES.map(([key]) => key),
    ),
  ];
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

// ── Trading plan (`docs/06` §5.2, `docs/05` §3 `api_version` 1.2) ─────────────
// Semua angka (level, %, R:R, peluang) datang dari API; di sini hanya label Indonesia.

/** Nama rezim untuk badge (`docs/06` §5.2). */
export const REGIME_LABEL: Record<string, string> = {
  tren_naik: "Tren naik",
  range: "Range",
  turun: "Turun",
  tipis: "Likuiditas tipis",
};

/** Tona badge rezim: netral untuk tren, `warn` untuk range/tipis, `down` untuk turun. */
export function regimeTone(regime: string): "neutral" | "warn" | "down" {
  if (regime === "turun") return "down";
  if (regime === "range" || regime === "tipis") return "warn";
  return "neutral";
}

/** Alat utama dalam kalimat user (`docs/06` §5.2) — nama mentah tidak boleh tampil. */
export const TOOL_LABEL: Record<string, string> = {
  pullback_ma20: "pantulan ke penyangga 20 hari",
  breakout_donchian: "tembus puncak 20 hari",
  sr_channel: "pantulan di kanal penyangga–penahan",
  pivot_level: "level pivot",
  none: "tidak ada",
};

export const CONFIRM_LABEL: Record<string, string> = {
  volume: "volume di atas rata-rata 20 hari",
  rsi_tepi_range: "momentum di tepi bawah rentang",
  none: "tanpa konfirmasi",
};

export function toolLabel(tool: string | null | undefined): string {
  if (!tool) return "—";
  return TOOL_LABEL[tool] ?? tool;
}

export function confirmLabel(tool: string | null | undefined): string {
  if (!tool) return "—";
  return CONFIRM_LABEL[tool] ?? tool;
}

export interface PlanRow {
  key: string;
  label: string;
  value: string;
  reason: string;
}

/** `null` → `—`; dipakai untuk level harga plan (rupiah, tanpa desimal). */
function level(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : formatRp(value);
}

/** Satu baris `level (pct)`; `pct` memang perubahan dari entry → pakai `formatPct` (bertanda). */
function levelPct(value: number | null | undefined, pct: number | null | undefined): string {
  return `${level(value)} (${formatPct(pct)})`;
}

/** R:R bersih biaya dari API, 2 desimal; `null` → `—`. */
function rrText(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${formatNum(value, 2)}:1`;
}

/**
 * Baris ringkas pick (`docs/06` §5.2): `zona … · SL … · TP1 … · TP2 … · R:R …`.
 * `no_trade` → satu kalimat tanpa angka level.
 */
export function planSummary(plan: WeeklyPlan | null | undefined): string | null {
  if (!plan) return null;
  if (plan.entry_mode === "no_trade") return noTradeSentence(plan);
  const parts = [
    `zona ${level(plan.entry_zone.low)}–${level(plan.entry_zone.high)}`,
    `SL ${levelPct(plan.stop.level, plan.stop.pct)}`,
    `TP1 ${levelPct(plan.tp1.level, plan.tp1.pct)}`,
    `TP2 ${levelPct(plan.tp2.level, plan.tp2.pct)}`,
    `R:R ${rrText(plan.tp2.rr ?? plan.tp1.rr)}`,
  ];
  return parts.join(" · ");
}

/** Kalimat tunggal untuk `entry_mode = no_trade` (alasannya dari `notes`/rezim). */
export function noTradeSentence(plan: WeeklyPlan): string {
  const reason = plan.notes[0] ?? `rezim ${REGIME_LABEL[plan.regime] ?? plan.regime}`;
  return `tidak ada rencana beli (${reason.replace(/\.$/, "").toLowerCase()})`;
}

/** Urutan baris blok plan = `docs/06` §5.2 no. 1–6; alasan tiap elemen dari API. */
export function planRows(plan: WeeklyPlan | null | undefined): PlanRow[] {
  if (!plan) return [];
  const rows: PlanRow[] = [
    {
      key: "tool",
      label: "Alat utama",
      value: toolLabel(plan.entry_tool),
      reason: plan.entry_tool_reason ?? plan.entry_zone.reason,
    },
    {
      key: "confirm",
      label: "Konfirmasi",
      value: confirmLabel(plan.confirm_tool),
      reason: plan.confirm_reason ?? "",
    },
    {
      key: "zone",
      label: "Zona entry",
      value: `${level(plan.entry_zone.low)}–${level(plan.entry_zone.high)}`,
      reason: plan.entry_zone.reason,
    },
    {
      key: "stop",
      label: "Batas rugi",
      value: `${levelPct(plan.stop.level, plan.stop.pct)}${plan.stop.basis ? ` · ${plan.stop.basis.replace(/_/g, " ")}` : ""}`,
      reason: plan.stop.reason,
    },
    {
      key: "tp1",
      label: "Target 1",
      value: `${levelPct(plan.tp1.level, plan.tp1.pct)} · R:R ${rrText(plan.tp1.rr)}`,
      reason: plan.tp1.reason,
    },
    {
      key: "tp2",
      label: "Target 2",
      value: `${levelPct(plan.tp2.level, plan.tp2.pct)} · R:R ${rrText(plan.tp2.rr)}`,
      reason: plan.tp2.reason,
    },
    {
      key: "hold",
      label: "Ekspektasi lama tahan",
      value: holdText(plan.hold),
      reason: plan.hold.reason,
    },
  ];
  if (plan.invalidation) {
    rows.push({ key: "invalidation", label: "Skenario batal", value: plan.invalidation, reason: "" });
  }
  return rows;
}

/** `median 7 bar · TP1 kena 62% · TP2 kena 34%`; riwayat kurang → "belum cukup riwayat". */
export function holdText(hold: WeeklyPlan["hold"]): string {
  if (hold.hit_tp1 === null || hold.hit_tp1 === undefined) return "belum cukup riwayat";
  const parts: string[] = [];
  if (hold.median_periods !== null && hold.median_periods !== undefined) {
    parts.push(`median ${formatNum(hold.median_periods, 0)} bar`);
  }
  parts.push(`TP1 kena ${chance(hold.hit_tp1)}`);
  if (hold.hit_tp2 !== null && hold.hit_tp2 !== undefined) parts.push(`TP2 kena ${chance(hold.hit_tp2)}`);
  if (hold.n_events !== null && hold.n_events !== undefined) {
    parts.push(`dari ${formatNum(hold.n_events, 0)} breakout`);
  }
  return parts.join(" · ");
}

/** Peluang historis **tanpa tanda** (`62%`), bukan `+62%` (docs/06 §5.2). */
export function chance(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${formatNum(value * 100, 0)}%`;
}

/** Label keadaan plan: `perlu ditinjau` saat `plan_ok=false`, `tidak ada rencana beli` saat `no_trade`. */
export function planStateLabel(plan: WeeklyPlan | null | undefined): string | null {
  if (!plan) return null;
  if (plan.entry_mode === "no_trade") return "tidak ada rencana beli";
  if (!plan.plan_ok) return "perlu ditinjau";
  return null;
}
