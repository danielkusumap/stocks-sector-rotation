import { HttpResponse, http } from "msw";
import type { DataStatus, PickStatus, PlanPick, PlanPicksResponse } from "../lib/api";
import stocksJson from "./fixtures/stocks.json";
import weeklyJson from "./fixtures/weekly.json";

/**
 * Mock `GET /plan/picks` (docs/05 §2, dipakai `docs/08` F25). Angka diturunkan dari fixture yang
 * sudah ada (`stocks.json` + `weekly.json`) supaya konsisten dengan `/weekly/picks` & `/plan/stock`.
 * Daftar aturan disalin **kata per kata** dari `backend/app/compute/plan.py` (`PICKS_RULES`).
 *
 * Knob: `?mock=swingempty` (picks kosong, `screened` tetap 21), `?mock=swing1day` (`available_dates`
 * hanya 1 tanggal → banner "belum dihitung"), `?mock=swingfail` (500).
 */

const API = "/api/v1";
const DATES = ["2026-10-13", "2026-10-12", "2026-10-09", "2026-10-08", "2026-10-07"];
const IHSG_SUPPORT = 5828.68;

/** Disalin dari `PICKS_RULES` backend — aturan penyaringan yang sama persis. */
export const PICKS_RULES = [
  "Likuiditas: median transaksi 20 hari ≥ `?min_turnover` (default `weekly.plan.min_turnover_idr`).",
  "Gerbang sektor: ≥ `sector_gate_min_pass` dari 3 bobot (`equal`/`turnover`/`captier`) pada `w1_fri` memimpin/memperbaiki.",
  "Rezim `tren_naik` atau `range` — `tipis`/`turun` dibuang.",
  "ATR14 ≤ `picks_atr_max_pct` × harga.",
  "Lebar zona ≤ `picks_zone_max_atr` × ATR14.",
  "Batas rugi ≤ `picks_stop_max_pct` × harga.",
  "Imbal hasil TP2 ≥ `rr_min_tp2` setelah biaya.",
  "Label zona `di_zona` (gap ≤ `zone_touch_atr`) atau `mendekati` (gap ≤ `zone_near_atr`).",
  "Denyut sektor harian (d1) ≥ `picks_sector_pulse_min` di semua bobot `picks_sector_pulse_weightings`.",
];

const STATUS_NOTE: Partial<Record<PickStatus, string>> = {
  di_zona: "zona beli tersentuh — rencana masih berjalan",
  kena_tp1: "target 1 kena, sisa posisi ke target 2",
  kena_tp2: "target 2 kena — rencana selesai",
  kena_stop: "batas rugi kena — rencana selesai",
  kedaluwarsa: "zona tidak tersentuh sampai 10:00 — rencana gugur",
  menunggu_zona: "zona belum tersentuh",
};

const entry = (ticker: string) => weeklyJson.stocks.find((s) => s.ticker === ticker) ?? null;
const round = (value: number) => Math.round(value);

