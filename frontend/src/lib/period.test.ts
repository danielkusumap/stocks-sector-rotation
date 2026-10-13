import { describe, expect, it } from "vitest";
import type { DataStatus, IngestRun, WeeklyPicksResponse } from "./api";
import { NO_PERIOD, periodFromStatus, periodLabel, runPeriodLabel, weeklyPeriodLabel } from "./period";

const status = (extra: Partial<DataStatus> = {}): DataStatus => ({
  as_of: "2026-10-09",
  timeframe: "w1_fri",
  status: "ok",
  last_data_at: "2026-10-09T17:02:00+07:00",
  computed_at: "2026-10-09T17:05:00+07:00",
  partial_sectors: [],
  ...extra,
});

const run = (kind: string, extra: Partial<IngestRun> = {}): IngestRun => ({
  run_id: 1,
  kind,
  status: "ok",
  started_at: "2026-10-13T07:02:11+07:00",
  finished_at: "2026-10-13T07:03:00+07:00",
  phase: null,
  rows: null,
  rows_total: null,
  percent: 100,
  message: null,
  failed_tickers: [],
  ...extra,
});

describe("periodLabel", () => {
  it("menyusun format yang diminta docs/08 F13 C", () => {
    expect(
      periodLabel({
        timeframe: "w1_fri",
        window: "3m",
        rangeLabel: "5–9 Okt 2026",
        windowRangeLabel: "15 Jul – 12 Okt 2026",
      }),
    ).toBe("Mingguan (Sen–Jum) · 5–9 Okt 2026 · jendela 3 bln (15 Jul – 12 Okt 2026)");
  });

  it("tanpa rentang jendela: kurungnya dihilangkan, bukan dibiarkan kosong", () => {
    expect(periodLabel({ timeframe: "d1", window: "1w", rangeLabel: "12 Okt 2026" })).toBe(
      "Harian · 12 Okt 2026 · jendela 1 mgg",
    );
  });

  it("range_label null/absen/kosong → 'belum ada data', bukan menebak dari as_of", () => {
    for (const rangeLabel of [null, undefined, "", "   "]) {
      expect(periodLabel({ timeframe: "midday", window: "3m", rangeLabel })).toContain(NO_PERIOD);
    }
  });

  it("periodFromStatus membaca data_status apa adanya", () => {
    expect(periodFromStatus(status({ range_label: "5–9 Okt 2026" }), { timeframe: "w1_fri", window: "3m" })).toBe(
      "Mingguan (Sen–Jum) · 5–9 Okt 2026 · jendela 3 bln",
    );
    expect(periodFromStatus(null, { timeframe: "d1", window: "3m" })).toContain(NO_PERIOD);
    expect(periodFromStatus(status({ range_label: "12 Okt 2026" }), { timeframe: "d1", window: "3m" })).toContain(
      "12 Okt 2026",
    );
  });
});

describe("weeklyPeriodLabel", () => {
  const picks: WeeklyPicksResponse = {
    api_version: "1.1",
    week_end: "2026-10-09",
    week_start: "2026-10-05",
    week_label: "5–9 Okt 2026",
    is_final: true,
    sectors: [],
    stocks: [],
  };

  it("memakai week_label dari API", () => {
    expect(weeklyPeriodLabel(picks, "3m")).toBe("Mingguan (Sen–Jum) · 5–9 Okt 2026 · jendela 3 bln");
  });

  it("pekan berjalan → catatan 'pekan berjalan' (bukan error)", () => {
    expect(weeklyPeriodLabel({ ...picks, is_final: false }, "3m")).toContain("pekan berjalan");
  });

  it("week_label kosong → cadangan week_start–week_end; kosong total → 'belum ada data'", () => {
    expect(weeklyPeriodLabel({ ...picks, week_label: null }, "3m")).toContain("5 Okt 2026–9 Okt 2026");
    expect(weeklyPeriodLabel({ ...picks, week_label: null, week_start: null }, "3m")).toContain(NO_PERIOD);
    expect(weeklyPeriodLabel(null, "3m")).toContain(NO_PERIOD);
  });
});

describe("runPeriodLabel", () => {
  it("import & harga: tidak mengarang tanggal", () => {
    expect(runPeriodLabel(run("import_excel"))).toBe("tidak terikat periode (daftar emiten)");
    expect(runPeriodLabel(run("prices_daily", { params_json: { mode: "daily" } }))).toBe("bar harian terakhir");
    expect(runPeriodLabel(run("prices_intraday", { result_json: { mode: "intraday" } }))).toBe(
      "bar intraday hari ini",
    );
  });

  it("compute_all memakai timeframe dari result_json/params_json", () => {
    expect(runPeriodLabel(run("compute_all", { result_json: { timeframe: "d1" } }))).toBe("hitungan Harian");
    expect(runPeriodLabel(run("compute_all", { params_json: { timeframe: "w1_fri" } }))).toBe(
      "hitungan Mingguan (Sen–Jum)",
    );
  });

  it("compute_signals memakai week_end dari result_json; midday menyebut gate-nya", () => {
    expect(runPeriodLabel(run("compute_signals", { result_json: { week_end: "2026-10-09" } }))).toBe(
      "pekan sampai 9 Okt 2026",
    );
    expect(runPeriodLabel(run("midday", { result_json: { gate: "stale" } }))).toBe(
      "tengah hari (gate stale)",
    );
  });

  it("tanpa run & kind tak dikenal tidak error", () => {
    expect(runPeriodLabel(null)).toBe("belum ada run");
    expect(runPeriodLabel(run("compute_index"))).toBe(NO_PERIOD);
  });
});
