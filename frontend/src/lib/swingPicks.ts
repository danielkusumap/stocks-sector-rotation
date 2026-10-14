import type { PickStatus, PlanPick, PlanPicksResponse } from "./api";
import { formatDate, formatNum, formatPct, formatRp } from "./format";
import { REGIME_LABEL, planStateLabel, chance } from "./weeklyPicks";

/**
 * View-model halaman **Swing Trade** (`docs/08` F25, kontrak `docs/05` §2 `/plan/picks`).
 * **Tidak ada perhitungan finansial**: zona, stop, target, R:R, peluang, jarak ke zona, status
 * berjalan — semuanya datang dari API. Di sini hanya label Bahasa Indonesia, format angka
 * Indonesia, dan geometri penggaris level SVG (posisi px, bukan harga).
 */

/** Urutan kelompok & badge status berjalan (docs/08 F25 butir 5 & 6). */
export const PICK_STATUS_ORDER: readonly PickStatus[] = [
  "kena_tp2",
  "kena_tp1",
  "di_zona",
  "menunggu_zona",
  "kena_stop",
  "kedaluwarsa",
];

export const PICK_STATUS_LABEL: Record<PickStatus, string> = {
  menunggu_zona: "Menunggu zona",
  di_zona: "Di zona beli",
  kena_tp1: "Kena target 1",
  kena_tp2: "Kena target 2",
  kena_stop: "Kena batas rugi",
  kedaluwarsa: "Kedaluwarsa",
};

export type StatusTone = "ok" | "accent" | "up" | "down" | "muted";

export const PICK_STATUS_TONE: Record<PickStatus, StatusTone> = {
  menunggu_zona: "muted",
  di_zona: "accent",
  kena_tp1: "ok",
  kena_tp2: "up",
  kena_stop: "down",
  kedaluwarsa: "muted",
};

/** Kelas teks/garis untuk tone status — warna hanya dari token (`docs/06`). */
export const TONE_CLASS: Record<StatusTone, string> = {
  ok: "text-up",
  accent: "text-accent",
  up: "text-up font-medium",
  down: "text-down",
  muted: "text-fg-muted",
};

export function statusLabel(status: PickStatus | null | undefined): string | null {
  return status ? (PICK_STATUS_LABEL[status] ?? null) : null;
}

/** Status pick di tabnya sendiri: tanggal terbaru = belum berjalan (tidak ada `status`). */
export function isRunning(pick: PlanPick): boolean {
  return Boolean(pick.status) && pick.status !== "menunggu_zona";
}

/** Badge zona pada kartu (`docs/08` F25 butir 4). */
export function zoneLabel(pick: Pick<PlanPick, "zone_status">): string {
  return pick.zone_status === "di_zona" ? "Di zona beli" : "Mendekati zona";
}

/** `Sel, 13 Okt` — label tab tanggal (tanggal dari API, format Indonesia). */
export function dateTabLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00+07:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Jakarta",
  }).format(parsed);
}

/**
 * Badge "data per 13 Okt, hari ini 14 Okt" — muncul saat tab bukan tanggal terakhir data
 * (perbandingan **tanggal**, bukan angka pasar; `today` disuntik supaya bisa diuji).
 */
export function dayBadge(asOf: string, today: string): string | null {
  if (asOf === today) return null;
  return `data per ${formatDate(asOf)}, hari ini ${formatDate(today)}`;
}

/** Satu baris ringkasan hari (butir 3). */
export function summaryLine(data: Pick<PlanPicksResponse, "picks" | "screened" | "ihsg_support">): string {
  const parts = [
    `${formatNum(data.picks.length)} kandidat lolos`,
    `${formatNum(data.screened)} emiten disaring`,
  ];
  if (data.ihsg_support !== null && data.ihsg_support !== undefined) {
    parts.push(`support IHSG ${formatRp(data.ihsg_support)}`);
  }
  return parts.join(" · ");
}

/** Butir 8: `available_dates` kurang dari 5 hari bursa → tawarkan hitung mundur. */
export const PICK_DAYS_REQUIRED = 5;

