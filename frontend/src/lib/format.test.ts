import { describe, expect, it } from "vitest";
import {
  formatDelta,
  formatDuration,
  formatNum,
  formatPct,
  formatRp,
  formatRpCompact,
} from "./format";

describe("formatRpCompact", () => {
  it("memakai satuan T / M / jt (docs/03 §8)", () => {
    expect(formatRpCompact(1_180_000_000_000)).toBe("1,18 T");
    expect(formatRpCompact(980_000_000)).toBe("980,0 jt");
    expect(formatRpCompact(845_300_000_000)).toBe("845,3 M");
    expect(formatRpCompact(12_400_000)).toBe("12,4 jt");
    expect(formatRpCompact(845_000)).toBe("845.000");
    expect(formatRpCompact(0)).toBe("0");
  });

  it("nilai kosong jadi em dash, bukan 0", () => {
    expect(formatRpCompact(null)).toBe("—");
    expect(formatRpCompact(undefined)).toBe("—");
  });
});

describe("formatPct", () => {
  it("tanda selalu eksplisit dan memakai minus U+2212", () => {
    expect(formatPct(0.0181)).toBe("+1,81%");
    expect(formatPct(-0.0045)).toBe("−0,45%");
    expect(formatPct(-0.0045)).toContain("\u2212");
    expect(formatPct(0)).toBe("0,00%");
    expect(formatPct(null)).toBe("—");
  });
});

describe("formatDelta", () => {
  it("perubahan RS tanpa satuan", () => {
    expect(formatDelta(0.42)).toBe("+0,42");
    expect(formatDelta(-0.31)).toBe("−0,31");
    expect(formatDelta(1.5, 1)).toBe("+1,5");
    expect(formatDelta(null)).toBe("—");
  });
});

describe("formatRp & formatNum", () => {
  it("pemisah ribuan titik, tanpa desimal untuk harga", () => {
    expect(formatRp(4250)).toBe("4.250");
    expect(formatRp(68)).toBe("68");
    expect(formatNum(1234.5, 1)).toBe("1.234,5");
    expect(formatNum(null)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("koma desimal & menit", () => {
    expect(formatDuration(6)).toBe("6,0 s");
    expect(formatDuration(72.5)).toBe("1 mnt 13 s");
    expect(formatDuration(null)).toBe("—");
  });
});
