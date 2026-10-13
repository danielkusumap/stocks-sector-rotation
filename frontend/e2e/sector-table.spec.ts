import { expect, test, type Page } from "@playwright/test";

/**
 * F5 — SectorTable & FilterBar. Filter hidup di URL: setiap assertion memeriksa query param
 * hasilnya, bukan hanya tampilan (docs/08 F5).
 */
const params = (page: Page) => new URLSearchParams(new URL(page.url()).search);
const rows = (page: Page) => page.locator("[data-testid^=sector-row-]");

test.describe("SectorTable & FilterBar", () => {
  test("URL contoh 1: quadrant + min_streak menyaring baris dan jadi chip", async ({ page }) => {
    await page.goto("/?quadrant=leading,improving&min_streak=2");

    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByTestId("sector-row-IDXFINANCE")).toBeVisible();
    await expect(page.getByTestId("filter-count")).toHaveText("1 dari 1 sektor");
    await expect(page.getByTestId("chip-quadrant:leading")).toContainText("Memimpin");
    await expect(page.getByTestId("chip-quadrant:improving")).toContainText("Membaik");
    await expect(page.getByTestId("chip-min_streak")).toContainText("streak ≥ 2");

    // angka baris = angka response (bukan hasil hitung frontend)
    const cells = page.getByTestId("sector-row-IDXFINANCE").locator("td");
    await expect(cells.nth(3)).toHaveText("102,31"); // RS-Ratio
    await expect(cells.nth(5)).toHaveText("+0,42"); // Δ1p
    await expect(cells.nth(6)).toHaveText("+1,81%"); // 1M = ret_1w
    await expect(cells.nth(10)).toContainText("2w"); // streak badge
    await expect(cells.nth(11)).toHaveText("87,4"); // skor

    // reload mempertahankan filter (docs/08 F5)
    await page.reload();
    await expect(rows(page)).toHaveCount(1);
    expect(params(page).get("min_streak")).toBe("2");
    expect(params(page).get("quadrant")).toBe("leading,improving");
  });

  test("URL contoh 2: sort dari header menulis sort/dir, klik kedua membalik arah", async ({ page }) => {
    await page.goto("/");
    await expect(rows(page)).toHaveCount(11);
    await expect(rows(page).first()).toHaveAttribute("data-testid", "sector-row-IDXFINANCE"); // score desc

    await page.getByRole("button", { name: "RS-Ratio" }).click();
    await expect.poll(() => params(page).get("sort")).toBe("rs_ratio");
    expect(params(page).get("dir")).toBeNull(); // desc = default, tidak ditulis
    await expect(rows(page).first()).toHaveAttribute("data-testid", "sector-row-IDXFINANCE");

    await page.getByRole("button", { name: "RS-Ratio" }).click();
    await expect.poll(() => params(page).get("dir")).toBe("asc");
    await expect(rows(page).first()).toHaveAttribute("data-testid", "sector-row-IDXENERGY");
    await expect(page.getByRole("columnheader", { name: "RS-Ratio" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );

    // kolom yang tidak punya kunci sort di API tidak bisa diklik
    await expect(page.getByRole("button", { name: "3B" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Umur" })).toHaveCount(0);
  });

  test("URL contoh 3: 0 hasil → EmptyState + Reset mengosongkan URL", async ({ page }) => {
    await page.goto("/?min_streak=8");

    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByText("Tidak ada sektor yang cocok")).toBeVisible();
    await expect(page.getByTestId("filter-count")).toHaveText("0 dari 0 sektor");

    await page.getByRole("button", { name: "Reset filter" }).click();
    await expect.poll(() => page.url()).not.toContain("min_streak");
    await expect(rows(page)).toHaveCount(11);
    await expect(page.getByTestId("filter-count")).toHaveText("11 dari 11 sektor");
  });

  test("chip bisa dihapus satu-satu dan preset cepat menulis URL", async ({ page }) => {
    await page.goto("/?quadrant=leading,improving&min_streak=2&window=6m");
    await expect(page.getByTestId("chip-window")).toContainText("6 bln");

    await page.getByRole("button", { name: "Hapus filter Membaik" }).click();
    await expect.poll(() => params(page).get("quadrant")).toBe("leading");
    expect(params(page).get("min_streak")).toBe("2"); // chip lain tidak ikut hilang

    await page.getByTestId("preset-pemimpin").click();
    await expect.poll(() => params(page).get("quadrant")).toBe("leading");
    expect(params(page).get("min_streak")).toBe("2");

    await page.getByTestId("preset-rotasi").click();
    await expect.poll(() => params(page).get("quadrant")).toBe("improving");
    expect(params(page).get("sort")).toBe("rs_momentum");
    expect(params(page).get("min_streak")).toBeNull(); // preset mengganti, bukan menumpuk

    await page.getByTestId("preset-semua").click();
    await expect.poll(() => params(page).toString()).toBe("");
    await expect(rows(page)).toHaveCount(11);
  });

  test("pin dua arah: klik baris tabel mengunci titik chart, klik titik meng-highlight baris", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByTestId("sector-row-IDXHEALTH").click();
    await expect(page.getByTestId("sector-row-IDXHEALTH")).toHaveAttribute("data-selected", "true");

    // klik baris juga membuka drawer detail (F7) → tutup dulu, baru periksa chart: drawer punya
    // mini-RRG dengan `data-testid` sama (`rrg-chart`), jadi selama drawer terbuka locator ambigu.
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("rrg-chart")).toHaveAttribute("data-pinned", "IDXHEALTH");
    await expect(page.getByTestId("point-IDXENERGY")).toHaveAttribute("opacity", "0.22");

    // arah sebaliknya: klik titik chart → baris tabel ikut ter-highlight
    // (hover dulu: kartu PointCard mengikuti titik aktif, jadi harus pindah sebelum klik)
    await page.getByTestId("point-IDXFINANCE").hover();
    await expect(page.getByTestId("point-card")).toContainText("Keuangan");
    await page.getByTestId("point-IDXFINANCE").click();
    await expect(page.getByTestId("rrg-chart")).toHaveAttribute("data-pinned", "IDXFINANCE");
    await expect(page.getByTestId("sector-row-IDXFINANCE")).toHaveAttribute("data-selected", "true");
    await expect(page.getByTestId("sector-row-IDXHEALTH")).toHaveAttribute("data-selected", "false");
  });

  test("filter lain: likuiditas, sektor, return positif, jendela", async ({ page }) => {
    await page.goto("/?min_turnover_idr=500000000000");
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByTestId("chip-min_turnover_idr")).toContainText("Rp 500,0 M");

    await page.goto("/?sector=IDXFINANCE,IDXHEALTH");
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByTestId("chip-sector:IDXFINANCE")).toContainText("Keuangan");

    // window 3m (default) → kolom return aktif = ret_3m; fixture: 8 dari 11 positif
    await page.goto("/?ret_positive_only=1");
    await expect(rows(page)).toHaveCount(8);
    await expect(page.getByTestId("sector-row-IDXENERGY")).toHaveCount(0);

    await page.goto("/?timeframe=w1_fri&window=6m");
    await expect(page.getByTestId("chip-timeframe")).toContainText("Mingguan (Sen–Jum)");
    await expect(page.getByTestId("chip-window")).toContainText("6 bln");
    await expect(rows(page)).toHaveCount(11);
  });

  test("kontrol di popover Filter mengubah URL", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Filter/ }).click();

    await page.getByRole("button", { name: "Membaik" }).click();
    await expect.poll(() => params(page).get("quadrant")).toBe("improving");

    await page.getByLabel("Streak minimal").fill("3");
    await expect.poll(() => params(page).get("min_streak")).toBe("3");

    await page.getByRole("button", { name: "50 M" }).click();
    await expect.poll(() => params(page).get("min_turnover_idr")).toBe("50000000000");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("filter-count")).toBeVisible();
  });
});
