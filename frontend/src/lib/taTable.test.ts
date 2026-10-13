import { describe, expect, it } from "vitest";
import type { TaBreakout, TaSummaryItem } from "./api";
import {
  breakoutCellText,
  coverageText,
  dayMonth,
  filterCompareText,
  gainSinceText,
  latestText,
  periodsText,
  resultLabel,
  resultTone,
  statsOf,
  summaryMap,
  winRateText,
} from "./taTable";

const STATS = {
  n_events: 9,
  win: 5,
  loss: 3,
  expired: 1,
  open: 0,
  win_rate: 0.625,
  median_periods_win: 9,
  median_periods_loss: 6,
};

const EMPTY_STATS = {
  n_events: 0,
  win: 0,
  loss: 0,
  expired: 0,
  open: 0,
  win_rate: null,
  median_periods_win: null,
  median_periods_loss: null,
};

const LATEST: TaBreakout = {
  signal_date: "2026-10-06",
  entry_date: "2026-10-07",
  entry_price: 4012.5,
  entry_basis: "open",
  periods_since: 5,
  gain_since: 0.0592,
  result: "open",
  exit_date: null,
  exit_price: null,
  periods: null,
};

const ITEM: TaSummaryItem = {
  ref_id: "BBRI",
  name: "Bank Rakyat Indonesia",
  sector_code: "IDXFINANCE",
  close: 4250,
  ma: 4110,
  above_ma: true,
  ...STATS,
  last_breakout: LATEST,
};

describe("taTable — label angka (tanpa menghitung apa pun)", () => {
  it("win_rate null → '—', bukan '0%'", () => {
    expect(winRateText(null)).toBe("—");
    expect(winRateText(undefined)).toBe("—");
    expect(winRateText(0.625)).toBe("62,5%");
  });

  it("median periode & gain", () => {
    expect(periodsText(9)).toBe("9 periode");
    expect(periodsText(null)).toBe("—");
    expect(gainSinceText(0.0592)).toBe("+5,92%");
    expect(gainSinceText(null)).toBe("—");
  });

  it("baris perbandingan filter dari SATU respons (filter_on/filter_off)", () => {
    expect(filterCompareText(STATS, { ...STATS, n_events: 14, win_rate: 0.462 })).toBe(
      "dengan filter tren: 62,5% (9 event) · tanpa filter: 46,2% (14 event)",
    );
    expect(filterCompareText(EMPTY_STATS, EMPTY_STATS)).toContain("— (0 event)");
  });

  it("statsOf memilih varian sesuai toggle, tahan respons tanpa stats", () => {
    const detail = { stats: { filter_on: STATS, filter_off: { ...STATS, n_events: 14 } } };
    expect(statsOf(detail, true)?.n_events).toBe(9);
    expect(statsOf(detail, false)?.n_events).toBe(14);
    expect(statsOf(null, true)).toBeNull();
  });
});

describe("taTable — label hasil & event", () => {
  it("hasil event → teks Indonesia + tona", () => {
    expect(resultLabel("win")).toBe("+5% dulu");
    expect(resultLabel("loss")).toBe("−5% dulu");
    expect(resultLabel("open")).toBe("belum selesai");
    expect(resultLabel("expired")).toBe("lewat batas");
    expect(resultLabel(null)).toBe("—");
    expect(resultTone("win")).toBe("ok");
    expect(resultTone("loss")).toBe("partial");
    expect(resultTone("expired")).toBe("idle");
  });

  it("baris 'terakhir breakout' menyebut tanggal, entry, harga penyesuaian, umur", () => {
    const text = latestText(LATEST);
    expect(text).toContain("sinyal 6 Okt 2026");
    expect(text).toContain("4.013 (harga penyesuaian)");
    expect(text).toContain("5 periode sejak entry");
  });

  it("tanpa event → kalimat kosong yang jelas, bukan '—'", () => {
    expect(latestText(null)).toBe("belum ada breakout pada periode MA ini");
  });

  it("kolom insight: '6 Okt · 5 periode' + sel kosong saat belum ada event", () => {
    expect(breakoutCellText(ITEM)).toBe("6 Okt · 5 periode");
    expect(breakoutCellText({ ...ITEM, last_breakout: null })).toBeNull();
    expect(dayMonth("2026-10-06")).toBe("6 Okt");
    expect(dayMonth(null)).toBe("—");
  });
});

describe("taTable — cakupan & peta ringkasan", () => {
  it("catatan cakupan menyebut diuji/dilewati, rentang, dan basis harga", () => {
    const text = coverageText(
      { refs_tested: 916, refs_skipped_short_history: 6, bars_from: "2024-10-14", bars_to: "2026-10-13", price_basis: "adj_close" },
      "stock",
      60,
    );
    expect(text).toBe(
      "angka dari 916 emiten; 6 emiten dilewati karena riwayat kurang dari 60 bar · data 14 Okt 2024 – 13 Okt 2026 · harga penyesuaian",
    );
    expect(coverageText(null, "sector", 60)).toContain("belum dilaporkan");
  });

  it("summaryMap di-key ref_id supaya tabel bisa join satu permintaan", () => {
    const map = summaryMap([ITEM, { ...ITEM, ref_id: "BBCA" }]);
    expect(map.get("BBRI")?.win_rate).toBe(0.625);
    expect(map.get("BBCA")?.ref_id).toBe("BBCA");
    expect(map.get("TLKM")).toBeUndefined();
    expect(summaryMap(undefined).size).toBe(0);
  });
});
