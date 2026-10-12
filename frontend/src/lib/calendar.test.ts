import { describe, expect, it } from "vitest";
import {
  DAY_NAMES,
  asOfLabel,
  isoDate,
  monthGrid,
  monthKey,
  monthLabel,
  parseIso,
  shiftMonth,
  shortMonthLabel,
} from "./calendar";

describe("parseIso", () => {
  it("menerima tanggal ISO dan menolak yang lain", () => {
    expect(parseIso("2026-10-12")).toEqual({ year: 2026, month: 9, day: 12 });
    expect(parseIso("2026-10-12T00:00:00Z")).toBeNull();
    expect(parseIso("12/10/2026")).toBeNull();
    expect(parseIso("")).toBeNull();
  });

  it("menolak tanggal yang tidak ada di kalender", () => {
    expect(parseIso("2026-02-31")).toBeNull();
    expect(parseIso("2026-13-01")).toBeNull();
  });
});

describe("grid bulan", () => {
  it("Senin di kolom pertama: 1 Okt 2026 jatuh di sel ke-4", () => {
    const grid = monthGrid("2026-10");
    expect(grid).toHaveLength(42);
    expect(grid.slice(0, 3)).toEqual([null, null, null]);
    expect(grid[3]).toBe("2026-10-01");
    expect(grid.filter(Boolean)).toHaveLength(31);
    expect(grid[3 + 30]).toBe("2026-10-31");
    expect(grid[3 + 31]).toBeNull();
  });

  it("bulan yang mulai hari Senin tidak punya sel kosong di depan", () => {
    const grid = monthGrid("2026-06"); // 1 Jun 2026 = Senin
    expect(grid[0]).toBe("2026-06-01");
    expect(grid.filter(Boolean)).toHaveLength(30);
  });

  it("nama hari Indonesia, Senin dulu", () => {
    expect(DAY_NAMES[0]).toBe("Sen");
    expect(DAY_NAMES[6]).toBe("Min");
  });
});

describe("navigasi bulan", () => {
  it("maju/mundur lintas tahun", () => {
    expect(shiftMonth("2026-10", 1)).toBe("2026-11");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("label bulan bahasa Indonesia", () => {
    expect(monthLabel("2026-10")).toBe("Oktober 2026");
    expect(shortMonthLabel("2026-10")).toBe("Okt 2026");
    expect(monthKey("2026-10-12")).toBe("2026-10");
  });

  it("isoDate menormalkan tanggal", () => {
    expect(isoDate(2026, 9, 12)).toBe("2026-10-12");
  });
});

describe("label tombol AsOfPicker", () => {
  it("menampilkan pilihan user, atau tanggal terbaru, atau 'terakhir'", () => {
    expect(asOfLabel("2026-10-09", "2026-10-12")).toBe("9 Okt 2026");
    expect(asOfLabel(null, "2026-10-12")).toBe("terakhir 12 Okt 2026");
    expect(asOfLabel(null, null)).toBe("terakhir");
  });
});