export function needsCompute(dates: readonly string[]): boolean {
  return dates.length < PICK_DAYS_REQUIRED;
}

export function computeBannerText(dates: readonly string[]): string {
  return `${PICK_DAYS_REQUIRED} hari bursa terakhir belum dihitung (baru ${formatNum(dates.length)} tanggal tersedia)`;
}

export interface LevelRow {
  key: string;
  label: string;
  value: string;
  reason?: string;
}

/**
 * Tabel rencana 2 kolom (butir 4): zona, batas rugi, target 1 & 2 (+`pct`, R:R), peluang TP1
 * (**tanpa tanda**, hanya bila API mengirimnya). Tidak ada angka yang dihitung di sini.
 */
export function levelRows(pick: PlanPick): LevelRow[] {
  const rows: LevelRow[] = [
    {
      key: "zone",
      label: "Zona beli",
      value: `${formatRp(pick.entry_zone.low)}–${formatRp(pick.entry_zone.high)}`,
      reason: pick.entry_zone.reason,
    },
    {
      key: "stop",
      label: "Batas rugi",
      value: `${formatRp(pick.stop.level)}${pick.stop.pct === null ? "" : ` (${formatPct(pick.stop.pct)})`}`,
      reason: pick.stop.reason,
    },
    targetRow("tp1", "Target 1", pick.tp1),
    targetRow("tp2", "Target 2", pick.tp2),
  ];
  const probability = pick.hit_tp1 ?? pick.p_tp1_first ?? null;
  if (probability !== null) {
    // peluang tanpa tanda (docs/06 §5.2) — `formatPct` selalu bertanda, jadi pakai `chance`
    rows.push({ key: "chance", label: "Peluang TP1", value: chance(probability) });
  }
  if (pick.tp0) rows.push(targetRow("tp0", "Target cepat", pick.tp0));
  return rows;
}

function targetRow(key: string, label: string, level: { level: number; pct: number | null; rr?: number | null; reason?: string }): LevelRow {
  const pct = level.pct === null ? "" : ` (${formatPct(level.pct)})`;
  const rr = level.rr === null || level.rr === undefined ? "" : ` · R:R ${formatNum(level.rr, 2)}:1`;
  return { key, label, value: `${formatRp(level.level)}${pct}${rr}`, reason: level.reason };
}

/** Kalimat alasan yang ditampilkan di disclosure "Kenapa level ini?" (butir 4). */
export function reasonRows(pick: PlanPick): { key: string; label: string; text: string }[] {
  return levelRows(pick)
    .filter((row): row is LevelRow & { reason: string } => Boolean(row.reason))
    .map((row) => ({ key: row.key, label: row.label, text: row.reason }));
}

export interface RulerStop {
  ratio: number;
  label: string;
  kind: "stop" | "zone" | "tp1" | "tp2" | "last";
}

/**
 * Geometri penggaris level: setiap level dipetakan ke posisi 0–1 pada rentang
 * `[min(level, harga terakhir), max(...)]` yang **sudah** disediakan API — tidak ada
 * perhitungan harga baru, hanya interpolasi linier untuk menggambar SVG.
 */
export function rulerGeometry(pick: PickPlanPick): {
  stops: RulerStop[];
  zone: { from: number; to: number } | null;
  last: number | null;
} {
  const last = pick.close_latest ?? pick.close;
  const values = [pick.stop.level, pick.tp1.level, pick.tp2.level, last, pick.entry_zone.low, pick.entry_zone.high];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const at = (value: number) => (span === 0 ? 0.5 : (value - min) / span);

  return {
    stops: [
      { ratio: at(pick.stop.level), label: `batas rugi ${formatRp(pick.stop.level)}`, kind: "stop" },
      { ratio: at(pick.tp1.level), label: `target 1 ${formatRp(pick.tp1.level)}`, kind: "tp1" },
      { ratio: at(pick.tp2.level), label: `target 2 ${formatRp(pick.tp2.level)}`, kind: "tp2" },
      { ratio: at(last), label: `harga terakhir ${formatRp(last)}`, kind: "last" },
    ],
    zone: { from: at(pick.entry_zone.low), to: at(pick.entry_zone.high) },
    last,
  };
}

