import { describe, expect, it } from "vitest";
import type { DataStatus } from "./api";
import { freshnessDetail, freshnessLabel, streakLabel } from "./labels";

const status = (extra: Partial<DataStatus>): DataStatus => ({
  as_of: "2026-10-12",
  timeframe: "d1",
  status: "ok",
  last_data_at: "2026-10-12T16:10:00+07:00",
  computed_at: "2026-10-12T16:31:02+07:00",
  partial_sectors: [],
  ...extra,
});

describe("streakLabel", () => {
  it("tidak tampil sebelum 2 minggu", () => {
    expect(streakLabel(0)).toBeNull();
    expect(streakLabel(1)).toBeNull();
  });

  it("tampil sebagai nw sejak 2 minggu", () => {
    expect(streakLabel(2)).toBe("2w");
    expect(streakLabel(5)).toBe("5w");
  });
});

describe("freshnessLabel", () => {
  it("ok menampilkan waktu data terakhir (WIB)", () => {
    expect(freshnessLabel(status({ status: "ok" }))).toBe("data 12 Okt 2026 16:10");
  });

  it("stale jadi 'delay' dan partial menyebut jumlah sektor tipis", () => {
    expect(freshnessLabel(status({ status: "stale" }))).toBe("delay");
    expect(freshnessLabel(status({ status: "partial", partial_sectors: ["IDXINDUST"] }))).toBe(
      "1 sektor tipis",
    );
    expect(freshnessLabel(status({ status: "partial", partial_sectors: ["A", "B"] }))).toBe(
      "2 sektor tipis",
    );
  });

  it("detail menyebut nama sektor atau 'tidak ada'", () => {
    expect(freshnessDetail(status({ partial_sectors: ["IDXINDUST", "IDXTRANS"] }))).toBe(
      "IDXINDUST, IDXTRANS",
    );
    expect(freshnessDetail(status({}))).toBe("tidak ada");
  });
});
