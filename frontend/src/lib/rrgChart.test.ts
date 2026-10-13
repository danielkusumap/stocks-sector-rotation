import { describe, expect, it } from "vitest";
import type { RrgItem } from "./api";
import {
  AXIS_CENTER,
  CARD_MARGIN_PX,
  MIN_LABEL_DISTANCE_PX,
  STOCK_SCOPE_LIMIT,
  axisPad,
  axisTicks,
  cappedItems,
  cardPlacement,
  cardSideOf,
  describePoint,
  hasTail,
  labelledRefIds,
  legendEntries,
  legendNeedsSearch,
  orderedItems,
  pointLabel,
  segmentHitsRect,
  stockLabel,
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

  it("scope saham: ticker dulu, nama tetap ikut (docs/08 F16)", () => {
    const bbri = item("BBRI", { name: "Bank Rakyat Indonesia", rs_ratio: 103.1, rs_momentum: 101.2 });
    expect(stockLabel(bbri)).toBe("BBRI · Bank Rakyat Indonesia");
    expect(pointLabel(bbri, "stock")).toBe("BBRI");
    expect(pointLabel(bbri, "sector")).toBe("Bank Rakyat Indonesia");
    expect(describePoint(bbri, "stock")).toBe(
      "BBRI · Bank Rakyat Indonesia — Memimpin, RS-Ratio 103,10, RS-Momentum 101,20",
    );
    // scope sektor tidak berubah (regresi)
    const sektor = item("IDXFINANCE", { name: "Keuangan" });
    expect(pointLabel(sektor)).toBe("Keuangan");
    expect(stockLabel(sektor)).toBe("IDXFINANCE · Keuangan");
  });
});

describe("entri legenda (docs/06 §6.2)", () => {
  const items = [
    item("IDXFINANCE", { name: "Keuangan" }),
    item("IDXENERGY", { name: "Energi" }),
    item("BBCA", { name: "Bank Central Asia" }),
  ];

  it("tanpa pencarian: urutan dipertahankan seperti chart", () => {
    expect(legendEntries(items).map((i) => i.ref_id)).toEqual(["IDXFINANCE", "IDXENERGY", "BBCA"]);
  });

  it("pencarian cocok pada nama dan ticker, tidak mengubah urutan", () => {
    expect(legendEntries(items, "energi").map((i) => i.ref_id)).toEqual(["IDXENERGY"]);
    expect(legendEntries(items, "bbca").map((i) => i.ref_id)).toEqual(["BBCA"]);
    expect(legendEntries(items, "  bank  ").map((i) => i.ref_id)).toEqual(["BBCA"]);
    expect(legendEntries(items, "tidak ada")).toEqual([]);
  });

  it("kotak pencarian hanya muncul kalau entri > 12", () => {
    expect(legendNeedsSearch(12)).toBe(false);
    expect(legendNeedsSearch(13)).toBe(true);
    expect(legendNeedsSearch(25)).toBe(true);
  });
});

