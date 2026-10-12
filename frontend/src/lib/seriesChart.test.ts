import { describe, expect, it } from "vitest";
import { base100, combinedRange, polyline } from "./seriesChart";

describe("base100 (hanya untuk menggambar, bukan angka yang ditampilkan)", () => {
  it("titik pertama jadi 100", () => {
    const scaled = base100([104.31, 105, 102]);
    expect(scaled[0]).toBe(100);
    expect(scaled[1]).toBeCloseTo((105 / 104.31) * 100, 9);
    expect(scaled[2]).toBeCloseTo((102 / 104.31) * 100, 9);
  });

  it("seri kosong / tanpa nilai valid tetap menghasilkan 100", () => {
    expect(base100([])).toEqual([]);
    expect(base100([0, 0])).toEqual([100, 100]);
  });
});

describe("polyline", () => {
  it("memetakan ke kotak gambar dengan y dibalik", () => {
    const points = polyline([1, 2, 3], 100, 20, 2);
    const [first, , last] = points.split(" ").map((pair) => pair.split(",").map(Number));
    expect(first[0]).toBe(2); // titik pertama di kiri
    expect(last[0]).toBe(98); // titik terakhir di kanan
    expect(first[1]).toBeGreaterThan(last[1]); // nilai terkecil di bawah (y besar)
  });

  it("seri rata tidak membagi nol", () => {
    expect(polyline([100, 100, 100], 80, 24, 2)).toBe("2,22 40,22 78,22");
  });

  it("satu titik & seri kosong", () => {
    expect(polyline([5], 80, 24)).toBe("2,12");
    expect(polyline([], 80, 24)).toBe("");
  });
});

describe("combinedRange", () => {
  it("menggabungkan dua seri supaya satu skala", () => {
    expect(combinedRange([100, 105], [98, 102])).toEqual({ min: 98, max: 105 });
  });

  it("seri kosong → rentang netral", () => {
    expect(combinedRange([], [])).toEqual({ min: 100, max: 100 });
  });
});
