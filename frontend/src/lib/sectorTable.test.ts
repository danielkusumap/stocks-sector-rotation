import { describe, expect, it } from "vitest";
import { SECTOR_COLUMNS, nextSort, sectorSortOf } from "./sectorTable";

describe("kolom tabel sektor (docs/06 §5)", () => {
  it("dua belas kolom dengan urutan dokumen", () => {
    expect(SECTOR_COLUMNS.map((c) => c.label)).toEqual([
      "Sektor",
      "Kuadran",
      "Umur",
      "RS-Ratio",
      "RS-Mom",
      "Δ1p",
      "1M",
      "1B",
      "3B",
      "Turnover",
      "Streak",
      "Skor",
    ]);
  });

  it("hanya kolom angka yang punya kunci sort di /sectors/summary yang bisa diklik", () => {
    const sortable = SECTOR_COLUMNS.filter((c) => c.sort).map((c) => c.sort);
    expect(sortable).toEqual(["rs_ratio", "rs_momentum", "ret_1w", "ret_1m", "turnover", "score"]);
    // kolom teks & turunan tidak bisa diklik (API tidak punya kuncinya)
    for (const key of ["sector", "quadrant", "age", "delta", "ret_3m", "streak"]) {
      expect(nextSort({ sort: "score", dir: "desc" }, SECTOR_COLUMNS.find((c) => c.key === key)!)).toBeNull();
    }
  });

  it("semua kolom angka rata kanan, kolom teks rata kiri", () => {
    for (const column of SECTOR_COLUMNS) {
      const numeric = !["sector", "quadrant"].includes(column.key);
      expect(column.align).toBe(numeric ? "right" : "left");
    }
  });
});

describe("klik header (docs/08 F5)", () => {
  const rsRatio = SECTOR_COLUMNS.find((c) => c.key === "rs_ratio")!;
  const score = SECTOR_COLUMNS.find((c) => c.key === "score")!;

  it("kolom baru mulai dari desc (nilai besar dulu)", () => {
    expect(nextSort({ sort: "score", dir: "desc" }, rsRatio)).toEqual({
      sort: "rs_ratio",
      dir: "desc",
    });
  });

  it("klik kedua membalik arah", () => {
    expect(nextSort({ sort: "rs_ratio", dir: "desc" }, rsRatio)).toEqual({
      sort: "rs_ratio",
      dir: "asc",
    });
    expect(nextSort({ sort: "rs_ratio", dir: "asc" }, rsRatio)).toEqual({
      sort: "rs_ratio",
      dir: "desc",
    });
  });

  it("klik ulang kolom yang sama tidak pernah keluar dari kunci yang dikenal API", () => {
    const next = nextSort({ sort: "score", dir: "asc" }, score);
    expect(sectorSortOf(next!.sort)).toBe("score");
  });
});

describe("sectorSortOf", () => {
  it("menerima kunci sektor, menolak kunci saham", () => {
    expect(sectorSortOf("rs_momentum")).toBe("rs_momentum");
    expect(sectorSortOf("stock_score")).toBe("score");
    expect(sectorSortOf("")).toBe("score");
  });
});
