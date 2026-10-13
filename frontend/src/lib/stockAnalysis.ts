import type { LevelRow, PlanScenario, StockPlanCoverage } from "./api";
import { formatDate, formatNum, formatRp } from "./format";
import { REGIME_LABEL as PLAN_REGIME_LABEL, chance, noTradeSentence, planStateLabel, regimeTone } from "./weeklyPicks";

/**
 * View-model panel analisa halaman detail saham (docs/06 §5.3, docs/08 F20).
 * **Tidak ada hitungan finansial**: peluang, median, level, dan R:R semuanya dari API
 * (`GET /plan/stock/{ticker}`). Label & tone plan dipakai ulang dari `lib/weeklyPicks.ts`
 * (ADR-051) supaya halaman Weekly dan halaman saham tidak pernah berbeda teks.
 */

/** Label rezim termasuk `tidak_cukup_data` (kasus khusus halaman detail). */
export const REGIME_LABEL: Record<string, string> = {
  ...PLAN_REGIME_LABEL,
  tidak_cukup_data: "Data belum cukup",
};

export { chance, noTradeSentence, planStateLabel, regimeTone };

/** Nama rezim; kode tak dikenal ditampilkan apa adanya (jangan menebak). */
export function regimeLabel(code: string | null | undefined): string {
  if (!code) return "Rezim belum diketahui";
  return REGIME_LABEL[code] ?? code;
}

/** Tona badge rezim: `tidak_cukup_data` netral (bukan peringatan pasar). */
export function regimeToneOf(code: string | null | undefined): "neutral" | "warn" | "down" {
  if (!code || code === "tidak_cukup_data") return "neutral";
  return regimeTone(code);
}

/** `summary_lines` → maksimum 3 baris terisi (docs/06 §5.3: 1–3 baris, bukan bullet panjang). */
export function summaryLines(lines: readonly string[] | undefined): string[] {
  return (lines ?? [])
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 3);
}

export interface ScenarioRow {
  key: string;
  label: string;
  /** Peluang **tanpa tanda** (`62%`, bukan `+62%`) — `formatPct` tidak dipakai di sini. */
  value: string;
}

/** Jumlah event minimum untuk menampilkan skenario (`weekly.plan.min_events_scenario`). */
export const SCENARIO_MIN_EVENTS = 10;

/** Satu baris jujur saat sampel terlalu kecil — menyebut ambangnya, bukan `0%`. */
export function scenarioNote(minEvents: number = SCENARIO_MIN_EVENTS): string {
  return `belum cukup riwayat (butuh ≥ ${formatNum(minEvents, 0)} breakout)`;
}

/**
 * Tabel skenario historis (docs/06 §5.3): `Target 1 kena dulu`, `Batas rugi kena dulu`,
 * `Lewat horizon`, `Target 2 kena dulu` + baris median & jumlah event. `scenario = null`
 * atau `n_events` di bawah ambang → satu baris catatan.
 */
export function scenarioRows(
  scenario: PlanScenario | null | undefined,
  minEvents: number = SCENARIO_MIN_EVENTS,
): ScenarioRow[] {
  if (!scenario || scenario.n_events < minEvents) {
    return [{ key: "short", label: "Skenario historis", value: scenarioNote(minEvents) }];
  }
  const rows: ScenarioRow[] = [
    { key: "tp1", label: "Target 1 kena dulu", value: chance(scenario.p_tp1_first) },
    { key: "sl", label: "Batas rugi kena dulu", value: chance(scenario.p_sl_first) },
    { key: "timeout", label: "Lewat horizon", value: chance(scenario.p_timeout) },
    { key: "tp2", label: "Target 2 kena dulu", value: chance(scenario.p_tp2_first) },
    {
      key: "median",
      label: "Median sampai target",
      value:
        scenario.median_periods_tp1 === null || scenario.median_periods_tp1 === undefined
          ? "—"
          : `${formatNum(scenario.median_periods_tp1, 0)} bar`,
    },
    {
      key: "events",
      label: "Jumlah event",
      value: `${formatNum(scenario.n_events, 0)} breakout${
        scenario.n_open_dikeluarkan > 0 ? `, ${formatNum(scenario.n_open_dikeluarkan, 0)} belum selesai` : ""
      }`,
    },
  ];
  return rows;
}

export interface LevelRowView {
  key: string;
  label: string;
  value: string;
}

/** `levels_table` apa adanya (urutan tetap dari backend): `Zona beli 4.088–4.135`, `Batas rugi 3.991`. */
export function levelsRows(table: readonly LevelRow[] | undefined): LevelRowView[] {
  return (table ?? []).map((row, index) => {
    const value =
      row.low !== null && row.low !== undefined && row.high !== null && row.high !== undefined
        ? `${formatRp(row.low)}–${formatRp(row.high)}`
        : formatRp(row.level);
    return { key: `${row.label}-${index}`, label: row.label, value };
  });
}

/** Catatan cakupan (docs/06 §5.3): jumlah bar, rentang, jumlah event, basis harga + pengingat subset. */
export function coverageTextPlan(coverage: StockPlanCoverage | null | undefined): string {
  if (!coverage) return "cakupan data belum dilaporkan backend.";
  const range =
    coverage.bars_from && coverage.bars_to
      ? `${formatDate(coverage.bars_from)} – ${formatDate(coverage.bars_to)}`
      : "rentang data belum ada";
  const basis = coverage.price_basis === "adj_close" ? "harga penyesuaian" : coverage.price_basis;
  return `${formatNum(coverage.bars_available, 0)} bar (${range}) · ${formatNum(coverage.n_events, 0)} event · ${basis} · dihitung dari subset emiten yang punya data`;
}