/** Satu pick; angka level dihitung mock (peran backend), bukan oleh UI. */
function pickFor(
  ticker: string,
  rank: number,
  status: PickStatus,
  knobs: { ret: number; bars: number; mfe: number; mae: number; zone: "di_zona" | "mendekati"; regime?: string; rsi: number },
): PlanPick | null {
  const stock = stocksJson.find((s) => s.ticker === ticker);
  if (!stock) return null;
  const plan = entry(ticker);
  const close = stock.close;
  const atr = plan?.atr14 ?? round(close * 0.02);
  const zoneLow = plan ? round(plan.entry_ref * 0.995) : round(close * 0.985);
  const zoneHigh = plan ? round(plan.entry_ref * 1.007) : round(close * 0.995);
  const stop = plan?.stop ?? round(close * 0.94);
  const tp1 = plan ? round((plan.entry_ref + plan.target) / 2) : round(close * 1.06);
  const tp2 = plan?.target ?? round(close * 1.12);
  const skor = Math.round((8.2 - rank * 0.7) * 1000) / 1000;

  return {
    ticker,
    name: stock.name,
    sector_code: stock.sector_code,
    close,
    turnover_idr: 9_840_000_000 + rank * 1_200_000_000,
    atr14: atr,
    atr_pct: Math.round((atr / close) * 10000) / 10000,
    rsi14: knobs.rsi,
    regime: knobs.regime ?? "tren_naik",
    regime_label: knobs.regime === "range" ? "Range" : "Tren naik",
    entry_zone: {
      low: zoneLow,
      high: zoneHigh,
      reason:
        "Diukur dari penahan 20 hari dan rata-rata 20 hari: zona dibatasi 1,2× ATR supaya tidak mengejar harga.",
    },
    zone_status: knobs.zone,
    zone_pct: knobs.zone === "di_zona" ? 0.004 : 0.031,
    zone_gap_atr: knobs.zone === "di_zona" ? -0.04 : 0.62,
    entry: plan?.entry_ref ?? round((zoneLow + zoneHigh) / 2),
    stop: {
      level: stop,
      pct: Math.round(((stop - close) / close) * 10000) / 10000,
      basis: "volatilitas_atr",
      reason: `1,5× ATR14 (${round(atr)}) di bawah zona — di bawah situ skenario pantulan gugur.`,
    },
    tp1: {
      level: tp1,
      pct: Math.round(((tp1 - close) / close) * 10000) / 10000,
      rr: 1.31,
      basis: "penahan_20",
      reason: "Penahan 20 hari terdekat; ambil sebagian di sini supaya imbal hasil terkunci.",
    },
    tp2: {
      level: tp2,
      pct: Math.round(((tp2 - close) / close) * 10000) / 10000,
      rr: 3.12,
      basis: "donchian_40",
      reason: "Puncak 40 hari; target terukur, bukan ramalan.",
    },
    tp1_artefak: false,
    tp2_artefak: false,
    sector_quadrants: { equal: rank === 3 ? "improving" : "leading", turnover: "leading", captier: rank === 3 ? "weakening" : "leading" },
    sector_score: Math.round((68 - rank * 2.4) * 10) / 10,
    sector_pass: rank === 3 ? 2 : 3,
    sector_pulse: { equal: Math.round((88 - rank * 3) * 10) / 10, turnover: Math.round((90 - rank * 2) * 10) / 10 },
    sector_pulse_min: 60,
    skor,
    skor_rincian: { kedekatan_zona: rank === 1 ? 3.0 : 2.1, rr_tp2: 3.0, skor_sektor: 1.324 },
    validity: {
      valid_until: "10:00 WIB sesi bursa berikutnya",
      valid_if: `tutup harian masih di atas ${zoneLow} dan IHSG masih di atas ${IHSG_SUPPORT}`,
      invalidate_below: zoneLow,
      expires_if: "zona belum tersentuh sampai 10:00 → rencana gugur; jangan geser zona untuk memaksa masuk",
      done_if: `TP2 ${tp2} kena / stop ${stop} kena / kedaluwarsa`,
    },
    notes: rank === 3 ? ["Denyut sektor harian mendekati ambang — posisi lebih kecil."] : [],
    rank,
    status,
    close_latest: knobs.bars === 0 ? close : round(close * (1 + knobs.ret)),
    ret_sejak_asof: knobs.bars === 0 ? null : knobs.ret,
    bars_sejak_asof: knobs.bars,
    mfe_pct: knobs.bars === 0 ? null : knobs.mfe,
    mae_pct: knobs.bars === 0 ? null : knobs.mae,
    status_note: STATUS_NOTE[status] ?? null,
  };
}

