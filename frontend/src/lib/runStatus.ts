import type { FreshnessResponse, MetaConfigResponse } from "./api";
import { formatDateTime, formatNum, formatRp, formatRpCompact, formatTime } from "./format";

/**
 * Tampilan halaman Status (`docs/08` F10, baca-saja): gate kesegaran `GET /freshness`
 * + nilai aktif `GET /meta/config`. Semua fungsi tahan `null` — endpoint boleh
 * mengembalikan `null`/kosong dan halaman tidak boleh error (AC F10).
 */

export type GateTone = "ok" | "stale" | "idle";

export interface GateView {
  tone: GateTone;
  /** teks pill besar: `ok` / `stale` / `tidak diketahui`. */
  label: string;
  /** satu baris penjelasan: bar terakhir vs syarat. */
  detail: string;
  /** kalimat tindakan — wajib terisi saat `stale` (AC F10), `null` saat ok. */
  action: string | null;
}

export function gateView(freshness: FreshnessResponse | null | undefined): GateView {
  const gate = freshness?.midday_gate;
  if (!gate || (gate.status !== "ok" && gate.status !== "stale")) {
    return {
      tone: "idle",
      label: "tidak diketahui",
      detail: "Server belum mengirim status gate tengah hari.",
      action: null,
    };
  }
  const required = gate.required_bar_time || "11:30";
  const detail = gate.last_bar_at
    ? `Bar terakhir ${formatDateTime(gate.last_bar_at)} · syarat bar ≥ ${required} WIB`
    : `Belum ada bar hari ini · syarat bar ≥ ${required} WIB`;
  return {
    tone: gate.status,
    label: gate.status,
    detail,
    action:
      gate.status === "stale"
        ? `Data Yahoo belum sampai ${required} WIB${
            gate.last_bar_at ? ` (bar terakhir ${formatTime(gate.last_bar_at)} WIB)` : ""
          }, coba lagi nanti.`
        : null,
  };
}

export interface ProbeRow {
  ticker: string;
  last_bar_at: string | null;
}

/** Waktu bar terakhir per ticker probe — `[]` kalau endpoint belum mengirim daftarnya. */
export function probeRows(freshness: FreshnessResponse | null | undefined): ProbeRow[] {
  const probes = freshness?.midday_gate?.probes;
  if (!Array.isArray(probes)) return [];
  return probes.map((probe) => ({ ticker: probe?.ticker ?? "—", last_bar_at: probe?.last_bar_at ?? null }));
}

/** Kesegaran ingest harian — bagian lain (bukan gate) dari `GET /freshness`. */
export function dailyFreshnessText(freshness: FreshnessResponse | null | undefined): string {
  const daily = freshness?.daily_ingest;
  if (!daily?.status) return "Ingest harga harian: belum ada informasi.";
  return daily.last_data_at
    ? `Ingest harga harian: ${daily.status} · data terakhir ${formatDateTime(daily.last_data_at)}`
    : `Ingest harga harian: ${daily.status} · belum ada data`;
}

export interface ConfigRow {
  label: string;
  value: string;
}

/** Nilai ambang/parameter aktif dari `GET /meta/config`; angka diformat lewat `lib/format`. */
export function configRows(config: MetaConfigResponse | null | undefined): ConfigRow[] {
  if (!config?.universe) return [];
  const rows: ConfigRow[] = [
    { label: "Turnover minimum (Rp)", value: formatRpCompact(config.universe.min_turnover_idr) },
    { label: "Harga minimum (Rp)", value: formatRp(config.universe.min_price_idr) },
    { label: "RSI maksimum", value: formatNum(config.universe.max_rsi) },
  ];
  const rrg = config.rrg;
  if (rrg) {
    rows.push(
      { label: "EMA / ROC lag harian", value: `${formatNum(rrg.ema_span)} / ${formatNum(rrg.roc_lag)}` },
      {
        label: "EMA / ROC lag mingguan",
        value: `${formatNum(rrg.weekly?.ema_span)} / ${formatNum(rrg.weekly?.roc_lag)}`,
      },
      { label: "Minimum titik RRG", value: minPointsText(rrg.min_points) },
    );
  }
  if (config.last_ingest) {
    rows.push(
      { label: "Harga harian terakhir", value: formatDateTime(config.last_ingest.prices_daily) },
      { label: "Intraday terakhir", value: formatDateTime(config.last_ingest.intraday) },
      { label: "Sinyal mingguan terakhir", value: formatDateTime(config.last_ingest.signals_weekly) },
    );
  }
  return rows;
}

function minPointsText(minPoints: MetaConfigResponse["rrg"]["min_points"] | undefined): string {
  if (!minPoints) return "—";
  return Object.entries(minPoints)
    .map(([timeframe, value]) => `${timeframe} ${value}`)
    .join(" · ");
}