type PickPlanPick = Pick<
  PlanPick,
  "stop" | "tp1" | "tp2" | "entry_zone" | "close" | "close_latest"
>;

/** `aria-label` penggaris (AC 8: angka harus ada di teks, bukan warna saja). */
export function rulerAriaLabel(pick: PlanPick): string {
  const parts = [
    `batas rugi ${formatRp(pick.stop.level)}`,
    `zona beli ${formatRp(pick.entry_zone.low)}–${formatRp(pick.entry_zone.high)}`,
    `target 1 ${formatRp(pick.tp1.level)}`,
    `target 2 ${formatRp(pick.tp2.level)}`,
    `harga terakhir ${formatRp(pick.close_latest ?? pick.close)}`,
  ];
  return `Penggaris level: ${parts.join(", ")}`;
}

/** Persen tanpa tanda (`62%`, `5,8%`) — `formatPct` selalu bertanda, jadi jangan dipakai di sini. */
export function chanceText(value: number, decimals = 0): string {
  return `${formatNum(value * 100, decimals)}%`;
}

/** Baris status berjalan (butir 4, hanya untuk tanggal < terbaru). */
export function runningText(pick: PlanPick): string | null {
  if (!pick.status) return null;
  const parts: string[] = [];
  if (pick.ret_sejak_asof !== null && pick.ret_sejak_asof !== undefined) {
    parts.push(`sejak pick ${formatPct(pick.ret_sejak_asof)}`);
  }
  const moves: string[] = [];
  if (pick.mfe_pct !== null && pick.mfe_pct !== undefined) moves.push(`sempat naik ${chanceText(pick.mfe_pct, 1)}`);
  if (pick.mae_pct !== null && pick.mae_pct !== undefined) moves.push(`sempat turun ${formatPct(pick.mae_pct)}`);
  if (moves.length > 0) parts.push(moves.join(", "));
  if (pick.bars_sejak_asof !== null && pick.bars_sejak_asof !== undefined) {
    parts.push(`${formatNum(pick.bars_sejak_asof)} hari`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export interface RunningGroup {
  status: PickStatus;
  label: string;
  tone: StatusTone;
  items: { ticker: string; date: string; note: string | null }[];
}

/** Butir 6: kelompokkan pick hari-hari sebelumnya per status; urutan tetap. */
export function runningGroups(
  entries: readonly { date: string; picks: readonly PlanPick[] }[],
): RunningGroup[] {
  const groups = new Map<PickStatus, RunningGroup>();
  for (const entry of entries) {
    for (const pick of entry.picks) {
      const status = pick.status;
      if (!status || status === "menunggu_zona") continue; // belum berjalan → bukan "pantauan"
      const group = groups.get(status) ?? {
        status,
        label: PICK_STATUS_LABEL[status],
        tone: PICK_STATUS_TONE[status],
        items: [],
      };
      group.items.push({ ticker: pick.ticker, date: entry.date, note: pick.status_note ?? null });
      groups.set(status, group);
    }
  }
  return PICK_STATUS_ORDER.filter((status) => groups.has(status)).map((status) => groups.get(status)!);
}

/** Label keadaan plan untuk kartu (dipakai ulang dari F18 supaya teks tidak bercabang). */
export { planStateLabel, REGIME_LABEL };

/** Angka baris kartu (butir 4) — semua dari API, format Indonesia. */
export function cardFigures(pick: PlanPick): { key: string; label: string; value: string }[] {
  return [
    { key: "close", label: "harga", value: formatRp(pick.close) },
    {
      key: "zone-pct",
      label: "jarak ke zona",
      value: pick.zone_pct === null || pick.zone_pct === undefined ? "—" : formatPct(pick.zone_pct),
    },
    { key: "rsi", label: "RSI14", value: pick.rsi14 === null ? "—" : formatNum(pick.rsi14, 1) },
    { key: "atr", label: "ATR", value: pick.atr_pct === null ? "—" : chanceText(pick.atr_pct, 2) },
  ];
}
