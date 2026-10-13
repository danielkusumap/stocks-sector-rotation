import { describe, expect, it } from "vitest";
import { QUADRANTS } from "./api";
import {
  QUADRANT_COLOR,
  QUADRANT_DESC,
  QUADRANT_LABEL,
  filterByQuadrant,
  isQuadrant,
  quadrantLabel,
} from "./quadrant";

describe("kuadran (docs/03 §3)", () => {
  it("semua kuadran punya label, keterangan, dan warna token", () => {
    for (const quadrant of QUADRANTS) {
      expect(QUADRANT_LABEL[quadrant]).toBeTruthy();
      expect(QUADRANT_DESC[quadrant]).toMatch(/\.$/);
      expect(QUADRANT_COLOR[quadrant]).toMatch(/^var\(--q-/);
    }
  });

  it("label Bahasa Indonesia, kode tetap Inggris", () => {
    expect(quadrantLabel("leading")).toBe("Memimpin");
    expect(quadrantLabel("improving")).toBe("Membaik");
    expect(quadrantLabel("weakening")).toBe("Melemah");
    expect(quadrantLabel("lagging")).toBe("Tertinggal");
    expect(quadrantLabel(null)).toBe("—");
  });

  it("isQuadrant menyaring nilai dari URL", () => {
    expect(isQuadrant("leading")).toBe(true);
    expect(isQuadrant("memimpin")).toBe(false);
  });
});

describe("filterByQuadrant (docs/06 §6.4)", () => {
  const items = [
    { ref_id: "BBRI", quadrant: "leading" as const },
    { ref_id: "BBCA", quadrant: "leading" as const },
    { ref_id: "KLBF", quadrant: "improving" as const },
    { ref_id: "GOTO", quadrant: null },
  ];

  it("Semua (null) = perilaku lama, termasuk item tanpa kuadran", () => {
    expect(filterByQuadrant(items, null).map((i) => i.ref_id)).toEqual([
      "BBRI",
      "BBCA",
      "KLBF",
      "GOTO",
    ]);
  });

  it("satu kuadran hanya memuat item kuadran itu", () => {
    expect(filterByQuadrant(items, "leading").map((i) => i.ref_id)).toEqual(["BBRI", "BBCA"]);
    expect(filterByQuadrant(items, "lagging")).toHaveLength(0);
  });

  it("item tanpa kuadran tidak diklaim milik kuadran mana pun", () => {
    for (const quadrant of QUADRANTS) {
      expect(filterByQuadrant(items, quadrant).some((i) => i.ref_id === "GOTO")).toBe(false);
    }
  });

  it("kuadran kosong → daftar kosong, bukan galat", () => {
    expect(filterByQuadrant([], "improving")).toEqual([]);
  });

  it("daftar asal tidak diubah", () => {
    const source = [...items];
    filterByQuadrant(source, "improving");
    expect(source).toEqual(items);
  });
});
