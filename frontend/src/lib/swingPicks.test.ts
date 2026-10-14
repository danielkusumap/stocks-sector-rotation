import { describe, expect, it } from "vitest";
import type { PlanPick } from "./api";
import {
  PICK_STATUS_LABEL,
  PICK_STATUS_ORDER,
  cardFigures,
  computeBannerText,
  dateTabLabel,
  dayBadge,
  levelRows,
  needsCompute,
  reasonRows,
  rulerAriaLabel,
  rulerGeometry,
  runningGroups,
  runningText,
  statusLabel,
  summaryLine,
  zoneLabel,
} from "./swingPicks";

const pick = (over: Partial<PlanPick> = {}): PlanPick => ({
  ticker: "SMDR",
  name: "Samudera Indonesia Tbk.",
  sector_code: "IDXTRANS",
  close: 412,
  turnover_idr: 11_500_000_000,
  atr14: 15.6,
  atr_pct: 0.0379,
  rsi14: 63.1,
  regime: "tren_naik",
  regime_label: "Tren naik",
  entry_zone: { low: 402, high: 413, reason: "dari penahan 20 hari" },
  zone_status: "di_zona",
  zone_pct: 0.027,
  zone_gap_atr: -0.04,
  entry: 407.5,
  stop: { level: 383, pct: -0.058, basis: "volatilitas_atr", reason: "1,5× ATR" },
  tp1: { level: 434, pct: 0.066, rr: 1.12, basis: "penahan_20", reason: "penahan 20 hari" },
  tp2: { level: 485, pct: 0.19, rr: 3.0, basis: "donchian_40", reason: "puncak 40 hari" },
  skor: 7.362,
  rank: 1,
  ...over,
});

describe("label status berjalan", () => {
  it("urutan kelompok tetap & semua status punya label Indonesia", () => {
    expect(PICK_STATUS_ORDER).toEqual([
      "kena_tp2",
      "kena_tp1",
      "di_zona",
      "menunggu_zona",
      "kena_stop",
      "kedaluwarsa",
    ]);
    expect(PICK_STATUS_LABEL.kena_tp1).toBe("Kena target 1");
    expect(PICK_STATUS_LABEL.kena_stop).toBe("Kena batas rugi");
    expect(PICK_STATUS_LABEL.kedaluwarsa).toBe("Kedaluwarsa");
    expect(statusLabel(undefined)).toBeNull();
    expect(statusLabel("di_zona")).toBe("Di zona beli");
  });

  it("badge zona: dua keadaan saja", () => {
    expect(zoneLabel(pick())).toBe("Di zona beli");
    expect(zoneLabel(pick({ zone_status: "mendekati" }))).toBe("Mendekati zona");
  });
});

describe("label tanggal & badge hari", () => {
  it("tab memakai hari Indonesia", () => {
    expect(dateTabLabel("2026-10-13")).toBe("Sel, 13 Okt");
    expect(dateTabLabel("2026-10-09")).toBe("Jum, 9 Okt");
    expect(dateTabLabel("bukan-tanggal")).toBe("bukan-tanggal");
  });

  it("badge hanya muncul saat tab bukan hari terakhir data", () => {
    expect(dayBadge("2026-10-13", "2026-10-13")).toBeNull();
    expect(dayBadge("2026-10-12", "2026-10-14")).toBe("data per 12 Okt 2026, hari ini 14 Okt 2026");
  });
});

describe("ringkasan hari & banner hitung", () => {
  it("satu baris angka Indonesia + support IHSG bila ada", () => {
    const line = summaryLine({ picks: [pick()], screened: 21, ihsg_support: 5828.68 });
    expect(line).toBe("1 kandidat lolos · 21 emiten disaring · support IHSG 5.829");
  });

  it("support null → barisnya tidak ditampilkan", () => {
    expect(summaryLine({ picks: [], screened: 0, ihsg_support: null })).toBe("0 kandidat lolos · 0 emiten disaring");
  });

  it("banner hanya saat tanggal tersedia < 5", () => {
    expect(needsCompute(["2026-10-13"])).toBe(true);
    expect(needsCompute(["a", "b", "c", "d"])).toBe(true);
    expect(needsCompute(["a", "b", "c", "d", "e"])).toBe(false);
    expect(computeBannerText(["2026-10-13"])).toBe("5 hari bursa terakhir belum dihitung (baru 1 tanggal tersedia)");
  });
});

describe("rencana & alasan", () => {
  it("baris rencana: zona, batas rugi bertanda, target dengan R:R, peluang tanpa tanda", () => {
    const rows = levelRows(pick({ hit_tp1: 0.62 }));
    expect(rows.map((row) => row.key)).toEqual(["zone", "stop", "tp1", "tp2", "chance"]);
    expect(rows[0].value).toBe("402–413");
    expect(rows[1].value).toBe("383 (−5,80%)");
    expect(rows[2].value).toBe("434 (+6,60%) · R:R 1,12:1");
    expect(rows[3].value).toBe("485 (+19,00%) · R:R 3,00:1");
    expect(rows[4].value).toBe("62%");
    expect(rows[4].value.startsWith("+")).toBe(false);
  });

  it("peluang tidak dikarang: tanpa field → baris tidak ada", () => {
    expect(levelRows(pick()).map((row) => row.key)).not.toContain("chance");
  });

  it("R:R null → tidak menulis `R:R —`", () => {
    const rows = levelRows(pick({ tp1: { level: 434, pct: 0.066, rr: null }, tp0: { level: 431, pct: 0.058, rr: 1 } }));
    expect(rows[2].value).toBe("434 (+6,60%)");
    expect(rows.at(-1)!.key).toBe("tp0");
  });

  it("alasan hanya level yang punya teks", () => {
    const rows = reasonRows(pick({ tp1: { level: 434, pct: 0.066, reasoning: undefined } as never }));
    expect(rows.map((row) => row.key)).toEqual(["zone", "stop", "tp2"]);
    expect(rows.every((row) => row.text.length > 0)).toBe(true);
  });
});

