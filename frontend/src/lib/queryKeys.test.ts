import { describe, expect, it } from "vitest";
import { keyFor } from "./queryKeys";

describe("keyFor", () => {
  it("tidak bergantung urutan kunci", () => {
    expect(keyFor("stocks", { limit: 50, offset: 0 })).toEqual(
      keyFor("stocks", { offset: 0, limit: 50 }),
    );
  });

  it("berubah ketika filter berubah", () => {
    expect(keyFor("sectors-summary", { timeframe: "d1" })).not.toEqual(
      keyFor("sectors-summary", { timeframe: "w1_fri" }),
    );
    expect(keyFor("sectors-summary", { quadrant: ["leading"] })).not.toEqual(
      keyFor("sectors-summary", { quadrant: ["leading", "improving"] }),
    );
  });

  it("mengabaikan param kosong supaya kunci sama dengan request yang sama", () => {
    expect(keyFor("stocks", { q: "", sector: [], offset: 0 })).toEqual(
      keyFor("stocks", { offset: 0 }),
    );
  });

  it("menulis array sebagai satu elemen kunci", () => {
    expect(keyFor("rrg", { sector: ["IDXFINANCE", "IDXENERGY"] })).toEqual([
      "rrg",
      "sector",
      "IDXFINANCE,IDXENERGY",
    ]);
  });
});
