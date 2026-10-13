import { describe, expect, it } from "vitest";
import type { WeeklySectorPick, WeeklyStockPick } from "./api";
import {
  WEEKLY_DEFAULT_MIN_STREAK,
  jakartaToday,
  readWeeklyParams,
  ruleRows,
  weekEndOf,
  weekOptions,
  weekRangeLabel,
  weekStart,
  writeWeeklyParams,
} from "./weeklyPicks";

const sp = (query: string) => new URLSearchParams(query);

describe("parameter URL halaman Weekly", () => {
  it("default: minggu final terakhir dari backend, streak 1, dua blok", () => {
    expect(readWeeklyParams(sp(""))).toEqual({
      week_end: null,
      min_streak: 1,
      scope: "sector,stock",
    });
    expect(WEEKLY_DEFAULT_MIN_STREAK).toBe(1);
  });

  it("membaca week_end, min_streak, scope dari URL", () => {
    expect(readWeeklyParams(sp("?week_end=2026-10-09&min_streak=3&scope=stock"))).toEqual({
      week_end: "2026-10-09",
      min_streak: 3,
      scope: "stock",
    });
  });

  it("menolak nilai rusak tanpa melempar error", () => {
    expect(readWeeklyParams(sp("?week_end=09/10/2026")).week_end).toBeNull();
    expect(readWeeklyParams(sp("?min_streak=abc")).min_streak).toBe(1);
    expect(readWeeklyParams(sp("?min_streak=-4")).min_streak).toBe(0);
    expect(readWeeklyParams(sp("?min_streak=99")).min_streak).toBe(8);
    expect(readWeeklyParams(sp("?min_streak=2.7")).min_streak).toBe(2);
    expect(readWeeklyParams(sp("?scope=sektor")).scope).toBe("sector,stock");
  });

  it("menulis balik ke URL: default dibuang, kunci lain dipertahankan", () => {
    expect(writeWeeklyParams(sp("?mock=ok"), { min_streak: 2 }).toString()).toBe(
      "mock=ok&min_streak=2",
    );
    expect(writeWeeklyParams(sp("?mock=ok"), { min_streak: 1 }).toString()).toBe("mock=ok");
    expect(writeWeeklyParams(sp("?min_streak=4"), { min_streak: 1 }).toString()).toBe("");
    expect(writeWeeklyParams(sp(""), { week_end: "2026-10-09" }).toString()).toBe(
      "week_end=2026-10-09",
    );
    expect(writeWeeklyParams(sp("?week_end=2026-10-09"), { week_end: null }).toString()).toBe("");
    expect(writeWeeklyParams(sp("?scope=stock"), { scope: "sector,stock" }).toString()).toBe("");
    expect(writeWeeklyParams(sp("?week_end=2026-10-09"), { scope: "sector" }).toString()).toBe(
      "week_end=2026-10-09&scope=sector",
    );
  });
});

