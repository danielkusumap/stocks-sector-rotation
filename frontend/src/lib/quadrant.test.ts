import { describe, expect, it } from "vitest";
import { QUADRANTS } from "./api";
import { QUADRANT_COLOR, QUADRANT_DESC, QUADRANT_LABEL, isQuadrant, quadrantLabel } from "./quadrant";

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
