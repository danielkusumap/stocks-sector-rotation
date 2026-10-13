import { describe, expect, it } from "vitest";
import {
  STOCK_COLUMNS,
  clampOffset,
  nextSort,
  offsetOf,
  pageCount,
  pageOf,
  rangeLabel,
  stockSortOf,
} from "./stockTable";

describe("kolom tabel saham (docs/06 §5)", () => {
  it("memuat Ticker, Nama, Harga, RSI, ATR, Skor seperti diminta", () => {
    const labels = STOCK_COLUMNS.map((c) => c.label);
    expect(labels).toEqual([
      "Ticker",
      "Nama",
      "Kuadran",
      "RS-Ratio",
      "RS-Mom",
      "1H",
      "1M",
      "Harga",
      "RSI",
      "ATR",
      "Turnover 20h",
      "Skor",
    ]);
  });

  it("hanya kolom dengan kunci di STOCK_SORTS yang bisa diklik", () => {
    const sortable = STOCK_COLUMNS.filter((c) => c.sort).map((c) => c.sort);
    expect(sortable).toEqual(["ticker", "rs_ratio", "ret_1d", "ret_1w", "turnover", "stock_score"]);
    // RS-Momentum, RSI, ATR, Harga tidak punya kunci urut di /stocks
    for (const key of ["name", "quadrant", "rs_momentum", "close", "rsi14", "atr14"]) {
      const column = STOCK_COLUMNS.find((c) => c.key === key)!;
      expect(nextSort({ sort: "stock_score", dir: "desc" }, column)).toBeNull();
    }
  });

  it("kolom angka rata kanan, teks rata kiri", () => {
    for (const column of STOCK_COLUMNS) {
      const text = ["ticker", "name", "quadrant"].includes(column.key);
      expect(column.align).toBe(text ? "left" : "right");
    }
  });
});

describe("klik header", () => {
  const ticker = STOCK_COLUMNS.find((c) => c.key === "ticker")!;
  const score = STOCK_COLUMNS.find((c) => c.key === "stock_score")!;

  it("kolom baru mulai desc, klik kedua membalik", () => {
    expect(nextSort({ sort: "stock_score", dir: "desc" }, ticker)).toEqual({ sort: "ticker", dir: "desc" });
    expect(nextSort({ sort: "ticker", dir: "desc" }, ticker)).toEqual({ sort: "ticker", dir: "asc" });
  });

  it("hasilnya selalu kunci yang dikenal API", () => {
    expect(stockSortOf(nextSort({ sort: "stock_score", dir: "asc" }, score)!.sort)).toBe("stock_score");
    expect(stockSortOf("rs_momentum")).toBe("stock_score"); // bukan kunci /stocks → jatuh ke default
    expect(stockSortOf("ticker")).toBe("ticker");
  });
});

describe("paginasi limit/offset (docs/08 F8)", () => {
  it("jumlah halaman", () => {
    expect(pageCount(30, 10)).toBe(3);
    expect(pageCount(30, 50)).toBe(1);
    expect(pageCount(0, 10)).toBe(1);
    expect(pageCount(31, 10)).toBe(4);
    expect(pageCount(30, 0)).toBe(1); // limit tidak masuk akal → satu halaman
  });

  it("offset ↔ halaman bolak-balik", () => {
    expect(pageOf(0, 10)).toBe(1);
    expect(pageOf(20, 10)).toBe(3);
    expect(offsetOf(1, 10)).toBe(0);
    expect(offsetOf(3, 10)).toBe(20);
    for (const page of [1, 2, 3]) {
      expect(pageOf(offsetOf(page, 10), 10)).toBe(page);
    }
  });

  it("label rentang", () => {
    expect(rangeLabel(0, 10, 30)).toBe("1–10 dari 30");
    expect(rangeLabel(20, 10, 30)).toBe("21–30 dari 30");
    expect(rangeLabel(0, 0, 0)).toBe("0 dari 0");
    // offset di luar rentang: tidak boleh jadi "1000–999 dari 30"
    expect(rangeLabel(999, 0, 30)).toBe("0 dari 30");
  });

  it("offset dijepit di halaman terakhir", () => {
    expect(clampOffset(999, 30, 10)).toBe(20);
    expect(clampOffset(-5, 30, 10)).toBe(0);
    expect(clampOffset(10, 0, 10)).toBe(0);
  });
});
