import { describe, expect, it } from "vitest";
import type { WeeklyPlan, WeeklySectorPick, WeeklyStockPick } from "./api";
import {
  REGIME_LABEL,
  WEEKLY_DEFAULT_MIN_STREAK,
  chance,
  confirmLabel,
  holdText,
  planRows,
  planStateLabel,
  planSummary,
  regimeTone,
  jakartaToday,
  readWeeklyParams,
  ruleRows,
  toolLabel,
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

// ── F18: trading plan (`docs/06` §5.2) ───────────────────────────────────────
describe("plan TA: label & baris (semua angka dari API)", () => {
  const plan: WeeklyPlan = {
    regime: "tren_naik",
    entry_tool: "pullback_ma20",
    confirm_tool: "volume",
    entry_mode: "pullback",
    entry_zone: { low: 4088, high: 4135, reason: "Zona di sekitar penyangga 20 hari." },
    stop: { level: 3991, pct: -0.0285, basis: "struktur_swing_low", reason: "Di bawah titik terendah 10 hari." },
    tp1: { level: 4360, pct: 0.0625, rr: 2.19, basis: "resistance_20", reason: "Puncak 20 hari." },
    tp2: { level: 4580, pct: 0.1161, rr: 4.07, basis: "donchian_40", reason: "Puncak 40 hari." },
    hold: { median_periods: 7, n_events: 29, win_rate: 0.34, hit_tp1: 0.62, hit_tp2: 0.34, reason: "29 breakout." },
    invalidation: "Batal bila tutup di bawah 4.110.",
    plan_ok: true,
    notes: [],
  };

  it("rezim → label + tona (netral/warn/down)", () => {
    expect(REGIME_LABEL.tren_naik).toBe("Tren naik");
    expect(REGIME_LABEL.tipis).toBe("Likuiditas tipis");
    expect(regimeTone("tren_naik")).toBe("neutral");
    expect(regimeTone("range")).toBe("warn");
    expect(regimeTone("tipis")).toBe("warn");
    expect(regimeTone("turun")).toBe("down");
  });

  it("nama alat tidak pernah mentah", () => {
    expect(toolLabel("breakout_donchian")).toBe("tembus puncak 20 hari");
    expect(confirmLabel("volume")).toBe("volume di atas rata-rata 20 hari");
    expect(toolLabel(null)).toBe("—");
  });

  it("baris ringkas: zona/SL/TP1/TP2/R:R (persen bertanda karena perubahan dari entry)", () => {
    expect(planSummary(plan)).toBe(
      "zona 4.088–4.135 · SL 3.991 (−2,85%) · TP1 4.360 (+6,25%) · TP2 4.580 (+11,61%) · R:R 4,07:1",
    );
    expect(planSummary(null)).toBeNull();
  });

  it("no_trade → satu kalimat tanpa angka level", () => {
    const noTrade: WeeklyPlan = {
      ...plan,
      regime: "turun",
      entry_mode: "no_trade",
      notes: ["Rezim turun — tidak ada rencana beli sampai harga kembali di atas penyangga 20 hari."],
      plan_ok: false,
    };
    const text = planSummary(noTrade) ?? "";
    expect(text).toContain("tidak ada rencana beli");
    expect(text).not.toMatch(/SL |TP1 |zona /);
    expect(planStateLabel(noTrade)).toBe("tidak ada rencana beli");
  });

  it("peluang tanpa tanda & 'belum cukup riwayat' saat hit null", () => {
    expect(chance(0.62)).toBe("62%");
    expect(chance(null)).toBe("—");
    expect(holdText(plan.hold)).toBe("median 7 bar · TP1 kena 62% · TP2 kena 34% · dari 29 breakout");
    expect(holdText({ ...plan.hold, hit_tp1: null, hit_tp2: null })).toBe("belum cukup riwayat");
  });

  it("planRows: urutan docs/06 §5.2 + alasan ikut", () => {
    const rows = planRows(plan);
    expect(rows.map((r) => r.key)).toEqual(["tool", "confirm", "zone", "stop", "tp1", "tp2", "hold", "invalidation"]);
    expect(rows[0].value).toBe("pantulan ke penyangga 20 hari");
    expect(rows[3].value).toBe("3.991 (−2,85%) · struktur swing low");
    expect(rows[4].value).toContain("R:R 2,19:1");
    expect(rows[7].value).toBe("Batal bila tutup di bawah 4.110.");
    // tidak ada nilai yang menampilkan nama alat mentah
    expect(rows.map((r) => r.value).join(" ")).not.toContain("pullback_ma20");
  });

  it("plan_ok=false → 'perlu ditinjau'", () => {
    expect(planStateLabel({ ...plan, plan_ok: false })).toBe("perlu ditinjau");
    expect(planStateLabel(plan)).toBeNull();
  });
});
