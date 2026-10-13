import type { TaBreakout, TaCoverage, TaDetailResponse, TaEventRow, TaResult, TaStats, TaSummaryItem } from "./api";
import { formatDate, formatNum, formatPct, formatRp } from "./format";

/**
 * View-model analisa teknikal (docs/06 §5.1, docs/08 F17). **Tidak ada rumus di sini**:
 * win rate, median, event, dan `gain_since` semuanya datang dari API (docs/03 §10 milik backend).
 * Yang dirakit modul ini hanya label Bahasa Indonesia + nilai `null` → `—`.
 */

/** Status satu event → teks yang dipakai user (badge & kolom tabel). */
export const RESULT_LABEL: Record<TaResult, string> = {
  win: "+5% dulu",
  loss: "−5% dulu",
  open: "belum selesai",
  expired: "lewat batas",
};

/** Label status event; `null` (entitas tanpa event) → `—`. */
export function resultLabel(result: TaResult | null | undefined): string {
  return result ? (RESULT_LABEL[result] ?? result) : "—";
}

/**
 * Tona badge hasil. `open` = masih berjalan → tona `queued` (netral-biru di `Pill`),
 * `expired` = netral, menang = aksen, kalah = amber.
 */
export function resultTone(result: TaResult): "ok" | "partial" | "queued" | "idle" {
  if (result === "win") return "ok";
  if (result === "loss") return "partial";
  if (result === "open") return "queued";
  return "idle";
}

/** `62,5%` · `—` kalau belum ada event (bukan `0%`, docs/05 §2). Tanpa tanda: ini level, bukan delta. */
export function winRateText(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${formatNum(value * 100, 1)}%`;
}

/** `9 periode` · `—`. */
export function periodsText(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${formatNum(value, 0)} periode`;
}

/** Satu baris kecil "dengan filter tren: 62,5% (9 event) · tanpa filter: 46,2% (14 event)". */
export function filterCompareText(on: TaStats, off: TaStats): string {
  const part = (stats: TaStats) =>
    `${winRateText(stats.win_rate)} (${formatNum(stats.n_events, 0)} event)`;
  return `dengan filter tren: ${part(on)} · tanpa filter: ${part(off)}`;
}

/**
 * Baris kecil jujur untuk event terbaru: `6 Okt → entry 7 Okt 4.012,5 (harga penyesuaian) · 5 periode · +5,92%`.
 * `gain_since` ditampilkan lewat pemanggil (`Delta`) supaya warnanya konsisten; di sini hanya teks.
 */
export function latestText(latest: TaBreakout | null): string {
  if (!latest) return "belum ada breakout pada periode MA ini";
  const parts = [
    `sinyal ${formatDate(latest.signal_date)}`,
    `entry ${formatDate(latest.entry_date)} ${formatRp(latest.entry_price)} (harga penyesuaian)`,
    `${formatNum(latest.periods_since, 0)} periode sejak entry`,
  ];
  return parts.join(" · ");
}

/** `+5,92%` · `—`. */
export function gainSinceText(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : formatPct(value, 2);
}

/** `6 Okt · 5 periode` untuk kolom insight (docs/06 §5.1) — `null` kalau belum ada event. */
export function breakoutCellText(item: TaSummaryItem): string | null {
  const latest = item.last_breakout;
  if (!latest) return null;
  return `${dayMonth(latest.signal_date)} · ${formatNum(latest.periods_since, 0)} periode`;
}

/** `6 Okt` (hari + bulan singkat Bahasa Indonesia, tanpa tahun — kolom tabel sempit). */
export function dayMonth(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(`${iso}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(date);
}

/** Baris catatan cakupan (wajib, docs/06 §5.1): emiten diuji/dilewati + rentang + basis harga. */
export function coverageText(
  coverage: TaCoverage | null | undefined,
  scope: "sector" | "stock",
  minHistory: number,
): string {
  if (!coverage) return "cakupan data belum dilaporkan backend.";
  const unit = scope === "sector" ? "sektor" : "emiten";
  const skipped = `${formatNum(coverage.refs_skipped_short_history, 0)} ${unit} dilewati karena riwayat kurang dari ${formatNum(minHistory, 0)} bar`;
  const range =
    coverage.bars_from && coverage.bars_to
      ? `data ${formatDate(coverage.bars_from)} – ${formatDate(coverage.bars_to)}`
      : "rentang data belum ada";
  const basis = coverage.price_basis === "adj_close" ? "harga penyesuaian" : coverage.price_basis;
  return `angka dari ${formatNum(coverage.refs_tested, 0)} ${unit}; ${skipped} · ${range} · ${basis}`;
}

/** Peta `ref_id` → baris ringkasan, untuk kolom insight tabel (satu permintaan per halaman). */
export function summaryMap(items: TaSummaryItem[] | undefined): Map<string, TaSummaryItem> {
  return new Map((items ?? []).map((item) => [item.ref_id, item]));
}

/** Baris tabel event → urutan tetap kolom `docs/06` §5.1; harga keluar `—` saat belum selesai. */
export function eventRows(events: TaEventRow[] | undefined): TaEventRow[] {
  return events ?? [];
}

/** `null` yang aman untuk `TaDetailResponse.stats` — respons lama/rusak jangan bikin halaman putih. */
export function statsOf(
  detail: Pick<TaDetailResponse, "stats"> | null | undefined,
  trendFilter: boolean,
): TaStats | null {
  const stats = detail?.stats;
  if (!stats) return null;
  const chosen = trendFilter ? stats.filter_on : stats.filter_off;
  return chosen ?? null;
}
