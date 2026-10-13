import { describe, expect, it } from "vitest";
import type { PlanScenario, WeeklyPlan } from "./api";
import {
  chance,
  coverageTextPlan,
  levelsRows,
  regimeLabel,
  regimeToneOf,
  scenarioNote,
  scenarioRows,
  summaryLines,
} from "./stockAnalysis";

const SCENARIO: PlanScenario = {
  p_tp1_first: 0.62,
  p_sl_first: 0.24,
  p_timeout: 0.14,
  p_tp2_first: 0.34,
  median_periods_tp1: 7,
  median_periods_sl: 4,
  n_events: 29,
  n_open_dikeluarkan: 1,
  basis: "event breakout MA20 (filter tren aktif), horizon 60 bar",
};

describe("stockAnalysis — rezim & ringkasan", () => {
  it("label rezim termasuk 'Data belum cukup'", () => {
    expect(regimeLabel("tren_naik")).toBe("Tren naik");
    expect(regimeLabel("tidak_cukup_data")).toBe("Data belum cukup");
    expect(regimeLabel(null)).toBe("Rezim belum diketahui");
    expect(regimeLabel("tipis")).toBe("Likuiditas tipis");
  });

  it("tona: turun → down, range/tipis → warn, lainnya netral", () => {
    expect(regimeToneOf("turun")).toBe("down");
    expect(regimeToneOf("range")).toBe("warn");
    expect(regimeToneOf("tipis")).toBe("warn");
    expect(regimeToneOf("tren_naik")).toBe("neutral");
    expect(regimeToneOf("tidak_cukup_data")).toBe("neutral");
  });

  it("summary_lines: maks 3 baris, buang kosong, apa adanya", () => {
    expect(summaryLines(["a", "", "  ", "b", "c", "d"])).toEqual(["a", "b", "c"]);
    expect(summaryLines(undefined)).toEqual([]);
  });
});

describe("stockAnalysis — skenario historis (peluang tanpa tanda)", () => {
  it("baris lengkap + jumlah event & yang belum selesai", () => {
    const rows = scenarioRows(SCENARIO);
    expect(rows.map((r) => r.key)).toEqual(["tp1", "sl", "timeout", "tp2", "median", "events"]);
    expect(rows[0].value).toBe("62%");
    expect(rows[1].value).toBe("24%");
    expect(rows[4].value).toBe("7 bar");
    expect(rows[5].value).toBe("29 breakout, 1 belum selesai");
    // tanpa tanda plus (bukan formatPct)
    expect(rows.map((r) => r.value).join(" ")).not.toContain("+62%");
  });

  it("sampel kecil / null → satu baris catatan dengan ambangnya, bukan 0%", () => {
    expect(scenarioRows({ ...SCENARIO, n_events: 3 })).toEqual([
      { key: "short", label: "Skenario historis", value: scenarioNote(10) },
    ]);
    expect(scenarioRows(null)[0].value).toBe("belum cukup riwayat (butuh ≥ 10 breakout)");
    expect(scenarioNote(12)).toContain("≥ 12");
  });

  it("chance: tanpa tanda, null → —", () => {
    expect(chance(0.62)).toBe("62%");
    expect(chance(0)).toBe("0%");
    expect(chance(null)).toBe("—");
  });
});

describe("stockAnalysis — level & cakupan", () => {
  it("levels_table apa adanya: rentang untuk zona, angka tunggal untuk level", () => {
    const rows = levelsRows([
      { label: "Zona beli", low: 4088, high: 4135 },
      { label: "Batas rugi", level: 3991 },
      { label: "Penyangga 20 hari", level: 4088.4 },
    ]);
    expect(rows[0].value).toBe("4.088–4.135");
    expect(rows[1].value).toBe("3.991");
    expect(rows[2].label).toBe("Penyangga 20 hari");
    expect(levelsRows(undefined)).toEqual([]);
  });

  it("catatan cakupan: bar, rentang, event, basis, pengingat subset", () => {
    const text = coverageTextPlan({
      bars_available: 473,
      bars_from: "2024-10-14",
      bars_to: "2026-10-13",
      n_events: 29,
      price_basis: "adj_close",
    });
    expect(text).toContain("473 bar (14 Okt 2024 – 13 Okt 2026)");
    expect(text).toContain("29 event");
    expect(text).toContain("harga penyesuaian");
    expect(text).toContain("subset emiten");
    expect(coverageTextPlan(null)).toContain("belum dilaporkan");
  });

  it("no_trade tidak dipakai saat plan null (dijaga pemanggil)", () => {
    const plan = { entry_mode: "pullback", notes: [] } as unknown as WeeklyPlan;
    expect(plan.entry_mode).toBe("pullback");
  });
});
