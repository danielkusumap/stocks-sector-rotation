import { describe, expect, it } from "vitest";
import type { Candle } from "./api";
import {
  bandWidth,
  chartAriaLabel,
  clampRange,
  deepZoom,
  elliottShapes,
  eventToken,
  hoverSummary,
  indexAtX,
  layerNotice,
  layoutCandles,
  levelLabel,
  needsBorder,
  layerList,
  layersParam,
  panBy,
  pocLabel,
  setLayers,
  shiftDomain,
  smcShapes,
  toggleLayer,
  ursiGuides,
  ursiRangeNote,
  ursiTitle,
  ursiY,
  visibleLabel,
  visibleRange,
  vwapAnchorLabel,
  vwapWarning,
  overlayVisibility,
  priceDomain,
  scaleY,
  volumeHeight,
  xOfIndex,
  zoomAt,
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

describe("lapisan indikator F21 (docs/06 §6.6)", () => {
  it("skala URSI tetap 0–100 dan nilai di luar dijepit", () => {
    expect(ursiY(100, 60)).toBe(0);
    expect(ursiY(0, 60)).toBe(60);
    expect(ursiY(50, 60)).toBe(30);
    expect(ursiY(140, 60)).toBe(0);
    expect(ursiY(-8, 60)).toBe(60);
  });

  it("garis bantu memakai ambang dari API", () => {
    const guides = ursiGuides(75, 25, 100);
    expect(guides.y50).toBe(50);
    expect(guides.yOb).toBe(25);
    expect(guides.yOs).toBe(75);
  });

  it("judul URSI dari parameter API, aman saat null", () => {
    expect(ursiTitle(14, "sma")).toBe("Ultimate RSI (14, SMA)");
    expect(ursiTitle(7, null)).toBe("Ultimate RSI (7)");
    expect(ursiTitle(null, null)).toBe("Ultimate RSI");
  });

  it("catatan kontrarian hanya di rezim range", () => {
    expect(ursiRangeNote("range")).toBe("di rentang, pakai RSI klasik (kontrarian)");
    expect(ursiRangeNote("tren_naik")).toBeNull();
    expect(ursiRangeNote(null)).toBeNull();
  });

  it("label anchor VWAP memakai tanggal dari API", () => {
    expect(vwapAnchorLabel(20, "2026-09-14")).toBe("VWAP 20 · anchor 14 Sep");
    expect(vwapAnchorLabel(null, null)).toBe("VWAP —");
  });

  it("peringatan VWAP hanya saat rezim bukan range/tipis", () => {
    expect(vwapWarning("tren_naik")).toBe("bukan alat utama saat tren");
    expect(vwapWarning("range")).toBeNull();
    expect(vwapWarning("tipis")).toBeNull();
  });

  it("label POC wajib jujur soal basis bar", () => {
    expect(pocLabel("daily", 60)).toBe("perkiraan dari bar harian (60 bar)");
    expect(pocLabel("intraday", 240)).toBe("dari bar 5 menit (240 bar)");
    expect(pocLabel("daily", null)).toBe("perkiraan dari bar harian");
  });

  it("layers di URL: default `indicators`, `layers=` = tanpa lapisan", () => {
    expect(layerList(new URLSearchParams())).toEqual(["indicators"]);
    expect(layerList(new URLSearchParams("layers="))).toEqual([]);
    expect(layerList(new URLSearchParams("layers=smc,elliott"))).toEqual(["smc", "elliott"]);
    expect(layerList(new URLSearchParams("layers=smc,bogus"))).toEqual(["smc"]);
    expect(setLayers(new URLSearchParams("window=1y"), ["indicators"]).toString()).toBe("window=1y");
    expect(setLayers(new URLSearchParams(), []).toString()).toBe("layers=");
    expect(setLayers(new URLSearchParams("layers=smc"), ["smc"]).get("layers")).toBe("smc");
  });

  it("layersParam membedakan `tanpa parameter` (default backend) dari daftar kosong", () => {
    expect(layersParam(new URLSearchParams())).toBeUndefined();
    expect(layersParam(new URLSearchParams("layers="))).toEqual([]);
    expect(layersParam(new URLSearchParams("layers=smc"))).toEqual(["smc"]);
  });

  it("toggle menyalakan/mematikan satu lapisan", () => {
    expect(toggleLayer([], "smc")).toEqual(["smc"]);
    expect(toggleLayer(["indicators", "smc"], "smc")).toEqual(["indicators"]);
    expect(toggleLayer(["smc"], "smc")).toEqual([]);
  });
});

describe("lapisan konteks F22 (docs/06 §6.7)", () => {
  const scale = { x: (date: string) => (date === "2026-10-01" ? 100 : date === "2026-10-05" ? 200 : null), y: (price: number) => 500 - price, left: 0, right: 700 };

  it("notice hanya untuk lapisan konteks, bukan `indicators`", () => {
    expect(layerNotice("smc")).toBe("lapisan konteks, bukan sinyal");
    expect(layerNotice("elliott")).toBe("lapisan konteks, bukan sinyal");
    expect(layerNotice("indicators")).toBeNull();
  });

  it("smc kosong/undefined → tanpa bentuk (tidak ada elemen)", () => {
    expect(smcShapes(undefined, scale)).toEqual([]);
    expect(smcShapes({ bos: [], choch: [], order_blocks: [], fvg: [], equal_levels: [], range: null }, scale)).toEqual([]);
  });

  it("BOS & CHoCH jadi garis putus berlabel dari level API", () => {
    const shapes = smcShapes(
      {
        bos: [{ date: "2026-10-01", direction: "up", level: 100 }],
        choch: [{ date: "2026-10-05", direction: "down", level: 50 }],
        order_blocks: [],
        fvg: [],
        equal_levels: [],
        range: null,
      },
      scale,
    );
    expect(shapes).toHaveLength(2);
    expect(shapes.map((shape) => shape.label)).toEqual(["BOS", "CHoCH"]);
    expect(shapes[0].style.dashed).toBe(true);
    expect(shapes[0].x1).toBe(100);
    expect(shapes[0].y1).toBe(400); // 500 − 100 → dari scale.y
    expect(shapes[1].y1).toBe(450);
  });

  it("tanggal di luar rentang → bentuk dilewati, bukan digambar di tepi", () => {
    const shapes = smcShapes({ bos: [{ date: "2026-01-01", direction: "up", level: 100 }], choch: [], order_blocks: [], fvg: [], equal_levels: [], range: null }, scale);
    expect(shapes).toEqual([]);
  });

  it("order block termitigasi lebih redup + putus, yang aktif tidak", () => {
    const shapes = smcShapes(
      {
        bos: [],
        choch: [],
        order_blocks: [
          { kind: "bullish", from: "2026-10-01", to: "2026-10-05", low: 100, high: 200, mitigated: false },
          { kind: "bearish", from: "2026-10-01", to: "2026-10-05", low: 300, high: 400, mitigated: true },
        ],
        fvg: [],
        equal_levels: [],
        range: null,
      },
      scale,
    );
    expect(shapes).toHaveLength(2);
    expect(shapes[0].tone).toBe("up");
    expect(shapes[0].style).toEqual({ opacity: 0.08, dashed: false });
    expect(shapes[1].tone).toBe("down");
    expect(shapes[1].style).toEqual({ opacity: 0.04, dashed: true });
    // tepi kotak selalu y1 < y2 (harga tinggi di atas)
    expect(shapes[0].y1).toBeLessThan(shapes[0].y2);
  });

  it("FVG dipotong ke tepi kanan plot & equal level berlabel N× dengan garis titik", () => {
    const shapes = smcShapes(
      {
        bos: [],
        choch: [],
        order_blocks: [],
        fvg: [{ kind: "bullish", date: "2026-10-01", low: 100, high: 200, mitigated: false }],
        equal_levels: [{ kind: "high", level: 150, count: 3 }],
        range: null,
      },
      scale,
    );
    expect(shapes[0].x2).toBe(700);
    expect(shapes[1].label).toBe("3×");
    expect(shapes[1].style.dash).toBe("1 3");
    expect(shapes[1].x1).toBe(0);
  });

  it("range: pita premium/discount + garis tengah 50% di antara low & high", () => {
    const shapes = smcShapes(
      { bos: [], choch: [], order_blocks: [], fvg: [], equal_levels: [], range: { low: 100, high: 200, premium_from: 170, discount_to: 130 } },
      scale,
    );
    expect(shapes.map((shape) => shape.label)).toEqual(["premium", "discount", "50%"]);
    expect(shapes[0].style.opacity).toBe(0.04);
    expect(shapes[2].y1).toBe(350); // 500 − 150
  });

  it("elliott kandidat: ZigZag & label wave digambar tanpa putus", () => {
    const shapes = elliottShapes(
      {
        status: "candidate",
        invalidated: false,
        zigzag: [
          { date: "2026-10-01", price: 100, kind: "low" },
          { date: "2026-10-05", price: 200, kind: "high" },
        ],
        waves: [{ label: "3", from: "2026-10-01", to: "2026-10-05", price_from: 100, price_to: 200 }],
        fib_zones: [{ ratio: 0.618, level: 150 }],
        note: "kandidat, bisa berubah",
      },
      scale,
    );
    expect(shapes.map((shape) => shape.kind)).toEqual(["zigzag", "label", "fib"]);
    expect(shapes[0].points).toEqual([
      { x: 100, y: 400 },
      { x: 200, y: 300 },
    ]);
    expect(shapes[0].style).toEqual({ opacity: 1, dashed: false });
    expect(shapes[1].label).toBe("3");
    expect(shapes[2].label).toBe("61,8%");
  });

  it("elliott batal → semua elemen putus + opacity 0,5 (pola tetap tampil)", () => {
    const shapes = elliottShapes(
      {
        status: "invalidated",
        invalidated: true,
        zigzag: [
          { date: "2026-10-01", price: 100, kind: "low" },
          { date: "2026-10-05", price: 200, kind: "high" },
        ],
        waves: [{ label: "5", from: "2026-10-01", to: "2026-10-05", price_from: 100, price_to: 200 }],
        fib_zones: [],
        note: "kandidat, bisa berubah",
      },
      scale,
    );
    expect(shapes.every((shape) => shape.style.dashed && shape.style.opacity === 0.5)).toBe(true);
    expect(shapes).toHaveLength(2);
  });

  it("elliott tanpa pivot di rentang → tanpa polyline, tidak error", () => {
    const shapes = elliottShapes(
      {
        status: "candidate",
        invalidated: false,
        zigzag: [{ date: "2025-01-01", price: 100, kind: "low" }],
        waves: [],
        fib_zones: [],
        note: "kandidat, bisa berubah",
      },
      scale,
    );
    expect(shapes).toEqual([]);
  });
});

describe("zoom & pan F23 (docs/06 §6.8)", () => {
  it("keadaan awal = seluruh data; data < 20 bar tidak bisa di-zoom", () => {
    expect(visibleRange(null, 120)).toEqual({ start: 0, end: 120 });
    expect(visibleRange({ start: 10, end: 40 }, 15)).toEqual({ start: 0, end: 15 });
    expect(zoomAt(null, 15, 0.5, 7)).toEqual({ start: 0, end: 15 });
  });

  it("clampRange menjaga minimal 20 bar & tidak melewati tepi data", () => {
    expect(clampRange({ start: 0, end: 5 }, 120)).toEqual({ start: 0, end: 20 });
    expect(clampRange({ start: 115, end: 130 }, 120)).toEqual({ start: 100, end: 120 });
    expect(clampRange({ start: -8, end: 40 }, 120)).toEqual({ start: 0, end: 48 });
    expect(clampRange({ start: 0, end: 400 }, 120)).toEqual({ start: 0, end: 120 });
  });

  it("zoom memperbesar menahan bar di bawah kursor (jangkar), bukan selalu ke tengah", () => {
    // jendela 100 bar, kursor di bar ke-20 (dekat kiri) → memperbesar 2× menahan rasio 0,2
    const zoomed = zoomAt({ start: 0, end: 100 }, 120, 0.5, 20);
    expect(zoomed.end - zoomed.start).toBe(50);
    const ratio = (20 - zoomed.start) / 50;
    expect(Math.abs(ratio - 0.2)).toBeLessThanOrEqual(0.03);
  });

  it("zoom ekstrem berhenti di 20 bar dan diam (tidak goyang)", () => {
    let state = { start: 0, end: 120 };
    for (let i = 0; i < 12; i += 1) state = zoomAt(state, 120, 0.5, 60);
    expect(state).toEqual({ start: 50, end: 70 });
    expect(zoomAt(state, 120, 0.5, 60)).toEqual({ start: 50, end: 70 });
  });

  it("zoom mengecil kembali sampai seluruh data, tidak lebih", () => {
    let state: { start: number; end: number } = { start: 40, end: 60 };
    for (let i = 0; i < 8; i += 1) state = zoomAt(state, 120, 2, 50);
    expect(state).toEqual({ start: 0, end: 120 });
  });

  it("pan memindahkan rentang & dijepit di kedua tepi", () => {
    expect(panBy({ start: 40, end: 60 }, 120, 10)).toEqual({ start: 50, end: 70 });
    expect(panBy({ start: 40, end: 60 }, 120, -100)).toEqual({ start: 0, end: 20 });
    expect(panBy({ start: 100, end: 120 }, 120, 500)).toEqual({ start: 100, end: 120 });
    expect(panBy(null, 120, 30)).toEqual({ start: 30, end: 120 });
  });

  it("pan vertikal hanya saat zoom dalam (≤ 2/3 data)", () => {
    expect(deepZoom(null, 120)).toBe(false);
    expect(deepZoom({ start: 0, end: 90 }, 120)).toBe(false);
    expect(deepZoom({ start: 0, end: 80 }, 120)).toBe(true);
    expect(deepZoom({ start: 0, end: 15 }, 15)).toBe(false);
  });

  it("shiftDomain menggeser sumbu & dijepit ±1 tinggi domain", () => {
    const domain = { min: 100, max: 200 };
    expect(shiftDomain(domain, 0)).toEqual(domain);
    expect(shiftDomain(domain, 0.5)).toEqual({ min: 150, max: 250 });
    expect(shiftDomain(domain, -3)).toEqual({ min: 0, max: 100 });
  });

  it("label rentang terlihat dalam Bahasa Indonesia", () => {
    expect(visibleLabel(["2026-08-12", "2026-09-01", "2026-10-09"])).toBe("12 Agu – 9 Okt, 3 bar");
    expect(visibleLabel([])).toBe("tidak ada bar terlihat");
  });
});