describe("ruleRows — semua rule_hits, yang gagal tidak disembunyikan", () => {
  const sector = (hits: Partial<WeeklySectorPick["rule_hits"]>): WeeklySectorPick["rule_hits"] => ({
    quadrant: "leading",
    age_ok: true,
    momentum_ok: true,
    ret_4w_ok: true,
    constituents_ok: true,
    ...hits,
  });

  const stock = (hits: Partial<WeeklyStockPick["rule_hits"]>): WeeklyStockPick["rule_hits"] => ({
    liquidity_ok: true,
    price_ok: true,
    trend_ok: true,
    rs_ok: true,
    momentum_ok: true,
    rsi_ok: true,
    no_suspension: true,
    ...hits,
  });

  it("sektor: 4 aturan + baris info kuadran berlabel Indonesia", () => {
    const rows = ruleRows(sector({}));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({ key: "quadrant", label: "kuadran Memimpin", ok: null, known: true });
    expect(rows.slice(1).map((r) => r.key)).toEqual([
      "age_ok",
      "momentum_ok",
      "ret_4w_ok",
      "constituents_ok",
    ]);
    expect(rows.slice(1).every((r) => r.ok === true)).toBe(true);
  });

  it("sektor: aturan yang gagal tetap tampil dengan ok=false", () => {
    const rows = ruleRows(sector({ momentum_ok: false, constituents_ok: false, quadrant: "improving" }));
    expect(rows).toHaveLength(5);
    expect(rows[0].label).toBe("kuadran Membaik");
    expect(rows.filter((r) => r.ok === false).map((r) => r.key)).toEqual([
      "momentum_ok",
      "constituents_ok",
    ]);
  });

  it("saham: 7 aturan, semua false tetap tampil", () => {
    const rows = ruleRows(
      stock({
        liquidity_ok: false,
        price_ok: false,
        trend_ok: false,
        rs_ok: false,
        momentum_ok: false,
        rsi_ok: false,
        no_suspension: false,
      }),
    );
    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.key)).toEqual([
      "liquidity_ok",
      "price_ok",
      "trend_ok",
      "rs_ok",
      "momentum_ok",
      "rsi_ok",
      "no_suspension",
    ]);
    expect(rows.every((r) => r.ok === false)).toBe(true);
    expect(rows.every((r) => r.label.length > 0)).toBe(true);
  });

  it("key baru dari backend tampil apa adanya (bukan hilang/blank), ditandai known=false", () => {
    const sectorRows = ruleRows({
      ...sector({}),
      board_ok: true,
      value_ok: false,
    } as WeeklySectorPick["rule_hits"]);
    expect(sectorRows).toHaveLength(7);
    const extra = sectorRows.slice(5);
    expect(extra).toEqual([
      { key: "board_ok", label: "board_ok", ok: true, known: false },
      { key: "value_ok", label: "value_ok", ok: false, known: false },
    ]);

    const stockRows = ruleRows({
      ...stock({}),
      board_ok: false,
    } as WeeklyStockPick["rule_hits"]);
    expect(stockRows).toHaveLength(8);
    expect(stockRows[7]).toEqual({
      key: "board_ok",
      label: "board_ok",
      ok: false,
      known: false,
    });
  });

  it("field non-boolean pada rule_hits tidak jadi baris aturan", () => {
    const rows = ruleRows({
      ...stock({}),
      note: "dari backend",
    } as unknown as WeeklyStockPick["rule_hits"]);
    expect(rows.map((r) => r.key)).toEqual([
      "liquidity_ok",
      "price_ok",
      "trend_ok",
      "rs_ok",
      "momentum_ok",
      "rsi_ok",
      "no_suspension",
    ]);
  });
});

describe("pekan (kalender)", () => {
  it("Senin pekan itu dan label rentang", () => {
    expect(weekStart("2026-10-09")).toBe("2026-10-05");
    expect(weekRangeLabel("2026-10-09")).toBe("5–9 Okt 2026");
    expect(weekRangeLabel("2026-05-01")).toBe("27 Apr 2026–1 Mei 2026");
    expect(weekRangeLabel("bukan-tanggal")).toBe("bukan-tanggal");
  });

  it("Jumat pekan berjalan, apa pun hari ini", () => {
    expect(weekEndOf("2026-10-13")).toBe("2026-10-16"); // Selasa
    expect(weekEndOf("2026-10-09")).toBe("2026-10-09"); // Jumat
    expect(weekEndOf("2026-10-17")).toBe("2026-10-16"); // Sabtu
    expect(weekEndOf("2026-10-12")).toBe("2026-10-16"); // Senin
    expect(weekEndOf("x")).toBeNull();
  });

  it("hari ini mengikuti zona Asia/Jakarta (UTC+7)", () => {
    expect(jakartaToday(new Date("2026-10-12T18:00:00Z"))).toBe("2026-10-13");
    expect(jakartaToday(new Date("2026-10-12T16:00:00Z"))).toBe("2026-10-12");
  });
});

describe("weekOptions", () => {
  it("pekan berjalan di atas, lalu Jumat hasil hitung; hari non-Jumat dibuang", () => {
    const options = weekOptions({
      dates: ["2026-10-13", "2026-10-09", "2026-10-02"],
      running: "2026-10-16",
      selected: null,
    });
    expect(options.map((o) => o.value)).toEqual(["2026-10-16", "2026-10-09", "2026-10-02"]);
    expect(options[0].label).toBe("pekan 12–16 Okt 2026 — belum final");
    expect(options[0].final).toBe(false);
    expect(options[1]).toEqual({ value: "2026-10-09", label: "pekan 5–9 Okt 2026", final: true });
  });

  it("pekan berjalan yang sudah final tidak dobel dan tidak dilabeli 'belum final'", () => {
    const options = weekOptions({
      dates: ["2026-10-16", "2026-10-09"],
      running: "2026-10-16",
      selected: "2026-10-16",
    });
    expect(options.map((o) => o.value)).toEqual(["2026-10-16", "2026-10-09"]);
    expect(options[0].final).toBe(true);
    expect(options[0].label).toBe("pekan 12–16 Okt 2026");
  });

  it("pekan di URL yang belum ada di meta/dates tetap muncul", () => {
    const options = weekOptions({ dates: ["2026-10-09"], running: null, selected: "2026-09-25" });
    expect(options.map((o) => o.value)).toEqual(["2026-09-25", "2026-10-09"]);
  });
});
