import type { DataStatus, IngestRun, Timeframe, WeeklyPicksResponse, Window } from "./api";
import { TIMEFRAME_LABEL, WINDOW_LABEL } from "./filters";
import { formatDate } from "./format";
import { RUN_KIND } from "./pipeline";

/**
 * Label periode yang dipakai UI (docs/08 F13 bagian C): user harus melihat
 * **periode mana** yang sedang dihitung tanpa menebak.
 *
 * Aturan mengikat (`docs/05` §1): rentang tanggal **disusun backend** (`range_label`,
 * `week_label`). Frontend hanya menempelkan potongan yang sudah ada di API — kalau
 * labelnya `null` → "belum ada data", bukan ditebak dari `as_of`.
 */

/** Teks pengganti saat API belum punya hasil hitung — bukan `0`, bukan tanggal karangan. */
export const NO_PERIOD = "belum ada data";

export interface PeriodParts {
  timeframe: Timeframe;
  window: Window;
  /** `data_status.range_label` (label dari backend). */
  rangeLabel?: string | null;
  /** `data_status.window_range_label`; kalau tidak ada, bagian dalam kurung dihilangkan. */
  windowRangeLabel?: string | null;
}

/** `Mingguan (Sen–Jum) · 5–9 Okt 2026 · jendela 3 bln (15 Jul – 12 Okt 2026)`. */
export function periodLabel(parts: PeriodParts): string {
  const range = parts.rangeLabel?.trim() || NO_PERIOD;
  const windowRange = parts.windowRangeLabel?.trim();
  const window = `jendela ${WINDOW_LABEL[parts.window]}`;
  return `${TIMEFRAME_LABEL[parts.timeframe]} · ${range} · ${window}${windowRange ? ` (${windowRange})` : ""}`;
}

/** Sama seperti `periodLabel`, tapi dibaca langsung dari blok `data_status` sebuah endpoint. */
export function periodFromStatus(
  status: DataStatus | null | undefined,
  rest: { timeframe: Timeframe; window: Window },
): string {
  return periodLabel({
    ...rest,
    rangeLabel: status?.range_label,
    windowRangeLabel: status?.window_range_label,
  });
}

/**
 * Halaman Weekly memakai pekan dari `/weekly/picks` (docs/05 §3). `week_label` dari
 * backend dipakai apa adanya; `week_start`/`week_end` hanya jadi cadangan kalau label kosong.
 */
export function weeklyPeriodLabel(
  picks: WeeklyPicksResponse | null | undefined,
  window: Window,
): string {
  const fallback =
    picks?.week_start && picks?.week_end
      ? `${formatDate(picks.week_start)}–${formatDate(picks.week_end)}`
      : NO_PERIOD;
  const week = picks?.week_label?.trim() || (picks ? fallback : NO_PERIOD);
  const suffix = picks && picks.is_final === false ? " · pekan berjalan" : "";
  return `${TIMEFRAME_LABEL.w1_fri} · ${week} · jendela ${WINDOW_LABEL[window]}${suffix}`;
}

/**
 * Periode run terakhir di `/data`, dibaca dari `params_json`/`result_json` run itu
 * (docs/05 §4.6) — bukan dari tanggal hari ini.
 */
export function runPeriodLabel(run: IngestRun | null | undefined): string {
  if (!run) return "belum ada run";
  const params = (run.params_json ?? {}) as { mode?: string; timeframe?: string };
  const result = (run.result_json ?? {}) as {
    mode?: string;
    timeframe?: string;
    week_end?: string;
    gate?: string;
  };
  switch (run.kind) {
    case RUN_KIND.importExcel:
      return "tidak terikat periode (daftar emiten)";
    case RUN_KIND.pricesDaily:
    case RUN_KIND.pricesIntraday: {
      const mode = result.mode ?? params.mode ?? (run.kind === RUN_KIND.pricesDaily ? "daily" : "intraday");
      return mode === "intraday" ? "bar intraday hari ini" : "bar harian terakhir";
    }
    case RUN_KIND.computeAll: {
      const timeframe = result.timeframe ?? params.timeframe;
      return timeframe
        ? `hitungan ${TIMEFRAME_LABEL[timeframe as Timeframe] ?? timeframe}`
        : "seluruh timeframe";
    }
    case RUN_KIND.computeSignals:
      return result.week_end ? `pekan sampai ${formatDate(result.week_end)}` : "pekan final terakhir";
    case RUN_KIND.midday:
      return `tengah hari (gate ${result.gate ?? "tidak diketahui"})`;
    default:
      return NO_PERIOD;
  }
}
