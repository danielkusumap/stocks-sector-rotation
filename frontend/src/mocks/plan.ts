import { HttpResponse, http } from "msw";
import type { DataStatus, StockPlanResponse } from "../lib/api";
import { planFor } from "./plans";
import stocksJson from "./fixtures/stocks.json";
import weeklyJson from "./fixtures/weekly.json";

/**
 * Mock `GET /plan/stock/{ticker}` (docs/05 §2, dipakai `docs/08` F20).
 * Angka diturunkan dari fixture yang sudah ada (`stocks.json` + `weekly.json`) supaya
 * konsisten dengan `/weekly/picks` dan `/series/stock`; mock berperan backend.
 *
 * Knob: `?mock=planfail` (plan_ok=false + notes), `?mock=thin` (rezim `tipis`),
 *       `?mock=shortdata` (rezim `tidak_cukup_data`, `plan`/`scenario` null).
 */

const API = "/api/v1";
const AS_OF = "2026-10-13";
const round = (value: number, step = 5) => Math.round(value / step) * step;

export const planHandlers = [
  http.get(`${API}/plan/stock/:ticker`, ({ request, params }) => {
    const ticker = String(params.ticker).toUpperCase();
    const stock = stocksJson.find((s) => s.ticker === ticker);
    if (!stock) {
      return HttpResponse.json(
        { api_version: "1.0", error: { code: "not_found", message: `saham ${ticker} tidak ada`, detail: null } },
        { status: 404 },
      );
    }

    const knob = new URL(request.url).searchParams.get("mock");
    const short = knob === "shortdata";
    const thin = knob === "thin" || short;
    const pick = weeklyJson.stocks.find((s) => s.ticker === ticker) ?? null;
    const close = stock.close;
    const entry = pick?.entry_ref ?? close;

    const regime = {
      code: short ? "tidak_cukup_data" : thin ? "tipis" : pick ? "tren_naik" : "range",
      label: short ? "Data belum cukup" : thin ? "Likuiditas tipis" : pick ? "Tren naik" : "Range",
      reason: short
        ? "Riwayat harga belum cukup untuk menghitung penyangga dan skenario (butuh minimal 60 bar)."
        : thin
          ? "Volume banyak nol pada bar terakhir — level pivot saja, tanpa konfirmasi volume."
          : pick
            ? "Harga di atas penyangga 20 & 50 hari dan sektornya Memimpin — alat utama pantulan ke penyangga."
            : "Penyangga 20 & 50 hari berdekatan dan mendatar — alat utama pantulan di kanal, bukan breakout.",
      active_tools: short
        ? []
        : thin
          ? ["pivot_level"]
          : pick
            ? ["pullback_ma20", "volume"]
            : ["sr_channel", "rsi_tepi_range"],
    };

    const plan = short ? null : planFor({ ticker, entry_ref: entry, stop: pick?.stop ?? round(close * 0.97), target: pick?.target ?? round(close * 1.06), atr14: pick?.atr14 ?? null }, 0, knob);
    const scenario = short
      ? null
      : {
          p_tp1_first: 0.62,
          p_sl_first: 0.24,
          p_timeout: 0.14,
          p_tp2_first: 0.34,
          median_periods_tp1: 7,
          median_periods_sl: 4,
          n_events: pick ? 29 : 4,
          n_open_dikeluarkan: 1,
          basis: "event breakout MA20 (filter tren aktif), horizon 60 bar",
        };

    const levels_table = short
      ? []
      : [
          { label: "Zona beli", low: round(close * 0.995), high: round(close * 1.005) },
          { label: "Batas rugi", level: pick?.stop ?? round(close * 0.97) },
          { label: "Target 1", level: round((close + (pick?.target ?? close * 1.06)) / 2) },
          { label: "Target 2", level: pick?.target ?? round(close * 1.06) },
          { label: "Penyangga 20 hari", level: round(close * 0.985) },
          { label: "Penyangga 50 hari", level: round(close * 0.96) },
          { label: "Puncak 20 hari", level: round(close * 1.04) },
          { label: "Puncak 40 hari", level: pick?.target ?? round(close * 1.06) },
          { label: "Terendah 10 hari", level: round(close * 0.97) },
        ];

    const summary_lines = short
      ? [
          `Riwayat harga ${stock.name} belum cukup 60 bar, jadi penyangga dan skenario belum dihitung.`,
          "Jalankan langkah 2 (Ambil harga harian) di halaman Data, lalu buka lagi halaman ini.",
        ]
      : [
          `Harga ${close} ${pick ? "di atas penyangga 20 & 50 hari" : "bergerak mendatar di antara penyangga dan penahan"}; rezim: ${regime.label.toLowerCase()}.`,
          `Zona beli ${round(close * 0.995)}–${round(close * 1.005)}, batas rugi ${pick?.stop ?? round(close * 0.97)}, target ${round((close + (pick?.target ?? close * 1.06)) / 2)} dan ${pick?.target ?? round(close * 1.06)}.`,
          "Angka peluang di bawah adalah frekuensi kejadian masa lalu pada level hari ini, bukan ramalan.",
        ];

    const data_status: DataStatus = {
      as_of: AS_OF,
      timeframe: "d1",
      status: short ? "partial" : "ok",
      last_data_at: "2026-10-12T16:10:00+07:00",
      computed_at: "2026-10-12T16:31:02+07:00",
      range_from: null,
      range_to: AS_OF,
      range_label: null,
      window_range_label: null,
      partial_sectors: [],
    };

    const body: StockPlanResponse = {
      api_version: "1.0",
      as_of: AS_OF,
      stock: { ticker, name: stock.name, sector_code: stock.sector_code, board: "Utama" },
      price: {
        close,
        prev_close: stock.ret_1d === null ? null : round(close / (1 + stock.ret_1d)),
        ret_1d: stock.ret_1d ?? null,
        price_basis: "adj_close",
      },
      regime,
      summary_lines,
      plan: plan as StockPlanResponse["plan"],
      scenario,
      levels_table,
      coverage: {
        bars_available: short ? 21 : 473,
        bars_from: short ? "2026-09-15" : "2024-10-14",
        bars_to: "2026-10-13",
        n_events: short ? 0 : pick ? 29 : 4,
        price_basis: "adj_close",
      },
      data_status,
    };
    return HttpResponse.json(body);
  }),
];
