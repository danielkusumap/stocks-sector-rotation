import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, readFilters, toSearch } from "./urlFilters";

describe("readFilters", () => {
  it("mengabaikan nilai tak dikenal dan kembali ke default", () => {
    const f = readFilters("?timeframe=x1&window=9m&weighting=abc&sort=harga&dir=naik");
    expect(f.timeframe).toBe("d1");
    expect(f.window).toBe("3m");
    expect(f.weighting).toBe("equal");
    expect(f.sort).toBe("score");
    expect(f.dir).toBe("desc");
  });

  it("membaca multi-nilai yang dipisah koma dan membuang isi tak valid", () => {
    const f = readFilters("?sector=IDXFINANCE,IDXENERGY&quadrant=leading,bogus,improving");
    expect(f.sector).toEqual(["IDXFINANCE", "IDXENERGY"]);
    expect(f.quadrant).toEqual(["leading", "improving"]);
  });

  it("membatasi angka ke rentang yang diizinkan kontrak", () => {
    expect(readFilters("?min_streak=99").min_streak).toBe(8);
    expect(readFilters("?min_streak=-3").min_streak).toBe(0);
    expect(readFilters("?limit=999").limit).toBe(500);
    expect(readFilters("?limit=abc").limit).toBe(50);
    expect(readFilters("?offset=-5").offset).toBe(0);
  });

  it("menerima tanggal as_of hanya dalam bentuk YYYY-MM-DD dan angka positif untuk ambang", () => {
    expect(readFilters("?as_of=2026-10-12").as_of).toBe("2026-10-12");
    expect(readFilters("?as_of=12-10-2026").as_of).toBeNull();
    expect(readFilters("?min_turnover_idr=1000000000").min_turnover_idr).toBe(1_000_000_000);
    expect(readFilters("?min_turnover_idr=-1").min_turnover_idr).toBeNull();
  });

  it("membaca toggle dan memangkas spasi di q", () => {
    expect(readFilters("?ret_positive_only=1").ret_positive_only).toBe(true);
    expect(readFilters("?ret_positive_only=0").ret_positive_only).toBe(false);
    expect(readFilters("?q=%20bbri%20").q).toBe("bbri");
  });
});

describe("toSearch", () => {
  it("membuang nilai default supaya URL pendek", () => {
    expect(toSearch(DEFAULT_FILTERS).toString()).toBe("");
  });

  it("menulis array sebagai satu param koma-separated (docs/05 §5)", () => {
    const sp = toSearch({ ...DEFAULT_FILTERS, quadrant: ["leading", "improving"] });
    expect(sp.toString()).toBe("quadrant=leading%2Cimproving");
  });

  it("bolak-balik URL → filter → URL tetap sama (koma jadi %2C, tetap satu param)", () => {
    const url = "timeframe=w1_fri&window=1m&sector=IDXFINANCE&quadrant=leading%2Cimproving&min_streak=2&sort=rs_momentum&dir=asc&offset=50";
    expect(toSearch(readFilters(`?${url}`)).toString()).toBe(url);
  });
});