describe("posisi kartu hover (docs/06 §6.3)", () => {
  const BOX = { x0: 0, y0: 0, x1: 1000, y1: 800 };
  const CARD = { w: 120, h: 100 };
  const center = { x: 500, y: 400 };

  /** Arah gerak dari `previous` ke `point`, satuan viewBox (y ke bawah). */
  const move = (dx: number, dy: number) => ({
    point: { x: center.x + dx * 10, y: center.y + dy * 10 },
    previous: center,
  });

  /** Kartu tidak boleh menutupi segmen ekor: cuplik segmennya. */
  function overlaps(
    card: { x: number; y: number; w: number; h: number },
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): boolean {
    for (let i = 0; i <= 200; i += 1) {
      const t = i / 200;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      if (x >= card.x && x <= card.x + card.w && y >= card.y && y <= card.y + card.h) return true;
    }
    return false;
  }

  const DIRS: readonly [string, number, number, "right" | "left" | "bottom" | "top"][] = [
    ["timur", 1, 0, "right"],
    ["barat", -1, 0, "left"],
    ["selatan", 0, 1, "bottom"],
    ["utara", 0, -1, "top"],
    ["tenggara", 1, 1, "right"],
    ["barat daya", -1, 1, "left"],
    ["timur laut", 1, -1, "right"],
    ["barat laut", -1, -1, "left"],
  ];

  it("8 arah gerak: sisi dominan sesuai arah gerak", () => {
    for (const [name, dx, dy, side] of DIRS) {
      const placement = cardPlacement({ ...move(dx, dy), box: BOX, card: CARD });
      expect(placement.side, name).toBe(side);
      expect(placement.flipped, name).toBe(false);
    }
  });

  it("tidak ada arah gerak yang menaruh kartu di atas ekor/titiknya sendiri", () => {
    for (const [name, dx, dy] of DIRS) {
      const { point, previous } = move(dx, dy);
      const placement = cardPlacement({
        point,
        previous,
        box: BOX,
        card: CARD,
        pointRadius: 10,
      });
      const covers =
        point.x >= placement.x - 10 &&
        point.x <= placement.x + CARD.w + 10 &&
        point.y >= placement.y - 10 &&
        point.y <= placement.y + CARD.h + 10;
      expect(covers, name).toBe(false);
      // kotak kartu tidak menyentuh segmen ekor terakhir (previous → point)
      expect(overlaps({ ...placement, w: CARD.w, h: CARD.h }, previous, point), name).toBe(false);
    }
  });

  it("tanpa ekor (warmup): sisi menjauhi pusat chart, tetap di dalam kotak", () => {
    const side = (x: number, y: number) => cardSideOf(0, 0, BOX, { x, y });
    expect(side(950, 100)).toBe("right"); // kanan-atas
    expect(side(50, 100)).toBe("left"); // kiri-atas
    expect(side(950, 700)).toBe("right");
    expect(side(50, 700)).toBe("left");
    expect(side(500, 20)).toBe("top"); // atas-tengah
    expect(side(500, 780)).toBe("bottom");

    for (const [x, y] of [
      [950, 100],
      [50, 100],
      [500, 20],
      [500, 780],
    ] as const) {
      const placement = cardPlacement({ point: { x, y }, previous: null, box: BOX, card: CARD });
      expect(placement.x).toBeGreaterThanOrEqual(CARD_MARGIN_PX);
      expect(placement.y).toBeGreaterThanOrEqual(CARD_MARGIN_PX);
      expect(placement.x + CARD.w).toBeLessThanOrEqual(BOX.x1 - CARD_MARGIN_PX);
      expect(placement.y + CARD.h).toBeLessThanOrEqual(BOX.y1 - CARD_MARGIN_PX);
    }
  });

  it("titik di tepi: sisi yang tidak cukup ruang diganti, bukan keluar kotak", () => {
    // titik mentok kanan, gerak ke timur → sisi kanan tidak muat → kartu di sisi lain
    const flipped = cardPlacement({
      point: { x: 990, y: 400 },
      previous: { x: 900, y: 400 },
      box: BOX,
      card: CARD,
    });
    expect(flipped.flipped).toBe(true);
    expect(flipped.x).toBeGreaterThanOrEqual(CARD_MARGIN_PX);
    expect(flipped.y).toBeGreaterThanOrEqual(CARD_MARGIN_PX);
    expect(flipped.x + CARD.w).toBeLessThanOrEqual(BOX.x1 - CARD_MARGIN_PX);
    expect(flipped.y + CARD.h).toBeLessThanOrEqual(BOX.y1 - CARD_MARGIN_PX);

    // titik mentok atas, gerak ke utara → tidak ada ruang di atas
    const down = cardPlacement({
      point: { x: 500, y: 4 },
      previous: { x: 500, y: 80 },
      box: BOX,
      card: CARD,
    });
    expect(down.flipped).toBe(true);
    expect(down.y).toBeGreaterThanOrEqual(CARD_MARGIN_PX);
    expect(down.y + CARD.h).toBeLessThanOrEqual(BOX.y1 - CARD_MARGIN_PX);

    // titik mentok sudut kanan-atas, gerak ke timur laut → tetap di dalam kotak
    const corner = cardPlacement({
      point: { x: 995, y: 3 },
      previous: { x: 900, y: 80 },
      box: BOX,
      card: CARD,
    });
    expect(corner.x).toBeGreaterThanOrEqual(CARD_MARGIN_PX);
    expect(corner.y).toBeGreaterThanOrEqual(CARD_MARGIN_PX);
    expect(corner.x + CARD.w).toBeLessThanOrEqual(BOX.x1 - CARD_MARGIN_PX);
    expect(corner.y + CARD.h).toBeLessThanOrEqual(BOX.y1 - CARD_MARGIN_PX);
  });

  it("kartu tidak menutupi titiknya sendiri walau di tepi", () => {
    for (const point of [
      { x: 990, y: 400 },
      { x: 10, y: 400 },
      { x: 500, y: 4 },
      { x: 500, y: 796 },
      { x: 995, y: 3 },
      { x: 5, y: 797 },
    ]) {
      const placement = cardPlacement({
        point,
        previous: { x: point.x - 30, y: point.y + 30 },
        box: BOX,
        card: CARD,
        pointRadius: 10,
      });
      const covers =
        point.x >= placement.x - 10 &&
        point.x <= placement.x + CARD.w + 10 &&
        point.y >= placement.y - 10 &&
        point.y <= placement.y + CARD.h + 10;
      expect(covers, JSON.stringify(point)).toBe(false);
    }
  });

  it("ekor yang menghalangi kandidat terbaik: sisi lain dipilih", () => {
    // gerak ke timur, tapi ada segmen ekor di depan-kanan titik (kail) → sisi kanan ditolak
    const point = { x: 300, y: 400 };
    const tail = [
      { x: 420, y: 450 },
      { x: 330, y: 410 },
    ];
    const placement = cardPlacement({
      point,
      previous: tail[tail.length - 1],
      box: BOX,
      card: CARD,
      tail,
    });
    expect(placement.side).not.toBe("right");
    expect(
      tail.every((from, index) =>
        !segmentHitsRect(from, index + 1 < tail.length ? tail[index + 1] : point, {
          x: placement.x,
          y: placement.y,
          w: CARD.w,
          h: CARD.h,
        }),
      ),
    ).toBe(true);
  });

  it("semua kombinasi sudut tetap di dalam kotak, margin 8 px", () => {
    for (const x of [4, 200, 390, 600, 776]) {
      for (const y of [4, 150, 300, 450, 604]) {
        const placement = cardPlacement({
          point: { x, y },
          previous: { x: x - 8, y: y + 8 },
          box: BOX,
          card: CARD,
        });
        expect(placement.x).toBeGreaterThanOrEqual(CARD_MARGIN_PX);
        expect(placement.y).toBeGreaterThanOrEqual(CARD_MARGIN_PX);
        expect(placement.x + CARD.w).toBeLessThanOrEqual(BOX.x1 - CARD_MARGIN_PX);
        expect(placement.y + CARD.h).toBeLessThanOrEqual(BOX.y1 - CARD_MARGIN_PX);
      }
    }
  });

  it("jarak dari titik mengikuti `gap` selama ada ruang", () => {
    const placement = cardPlacement({
      point: { x: 300, y: 300 },
      previous: { x: 250, y: 300 },
      box: BOX,
      card: CARD,
      gap: 12,
    });
    expect(placement.x).toBe(312);
    expect(placement.y).toBe(300 - CARD.h / 2); // gerak mendatar → tinggi dipusatkan
  });
});