describe("penggaris level", () => {
  it("posisi 0–1 memakai rentang harga API, bukan hitungan baru", () => {
    const geometry = rulerGeometry(pick());
    const stop = geometry.stops.find((item) => item.kind === "stop")!;
    const tp2 = geometry.stops.find((item) => item.kind === "tp2")!;
    expect(stop.ratio).toBe(0); // 383 = batas bawah rentang
    expect(tp2.ratio).toBe(1); // 485 = batas atas rentang
    expect(geometry.zone!.from).toBeGreaterThan(0);
    expect(geometry.zone!.from).toBeLessThan(geometry.zone!.to);
  });

  it("harga terakhir pakai close_latest bila ada (bukan close tanggal pick)", () => {
    const withLatest = rulerGeometry(pick({ close_latest: 420 }));
    expect(withLatest.last).toBe(420);
    expect(rulerGeometry(pick({ close_latest: null })).last).toBe(412);
  });

  it("semua harga sama → rasio 0,5 (tidak bagi nol)", () => {
    const flat = rulerGeometry(
      pick({
        close: 400,
        close_latest: null,
        entry_zone: { low: 400, high: 400 },
        stop: { level: 400, pct: null },
        tp1: { level: 400, pct: null },
        tp2: { level: 400, pct: null },
      }),
    );
    expect(flat.stops.every((item) => item.ratio === 0.5)).toBe(true);
  });

  it("aria-label memuat semua angka (status tidak ditandai warna saja)", () => {
    const label = rulerAriaLabel(pick({ close_latest: 420 }));
    for (const part of ["batas rugi 383", "zona beli 402–413", "target 1 434", "target 2 485", "harga terakhir 420"]) {
      expect(label).toContain(part);
    }
  });
});

describe("status berjalan per pick", () => {
  it("teks ringkas: return bertanda, sempat naik tanpa tanda, sempat turun bertanda", () => {
    const text = runningText(
      pick({ status: "kena_tp1", ret_sejak_asof: 0.049, mfe_pct: 0.058, mae_pct: -0.011, bars_sejak_asof: 2 }),
    );
    expect(text).toBe("sejak pick +4,90% · sempat naik 5,8%, sempat turun −1,10% · 2 hari");
  });

  it("tanpa status → tidak ada baris pantauan", () => {
    expect(runningText(pick({ status: null }))).toBeNull();
  });

  it("field null tidak menulis `—` di tengah kalimat", () => {
    expect(runningText(pick({ status: "di_zona", ret_sejak_asof: null, mfe_pct: null, mae_pct: null, bars_sejak_asof: 1 }))).toBe(
      "1 hari",
    );
  });
});

describe("kelompok pantauan", () => {
  it("hanya pick berjalan yang dikelompokkan, menunggu zona dilewati", () => {
    const groups = runningGroups([
      {
        date: "2026-10-12",
        picks: [
          pick({ ticker: "ASSA", status: "kena_tp1" }),
          pick({ ticker: "KLBF", status: "menunggu_zona" }),
          pick({ ticker: "BMRI", status: "di_zona" }),
        ],
      },
      { date: "2026-10-09", picks: [pick({ ticker: "BBCA", status: "kena_tp2" }), pick({ ticker: "ACES", status: "kena_stop" })] },
    ]);
    expect(groups.map((group) => group.status)).toEqual(["kena_tp2", "kena_tp1", "di_zona", "kena_stop"]);
    expect(groups[0].items).toEqual([{ ticker: "BBCA", date: "2026-10-09", note: null }]);
    expect(groups.map((group) => group.items.length)).toEqual([1, 1, 1, 1]);
  });

  it("pick tanpa status (tanggal terbaru) tidak muncul", () => {
    expect(runningGroups([{ date: "2026-10-13", picks: [pick({ status: null })] }])).toEqual([]);
  });
});

describe("angka baris kartu", () => {
  it("harga, jarak zona bertanda, RSI, ATR% — semuanya dari API", () => {
    const figures = cardFigures(pick());
    expect(figures.map((figure) => figure.key)).toEqual(["close", "zone-pct", "rsi", "atr"]);
    expect(figures[0].value).toBe("412");
    expect(figures[1].value).toBe("+2,70%");
    expect(figures[2].value).toBe("63,1");
    expect(figures[3].value).toBe("3,79%");
  });

  it("null → `—` (bukan 0)", () => {
    const figures = cardFigures(pick({ zone_pct: null, rsi14: null, atr_pct: null }));
    expect(figures.slice(1).every((figure) => figure.value === "—")).toBe(true);
  });
});
