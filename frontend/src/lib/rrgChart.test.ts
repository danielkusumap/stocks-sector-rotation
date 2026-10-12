import { describe, expect, it } from "vitest";
import type { RrgItem } from "./api";
import {
  AXIS_CENTER,
  MIN_LABEL_DISTANCE_PX,
  STOCK_SCOPE_LIMIT,
  axisPad,
  axisTicks,
  cappedItems,
  describePoint,
  hasTail,
  labelledRefIds,
  orderedItems,
  tailSegmentOpacity,
  tickLabel,
  viewBoxDistanceForScreenPx,
} from "./rrgChart";

const item = (ref_id: string, extra: Partial<RrgItem> = {}): RrgItem => ({
  ref_id,
  name: ref_id,
  color_hex: "#888888",
  rs_ratio: 101,
  rs_momentum: 100.5,
  rs_ratio_change_1p: null,
  rs_momentum_change_1p: null,
  streak_weeks: 0,
  quadrant: "leading",
  quadrant_prev: null,
  transition: null,
  quadrant_age_periods: 1,
  score: 50,
  rank_score: null,
  ret_1w: null,
  median_turnover_20d_idr: null,
  tail: [],
  ...extra,
});

describe("rentang sumbu (docs/06 §6)", () => {
  it("selalu memuat 100 dan simetris", () => {
    for (const values of [[102.31, 96.42], [100.1], [100, 100]]) {
      const pad = axisPad(values);
      expect(AXIS_CENTER - pad).toBeLessThanOrEqual(Math.min(...values));
      expect(AXIS_CENTER + pad).toBeGreaterThanOrEqual(Math.max(...values));
    }
  });

  it("pad minimal 0,6 dan 1,15× jarak terjauh dari 100", () => {
    expect(axisPad([100, 100])).toBe(0.6);
    expect(axisPad([100, 104])).toBeCloseTo(4.6, 5);
    expect(axisPad([96.42, 102.31])).toBeCloseTo(1.15 * 3.58, 5);
  });

  it("ticks = 100 dan ±pad×0,5", () => {
    expect(axisTicks(4)).toEqual([98, 100, 102]);
  });

  it("label tick tanpa desimal kalau bulat", () => {
    expect(tickLabel(100)).toBe("100");
    expect(tickLabel(101.5)).toBe("101,50");
  });
});

describe("ekor bertingkat (docs/06 §6)", () => {
  it("0,25 → 1,0 ke arah titik terakhir", () => {
    expect(tailSegmentOpacity(0, 3)).toBe(0.25);
    expect(tailSegmentOpacity(1, 3)).toBe(1);
    const four = [0, 1, 2].map((i) => tailSegmentOpacity(i, 4));
    expect(four[0]).toBe(0.25);
    expect(four[2]).toBe(1);
    expect(four[1]).toBeGreaterThan(four[0]);
    expect(four[1]).toBeLessThan(four[2]);
  });

  it("ekor 2 titik diratakan dan ekor < 2 titik tidak digambar", () => {
    expect(tailSegmentOpacity(0, 2)).toBe(1);
    expect(hasTail(item("A", { tail: [{ as_of: "2026-10-09", rs_ratio: 101, rs_momentum: 100 }] }))).toBe(false);
    expect(hasTail(item("A", { tail: [] }))).toBe(false);
    expect(
      hasTail(
        item("A", {
          tail: [
            { as_of: "2026-10-02", rs_ratio: 100, rs_momentum: 100 },
            { as_of: "2026-10-09", rs_ratio: 101, rs_momentum: 100 },
          ],
        }),
      ),
    ).toBe(true);
  });
});

