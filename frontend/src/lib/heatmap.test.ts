import { describe, expect, it } from "vitest";
import type { HeatmapResponse } from "./api";
import {
  HEATMAP_ALPHA_MAX,
  HEATMAP_ALPHA_MIN,
  heatmapAlpha,
  heatmapColumnLabel,
  heatmapScale,
  heatmapToken,
} from "./heatmap";

const rows: HeatmapResponse["rows"] = [
  { code: "IDXFINANCE", name_id: "Keuangan", values: { "1d": 0.0021, "1w": 0.0181, "1m": 0.0412, "3m": 0.0903 } },
  { code: "IDXENERGY", name_id: "Energi", values: { "1d": -0.008, "1w": -0.043, "1m": -0.061, "3m": -0.078 } },
  { code: "IDXNONCYC", name_id: "Konsumen Non-Primer", values: { "1d": 0, "1w": null, "1m": 0.004, "3m": 0.02 } },
];

describe("skala & alpha peta panas (docs/06 §5)", () => {
  it("skala = |nilai| terbesar di grid", () => {
    expect(heatmapScale(rows)).toBeCloseTo(0.0903, 6);
  });

  it("alpha di dalam 0,08–0,55 dan naik bersama |nilai|", () => {
    const scale = heatmapScale(rows);
    const small = heatmapAlpha(0.0021, scale);
    const big = heatmapAlpha(0.0903, scale);
    expect(big).toBeCloseTo(HEATMAP_ALPHA_MAX, 6);
    expect(small).toBeGreaterThanOrEqual(HEATMAP_ALPHA_MIN);
    expect(small).toBeLessThan(big);
  });

  it("null / 0 / NaN tidak diberi latar", () => {
    expect(heatmapAlpha(null, 0.1)).toBe(0);
    expect(heatmapAlpha(0, 0.1)).toBe(HEATMAP_ALPHA_MIN); // 0 tetap sel terkecil, bukan tanpa warna
    expect(heatmapAlpha(Number.NaN, 0.1)).toBe(0);
    expect(heatmapAlpha(0.05, 0)).toBe(0); // grid tanpa nilai
  });

  it("token warna dari arah nilai, bukan hex dari API (ADR-010)", () => {
    expect(heatmapToken(0.0021)).toBe("var(--up)");
    expect(heatmapToken(-0.043)).toBe("var(--down)");
    expect(heatmapToken(0)).toBeNull();
    expect(heatmapToken(null)).toBeNull();
  });

  it("label kolom bahasa Indonesia: H = hari, M = minggu, B = bulan", () => {
    expect(heatmapColumnLabel("1d")).toBe("1H");
    expect(heatmapColumnLabel("1w")).toBe("1M");
    expect(heatmapColumnLabel("1m")).toBe("1B");
    expect(heatmapColumnLabel("3m")).toBe("3B");
    expect(heatmapColumnLabel("2y")).toBe("2y"); // kolom tak dikenal ditampilkan apa adanya
  });
});
