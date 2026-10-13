import { describe, expect, it } from "vitest";
import type { FreshnessResponse, MetaConfigResponse } from "./api";
import { configRows, dailyFreshnessText, gateView, probeRows } from "./runStatus";

const freshness = (
  midday: Partial<FreshnessResponse["midday_gate"]>,
  daily?: FreshnessResponse["daily_ingest"],
): FreshnessResponse => ({
  api_version: "1.0",
  midday_gate: {
    status: "ok",
    as_of_date: "2026-10-13",
    last_bar_at: "2026-10-13T11:42:00+07:00",
    required_bar_time: "11:30",
    probes: [{ ticker: "BBCA", last_bar_at: "2026-10-13T11:42:00+07:00" }],
    ...midday,
  },
  daily_ingest: daily ?? { status: "ok", last_data_at: "2026-10-12T16:10:00+07:00" },
});

describe("gateView", () => {
  it("ok: pill ok, tanpa kalimat tindakan", () => {
    const view = gateView(freshness({}));
    expect(view.tone).toBe("ok");
    expect(view.label).toBe("ok");
    expect(view.action).toBeNull();
    expect(view.detail).toContain("syarat bar ≥ 11:30 WIB");
  });

  it("stale: wajib punya kalimat tindakan yang menyebut syarat + waktu terakhir", () => {
    const view = gateView(
      freshness({ status: "stale", last_bar_at: "2026-10-13T11:05:00+07:00" }),
    );
    expect(view.tone).toBe("stale");
    expect(view.action).toContain("Data Yahoo belum sampai 11:30 WIB");
    expect(view.action).toContain("11:05 WIB");
    expect(view.action).toContain("coba lagi nanti");
  });

  it("stale tanpa bar: kalimat tindakan tetap ada tanpa tanda kurung kosong", () => {
    const view = gateView(freshness({ status: "stale", last_bar_at: null }));
    expect(view.tone).toBe("stale");
    expect(view.action).toBe("Data Yahoo belum sampai 11:30 WIB, coba lagi nanti.");
    expect(view.detail).toContain("Belum ada bar hari ini");
  });

  it("null / kosong / status tak dikenal tidak pernah melempar error", () => {
    for (const input of [null, undefined, {} as FreshnessResponse, freshness({ status: "" as "ok" })]) {
      const view = gateView(input);
      expect(view.tone).toBe("idle");
      expect(view.label).toBe("tidak diketahui");
      expect(view.action).toBeNull();
    }
  });
});

describe("probeRows", () => {
  it("meneruskan ticker + waktu bar terakhir", () => {
    expect(probeRows(freshness({}))).toEqual([
      { ticker: "BBCA", last_bar_at: "2026-10-13T11:42:00+07:00" },
    ]);
  });

  it("daftar kosong / null jadi []", () => {
    expect(probeRows(null)).toEqual([]);
    expect(probeRows({} as FreshnessResponse)).toEqual([]);
    expect(probeRows(freshness({ probes: [] }))).toEqual([]);
  });

  it("probe tanpa waktu jadi null (ditampilkan —, bukan 0)", () => {
    expect(probeRows(freshness({ probes: [{ ticker: "TLKM", last_bar_at: null }] }))).toEqual([
      { ticker: "TLKM", last_bar_at: null },
    ]);
  });
});

describe("dailyFreshnessText", () => {
  it("menyebut status + waktu data terakhir (WIB)", () => {
    expect(dailyFreshnessText(freshness({}))).toBe(
      "Ingest harga harian: ok · data terakhir 12 Okt 2026 16:10",
    );
  });

  it("null / tanpa last_data_at tetap ada kalimat", () => {
    expect(dailyFreshnessText(null)).toContain("belum ada informasi");
    expect(dailyFreshnessText(freshness({}, { status: "stale", last_data_at: null }))).toBe(
      "Ingest harga harian: stale · belum ada data",
    );
  });
});

describe("configRows", () => {
  const config: MetaConfigResponse = {
    api_version: "1.0",
    universe: { min_turnover_idr: 1_000_000_000, min_price_idr: 100, max_rsi: 75 },
    rrg: {
      ema_span: 14,
      roc_lag: 10,
      weekly: { ema_span: 14, roc_lag: 4 },
      min_points: { d1: 60, w1: 30, w1_fri: 30, midday: 60 },
    },
    timeframes: ["d1", "w1", "w1_fri", "midday"],
    windows: ["1w", "1m", "3m", "6m", "1y", "ytd"],
    midday_gate_min_bar_time: "11:30",
    last_ingest: {
      prices_daily: "2026-10-12T16:31:02+07:00",
      intraday: "2026-10-12T16:31:40+07:00",
      signals_weekly: null,
    },
  };

  it("menampilkan ambang universe + parameter RRG (format Indonesia)", () => {
    const values = Object.fromEntries(configRows(config).map((r) => [r.label, r.value]));
    expect(values["Turnover minimum (Rp)"]).toBe("1,0 M");
    expect(values["Harga minimum (Rp)"]).toBe("100");
    expect(values["RSI maksimum"]).toBe("75");
    expect(values["EMA / ROC lag harian"]).toBe("14 / 10");
    expect(values["Minimum titik RRG"]).toBe("d1 60 · w1 30 · w1_fri 30 · midday 60");
  });

  it("last_ingest null ditampilkan — dan config kosong jadi []", () => {
    const values = Object.fromEntries(configRows(config).map((r) => [r.label, r.value]));
    expect(values["Harga harian terakhir"]).toBe("12 Okt 2026 16:31");
    expect(values["Sinyal mingguan terakhir"]).toBe("—");
    expect(configRows(null)).toEqual([]);
    expect(configRows({} as MetaConfigResponse)).toEqual([]);
  });
});