describe("urutan & batas titik", () => {
  it("sektor diurutkan rank_score, saham diurutkan skor", () => {
    const items = [
      item("C", { rank_score: 3, score: 10 }),
      item("A", { rank_score: 1, score: 90 }),
      item("B", { rank_score: 2, score: 50 }),
    ];
    expect(orderedItems(items, "sector").map((i) => i.ref_id)).toEqual(["A", "B", "C"]);
    expect(orderedItems(items, "stock").map((i) => i.ref_id)).toEqual(["A", "B", "C"]);
  });

  it("scope saham dipotong 25 titik + sisa dihitung", () => {
    const many = Array.from({ length: 60 }, (_, i) => item(`S${i}`, { score: 60 - i }));
    const { items, hiddenCount } = cappedItems(many, "stock");
    expect(items).toHaveLength(STOCK_SCOPE_LIMIT);
    expect(items[0].ref_id).toBe("S0");
    expect(hiddenCount).toBe(35);
  });

  it("scope sektor tidak dipotong", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => item(`X${i}`));
    expect(cappedItems(eleven, "sector").hiddenCount).toBe(0);
    expect(cappedItems(eleven, "sector").items).toHaveLength(11);
  });
});

describe("label anti-tumpuk", () => {
  it("titik yang berdekatan (<24) tidak diberi label", () => {
    const labels = labelledRefIds([
      { refId: "A", label: "A", x: 100, y: 100 },
      { refId: "B", label: "B", x: 110, y: 105 },
      { refId: "C", label: "C", x: 200, y: 200 },
    ]);
    expect([...labels]).toEqual(["A", "C"]);
  });

  it("label mengikuti urutan yang diberikan (titik kuat menang)", () => {
    const labels = labelledRefIds([
      { refId: "lemah", label: "lemah", x: 50, y: 50 },
      { refId: "kuat", label: "kuat", x: 55, y: 50 },
    ]);
    expect(labels.has("lemah")).toBe(true);
    expect(labels.has("kuat")).toBe(false);
  });

  it("nama panjang menahan label lain yang kotaknya bertumpuk walau titiknya jauh", () => {
    // jarak titik 30 unit (> ambang 24), tapi "Properti & Real Estat" memanjang ke kanan
    const labels = labelledRefIds(
      [
        { refId: "IDXPROPERT", label: "Properti & Real Estat", x: 100, y: 100 },
        { refId: "IDXHEALTH", label: "Kesehatan", x: 130, y: 100 },
      ],
      24,
    );
    expect([...labels]).toEqual(["IDXPROPERT"]);
  });
});

describe("ambang label dalam pixel layar (docs/06 §6)", () => {
  it("mengubah 24 px layar menjadi satuan viewBox sesuai lebar render", () => {
    // viewBox 780 digambar pada 780 px → 1 unit = 1 px
    expect(viewBoxDistanceForScreenPx(MIN_LABEL_DISTANCE_PX, 780, 780)).toBe(24);
    // separuh lebar → 1 unit = 0,5 px → ambang dua kali lipat
    expect(viewBoxDistanceForScreenPx(MIN_LABEL_DISTANCE_PX, 390, 780)).toBe(48);
    // chart lebar (1280) → 1 unit = 1,64 px → ambang lebih kecil dari 24 unit
    expect(viewBoxDistanceForScreenPx(MIN_LABEL_DISTANCE_PX, 1280, 780)).toBeCloseTo(14.625, 3);
  });

  it("jatuh kembali ke nilai px kalau lebar belum terukur (0)", () => {
    expect(viewBoxDistanceForScreenPx(MIN_LABEL_DISTANCE_PX, 0, 780)).toBe(24);
  });

  it("di layar sempit (640 px) titik yang tadinya boleh berlabel jadi disembunyikan", () => {
    const points = [
      { refId: "A", label: "A", x: 100, y: 100 },
      { refId: "B", label: "B", x: 125, y: 100 }, // jarak 25 unit
    ];
    // 1280 px: ambang ≈ 14,6 unit → kotak kedua label masih lepas
    expect([...labelledRefIds(points, viewBoxDistanceForScreenPx(24, 1280, 780))]).toEqual(["A", "B"]);
    // 640 px: ambang ≈ 29,3 unit → kotak B bertumpuk kotak A
    expect([...labelledRefIds(points, viewBoxDistanceForScreenPx(24, 640, 780))]).toEqual(["A"]);
  });
});

describe("baris aria-live", () => {
  it("berisi nama, kuadran Indonesia, RS-Ratio, RS-Momentum", () => {
    expect(
      describePoint(item("IDXFINANCE", { name: "Keuangan", rs_ratio: 102.31, rs_momentum: 100.84 })),
    ).toBe("Keuangan — Memimpin, RS-Ratio 102,31, RS-Momentum 100,84");
  });
});
