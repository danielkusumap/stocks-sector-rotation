import { describe, expect, it } from "vitest";
import {
  FILTER_PRESETS,
  activeChips,
  toggleQuadrant,
  toggleSector,
} from "./filters";
import { DEFAULT_FILTERS, readFilters, toSearch, type FilterState } from "./urlFilters";

const filters = (patch: Partial<FilterState> = {}): FilterState => ({ ...DEFAULT_FILTERS, ...patch });

describe("chip filter aktif (docs/06 §5)", () => {
  it("tanpa filter tidak ada chip", () => {
    expect(activeChips(filters())).toEqual([]);
  });

  it("menerjemahkan nilai jadi teks Indonesia", () => {
    const chips = activeChips(
      filters({
        quadrant: ["leading", "improving"],
        min_streak: 2,
        min_turnover_idr: 1_000_000_000,
        sector: ["IDXFINANCE"],
      }),
      { IDXFINANCE: "Keuangan" },
    );
    expect(chips.map((c) => c.label)).toEqual([
      "Memimpin",
      "Membaik",
      "Keuangan",
      "streak ≥ 2",
      "likuiditas ≥ Rp 1,0 M",
    ]);
  });

  it("setiap chip menghapus dirinya sendiri saja", () => {
    const state = filters({ quadrant: ["leading", "improving"], min_streak: 2 });
    const chip = activeChips(state).find((c) => c.key === "quadrant:leading");
    expect(chip?.patch).toEqual({ quadrant: ["improving"] });
    expect(activeChips(state).find((c) => c.key === "min_streak")?.patch).toEqual({ min_streak: 0 });
  });

  it("sort/dir dan q juga jadi chip karena keduanya filter URL (docs/06 §7)", () => {
    const chips = activeChips(filters({ sort: "rs_ratio", dir: "asc", q: "bbri" }));
    expect(chips.map((c) => c.key)).toEqual(["sort", "q"]);
    expect(chips[0].patch).toEqual({ sort: "score", dir: "desc" });
    expect(chips[1].patch).toEqual({ q: "" });
  });
});

describe("preset cepat (docs/06 §7)", () => {
  it("tiga preset, dan 'Semua lingkup' mengembalikan seluruh default", () => {
    expect(FILTER_PRESETS.map((p) => p.label)).toEqual([
      "Rotasi aktif",
      "Pemimpin",
      "Semua lingkup",
    ]);
    const semua = FILTER_PRESETS[2];
    expect(semua.patch).toEqual(DEFAULT_FILTERS);
    // patch preset yang sudah penuh → URL kembali kosong
    expect(toSearch({ ...DEFAULT_FILTERS, ...semua.patch }).toString()).toBe("");
  });

  it("'Pemimpin' menulis quadrant & min_streak, 'Rotasi aktif' mengurutkan rs_momentum", () => {
    const pemimpin = FILTER_PRESETS.find((p) => p.id === "pemimpin")!.patch;
    expect(pemimpin).toMatchObject({ quadrant: ["leading"], min_streak: 2, sort: "score", dir: "desc" });
    const rotasi = FILTER_PRESETS.find((p) => p.id === "rotasi")!.patch;
    expect(toSearch({ ...DEFAULT_FILTERS, ...rotasi }).toString()).toBe(
      "quadrant=improving&sort=rs_momentum",
    );
  });

  it("preset mengganti kelompok penyaring, bukan menumpuk", () => {
    // dari state 'Pemimpin' lalu klik 'Rotasi aktif' → min_streak ikut bersih
    const pemimpin = { ...DEFAULT_FILTERS, ...FILTER_PRESETS.find((p) => p.id === "pemimpin")!.patch };
    expect(pemimpin.min_streak).toBe(2);
    const rotasi = { ...pemimpin, ...FILTER_PRESETS.find((p) => p.id === "rotasi")!.patch };
    expect(rotasi.min_streak).toBe(0);
    expect(rotasi.quadrant).toEqual(["improving"]);
    // lingkup (timeframe/window) tidak diusik preset penyaring
    expect(rotasi.window).toBe(DEFAULT_FILTERS.window);
  });

  it("preset sempit tidak menyentuh paginasi", () => {
    for (const preset of FILTER_PRESETS.filter((p) => p.id !== "semua")) {
      expect(preset.patch.limit).toBeUndefined();
      expect(preset.patch.offset).toBeUndefined();
    }
  });
});

describe("toggle filter multi-nilai", () => {
  it("kuadran ditambah/dihapus tanpa mengubah yang lain", () => {
    const state = filters({ quadrant: ["leading"] });
    expect(toggleQuadrant(state, "improving")).toEqual({ quadrant: ["leading", "improving"] });
    expect(toggleQuadrant(state, "leading")).toEqual({ quadrant: [] });
  });

  it("sektor mengikuti pola yang sama", () => {
    const state = filters({ sector: ["IDXFINANCE"] });
    expect(toggleSector(state, "IDXFINANCE")).toEqual({ sector: [] });
    expect(toggleSector(state, "IDXHEALTH")).toEqual({ sector: ["IDXFINANCE", "IDXHEALTH"] });
  });
});

describe("bolak-balik URL → state → URL", () => {
  it("contoh docs/05 §5 tetap utuh (nilai default dibuang, koma di-encode URLSearchParams)", () => {
    const state = readFilters(
      "timeframe=w1_fri&window=3m&quadrant=leading,improving&min_streak=2&sort=score",
    );
    expect(state.quadrant).toEqual(["leading", "improving"]);
    expect(state.min_streak).toBe(2);
    // window=3m & sort=score adalah default → tidak ditulis ulang
    expect(toSearch(state).toString()).toBe("timeframe=w1_fri&quadrant=leading%2Cimproving&min_streak=2");
    expect(readFilters(toSearch(state))).toEqual(state);
  });
});
