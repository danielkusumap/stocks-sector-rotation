import { describe, expect, it } from "vitest";
import type { Candle } from "./api";
import {
  bandWidth,
  chartAriaLabel,
  eventToken,
  hoverSummary,
  indexAtX,
  layoutCandles,
  levelLabel,
  needsBorder,
  overlayVisibility,
  priceDomain,
  scaleY,
  volumeHeight,
  xOfIndex,
} from "./candleChart";

const candle = (over: Partial<Candle> = {}): Candle => ({
  date: "2026-10-12",
  open: 4188,
  high: 4260,
  low: 4170,
  close: 4210,
  volume: 91_200_000,
  ...over,
});

const PLOT = { width: 400, height: 200 };

describe("candleChart — skala & layout (tanpa hitungan finansial)", () => {
  it("domain harga menggabungkan candle + overlay/level, dengan padding simetris", () => {
    const domain = priceDomain([candle(), candle({ high: 4300, low: 4100 })], [3991, 4580]);
    expect(domain.min).toBeLessThan(3991);
    expect(domain.max).toBeGreaterThan(4580);
    // padding simetris: jarak min→3991 dan 4580→max sama
    const lowGap = 3991 - domain.min;
    const highGap = domain.max - 4580;
    expect(Math.abs(lowGap - highGap)).toBeLessThan(0.01);
  });

  it("tanpa candle → domain aman (tidak NaN)", () => {
    expect(priceDomain([], [])).toEqual({ min: 0, max: 1 });
  });

  it("scaleY: max di atas (0), min di bawah (height)", () => {
    const domain = { min: 4000, max: 5000 };
    expect(scaleY(5000, domain, PLOT)).toBe(0);
    expect(scaleY(4000, domain, PLOT)).toBe(200);
    expect(scaleY(4500, domain, PLOT)).toBe(100);
  });

  it("layout: body minimal 1 px (doji), x berjarak sama, naik/turun dari open vs close", () => {
    const doji = candle({ open: 4200, close: 4200 });
    const turun = candle({ open: 4300, close: 4200 });
    const bars = layoutCandles([doji, turun], { min: 4000, max: 4400 }, PLOT);
    expect(bars[0].bodyHeight).toBe(1);
    expect(bars[0].up).toBe(true); // close == open dihitung naik
    expect(bars[1].up).toBe(false);
    expect(bars[1].x - bars[0].x).toBeCloseTo(200, 5);
    expect(bars[1].wickTop).toBeLessThan(bars[1].bodyY);
    expect(needsBorder(1)).toBe(true);
    expect(needsBorder(4)).toBe(false);
    expect(bandWidth(PLOT, 2)).toBe(200);
  });

  it("volume 0 → tidak menggambar bar; volume besar → tinggi penuh", () => {
    expect(volumeHeight(0, 100, 40)).toBe(0);
    expect(volumeHeight(100, 100, 40)).toBe(40);
    expect(volumeHeight(50, 0, 40)).toBe(0);
  });

  it("indexAtX/xOfIndex bolak-balik, di luar area → null", () => {
    expect(indexAtX(xOfIndex(3, 10, PLOT), 10, PLOT)).toBe(3);
    expect(indexAtX(-5, 10, PLOT)).toBeNull();
    expect(indexAtX(9999, 10, PLOT)).toBeNull();
    expect(indexAtX(10, 0, PLOT)).toBeNull();
  });
});

describe("candleChart — aturan tampil overlay & label", () => {
  it("kanal S/R hanya di rezim range/tipis (docs/03 §6.4.9)", () => {
    expect(overlayVisibility("tren_naik")).toEqual({ ma: true, donchian: true, channel: false });
    expect(overlayVisibility("range").channel).toBe(true);
    expect(overlayVisibility("tipis").channel).toBe(true);
    expect(overlayVisibility(null).channel).toBe(false);
  });

  it("warna penanda event memakai token, bukan hex", () => {
    expect(eventToken("win")).toBe("--up");
    expect(eventToken("loss")).toBe("--down");
    expect(eventToken("expired")).toBe("--fg-faint");
    expect(eventToken("open")).toBe("--fg-faint");
    expect(eventToken(null)).toBe("--fg-faint");
  });

  it("kotak hover: O/H/L/C + volume, tanpa persen (kontrak tidak mengirimnya)", () => {
    const text = hoverSummary(candle());
    expect(text).toBe("O 4.188 · H 4.260 · L 4.170 · C 4.210 · Vol 91.200.000");
    expect(text).not.toContain("%");
  });

  it("label level plan & aria-label grafik menyebut harga penyesuaian", () => {
    expect(levelLabel("SL", 3991, "−2,85%")).toBe("SL 3.991 (−2,85%)");
    expect(levelLabel("TP2", 4580)).toBe("TP2 4.580");
    const aria = chartAriaLabel({ ticker: "BBRI", regime: "tren_naik", bars: 120, hasLevels: true });
    expect(aria).toContain("BBRI");
    expect(aria).toContain("rezim tren naik");
    expect(aria).toContain("harga penyesuaian");
  });
});