/** Isi tiap tanggal: terbaru punya pick "baru" (belum berjalan), tanggal lama punya status berjalan. */
function picksFor(date: string): PlanPick[] {
  if (date === DATES[0]) {
    return [
      pickFor("BBRI", 1, "menunggu_zona", { ret: 0, bars: 0, mfe: 0, mae: 0, zone: "di_zona", rsi: 63.1 }),
      pickFor("TLKM", 2, "menunggu_zona", { ret: 0, bars: 0, mfe: 0, mae: 0, zone: "mendekati", rsi: 58.4 }),
      pickFor("ANTM", 3, "menunggu_zona", { ret: 0, bars: 0, mfe: 0, mae: 0, zone: "mendekati", regime: "range", rsi: 51.2 }),
    ].filter((pick): pick is PlanPick => pick !== null);
  }
  if (date === DATES[1]) {
    return [
      pickFor("BMRI", 1, "di_zona", { ret: 0.012, bars: 1, mfe: 0.021, mae: -0.008, zone: "di_zona", rsi: 60.2 }),
      pickFor("KLBF", 2, "menunggu_zona", { ret: 0.004, bars: 1, mfe: 0.009, mae: -0.006, zone: "mendekati", rsi: 54.8 }),
      pickFor("ASSA", 3, "kena_tp1", { ret: 0.049, bars: 1, mfe: 0.058, mae: -0.011, zone: "di_zona", rsi: 66.3 }),
    ].filter((pick): pick is PlanPick => pick !== null);
  }
  if (date === DATES[2]) {
    return [
      pickFor("BBCA", 1, "kena_tp2", { ret: 0.142, bars: 2, mfe: 0.151, mae: -0.009, zone: "di_zona", rsi: 68.9 }),
      pickFor("MIKA", 2, "kedaluwarsa", { ret: -0.006, bars: 2, mfe: 0.017, mae: -0.019, zone: "di_zona", rsi: 49.1 }),
      pickFor("ACES", 3, "kena_stop", { ret: -0.071, bars: 2, mfe: 0.008, mae: -0.079, zone: "di_zona", rsi: 44.3 }),
    ].filter((pick): pick is PlanPick => pick !== null);
  }
  return [
    pickFor("DCII", 1, "kena_tp1", { ret: 0.061, bars: 3, mfe: 0.072, mae: -0.01, zone: "di_zona", rsi: 64.0 }),
    pickFor("JSMR", 2, "di_zona", { ret: 0.018, bars: 3, mfe: 0.03, mae: -0.012, zone: "di_zona", regime: "range", rsi: 55.6 }),
  ].filter((pick): pick is PlanPick => pick !== null);
}

export const picksHandlers = [
  http.get(`${API}/plan/picks`, ({ request }) => {
    const url = new URL(request.url);
    const knob = url.searchParams.get("mock");
    if (knob === "swingfail") {
      return HttpResponse.json(
        { api_version: "1.3", error: { code: "internal_error", message: "picks gagal dihitung", detail: null } },
        { status: 500 },
      );
    }
    const asOf = url.searchParams.get("as_of") ?? DATES[0];
    if (!DATES.includes(asOf)) {
      return HttpResponse.json(
        {
          api_version: "1.3",
          error: { code: "not_found", message: `tidak ada pick untuk ${asOf}`, detail: { as_of: asOf, available_dates: DATES } },
        },
        { status: 404 },
      );
    }
    const empty = knob === "swingempty";
    const dates = knob === "swing1day" ? DATES.slice(0, 1) : DATES;
    const picks = empty ? [] : picksFor(asOf);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 3) || 3, 10);

    const data_status: DataStatus = {
      as_of: asOf,
      timeframe: "d1",
      status: "ok",
      last_data_at: "2026-10-12T16:10:00+07:00",
      computed_at: "2026-10-13T16:31:02+07:00",
      range_from: null,
      range_to: asOf,
      range_label: null,
      window_range_label: null,
      partial_sectors: [],
    };

    const body: PlanPicksResponse = {
      api_version: "1.3",
      as_of: asOf,
      available_dates: dates,
      limit,
      min_turnover_idr: 2_000_000_000,
      screened: 21,
      ihsg_support: IHSG_SUPPORT,
      rules: [...PICKS_RULES],
      picks,
      data_status,
    };
    return HttpResponse.json(body);
  }),
];
