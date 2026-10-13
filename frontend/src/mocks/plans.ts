import type { WeeklyPlan } from "../lib/api";

/**
 * Mock `plan` pada `/weekly/picks` (`docs/05` §3 `api_version` 1.2, `docs/08` F18).
 * Mock berperan sebagai backend: angkanya **diturunkan** dari angka fixture pick
 * (`entry_ref`/`stop`/`target`/`atr14`) supaya konsisten, dan alasan tiap elemen
 * disusun di sini (di backend asli disusun B18, bukan di frontend).
 *
 * Knob: `?mock=notrade` → pick pertama `entry_mode=no_trade` (tanpa level);
 *       `?mock=planfail` → pick pertama `plan_ok=false` + `notes`.
 */

/** Biaya bolak-balik yang dipakai `weekly.plan.fee_*` (docs/03 §6.4): 0,40%. */
const FEE = 0.004;

const round5 = (value: number) => Math.round(value / 5) * 5;

/** R:R bersih biaya — mock menghitung kasar; frontend tidak pernah menghitungnya. */
function netRr(entry: number, stop: number, target: number): number {
  const risk = entry - stop + FEE * entry;
  const reward = target - entry - FEE * entry;
  return risk <= 0 ? 0 : Math.round((reward / risk) * 100) / 100;
}

const TOOLS: Record<string, { tool: WeeklyPlan["entry_tool"]; confirm: WeeklyPlan["confirm_tool"] }> = {
  tren_naik: { tool: "pullback_ma20", confirm: "volume" },
  range: { tool: "sr_channel", confirm: "rsi_tepi_range" },
  turun: { tool: "none", confirm: "none" },
  tipis: { tool: "pivot_level", confirm: "none" },
};

const REGIMES = ["tren_naik", "range", "tren_naik", "range", "tipis", "tren_naik", "range", "tipis"] as const;

interface PickLike {
  ticker: string;
  entry_ref: number;
  stop: number;
  target: number;
  atr14: number | null;
}

export function planFor(pick: PickLike, index: number, knob: string | null): WeeklyPlan {
  const entry = pick.entry_ref;
  const atr = pick.atr14 ?? Math.max(1, Math.round(entry * 0.02));
  const regime = REGIMES[index % REGIMES.length];
  const { tool, confirm } = TOOLS[regime];
  const noTrade = knob === "notrade" && index === 0;
  const fails = knob === "planfail" && index === 0;

  const zoneLow = round5(entry - atr / 2);
  const zoneHigh = round5(entry + atr / 2);
  const tp1 = round5((entry + pick.target) / 2);
  const tp2 = pick.target;
  const tp1Rr = netRr(entry, pick.stop, tp1);
  const tp2Rr = netRr(entry, pick.stop, tp2);

  // riwayat kurang (docs/05 §3: `hit_tp1: null` → "belum cukup riwayat")
  const thinHistory = index === 1;
  const notes = noTrade
    ? ["Rezim turun — tidak ada rencana beli sampai harga kembali di atas penyangga 20 hari."]
    : fails
      ? ["Imbal hasil terhadap risiko di bawah 3:1 — tunggu harga mendekati zona, jangan kejar."]
      : [];

  if (noTrade) {
    return {
      regime: "turun",
      entry_tool: "none",
      confirm_tool: "none",
      entry_mode: "no_trade",
      entry_zone: { low: null, high: null, reason: "Rezim turun: tidak ada zona beli yang layak." },
      stop: { level: null, pct: null, basis: null, reason: "Tanpa posisi, tidak ada batas rugi." },
      tp1: { level: null, pct: null, rr: null, basis: null, reason: "Tanpa posisi, tidak ada target." },
      tp2: { level: null, pct: null, rr: null, basis: null, reason: "Tanpa posisi, tidak ada target." },
      hold: {
        median_periods: null,
        n_events: null,
        win_rate: null,
        hit_tp1: null,
        hit_tp2: null,
        reason: "Tidak dihitung saat tidak ada rencana beli.",
      },
      invalidation: null,
      plan_ok: false,
      notes,
    };
  }

  return {
    regime,
    entry_tool: tool,
    confirm_tool: confirm,
    entry_mode: regime === "tren_naik" ? "pullback" : "breakout",
    entry_zone: {
      low: zoneLow,
      high: zoneHigh,
      reason: `Zona di sekitar penyangga 20 hari (${entry}); beli di penyangga membuat batas rugi lebih dekat.`,
    },
    stop: {
      level: pick.stop,
      pct: Math.round((pick.stop / entry - 1) * 10000) / 10000,
      basis: "struktur_swing_low",
      reason: `Batas rugi di bawah titik terendah 10 hari ditambah penyangga ${Math.round(atr / 2)} — di situ skenario naik batal.`,
    },
    tp1: {
      level: tp1,
      pct: Math.round((tp1 / entry - 1) * 10000) / 10000,
      rr: tp1Rr,
      basis: "resistance_20",
      reason: "Puncak 20 hari terakhir adalah tempat penjual menumpuk — ambil sebagian di situ.",
    },
    tp2: {
      level: tp2,
      pct: Math.round((tp2 / entry - 1) * 10000) / 10000,
      rr: tp2Rr,
      basis: "donchian_40",
      reason: `Target terukur dari puncak 40 hari; imbal hasil terhadap risiko setelah biaya masih ${tp2Rr}:1.`,
    },
    hold: thinHistory
      ? {
          median_periods: null,
          n_events: 2,
          win_rate: 0.5,
          hit_tp1: null,
          hit_tp2: null,
          reason: "Baru 2 breakout tercatat — belum cukup riwayat untuk peluang historis.",
        }
      : {
          median_periods: 7,
          n_events: 29,
          win_rate: 0.34,
          hit_tp1: 0.62,
          hit_tp2: 0.34,
          reason: "Dari 29 breakout terakhir: median 7 bar sampai target pertama.",
        },
    invalidation: `Batal bila tutup harian di bawah penyangga 20 hari (${entry}) atau batas rugi ${pick.stop}.`,
    plan_ok: !fails,
    notes,
    entry_tool_reason:
      regime === "tren_naik"
        ? "Harga di atas penyangga 20 & 50 hari dan sektornya Memimpin — alat utama pantulan."
        : undefined,
    confirm_reason: confirm === "volume" ? "Volume 1,8× rata-rata 20 hari saat menyentuh zona." : undefined,
  };
}
