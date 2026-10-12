import { expect, test, type Page } from "@playwright/test";

/**
 * F7 — SectorDrawer. AC: URL berisi `?sector=IDXFINANCE` saat terbuka (shareable),
 * `/stocks` dipanggil dengan `sector` + `timeframe` yang benar, Esc menutup & fokus
 * kembali ke baris asal.
 */
const params = (page: Page) => new URLSearchParams(new URL(page.url()).search);

test.describe("SectorDrawer", () => {
  test("buka dari baris tabel: URL shareable, metrik, seri, konstituen, RRG saham", async ({ page }) => {
    const stockCalls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/v1/stocks?")) stockCalls.push(request.url());
    });

    await page.goto("/");
    await expect(page.getByTestId("sector-row-IDXFINANCE")).toBeVisible();
    await page.getByRole("button", { name: "Pilih sektor Keuangan" }).click();

    // AC: URL memuat sector=IDXFINANCE (bisa di-share)
    await expect.poll(() => params(page).get("sector")).toBe("IDXFINANCE");
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Keuangan — detail sektor");

    // AC: /stocks dipanggil dengan sector + timeframe yang benar
    await expect.poll(() => stockCalls.length).toBeGreaterThan(0);
    const stockUrl = stockCalls.at(-1)!;
    expect(stockUrl).toContain("sector=IDXFINANCE");
    expect(stockUrl).toContain("timeframe=d1");
    expect(stockUrl).toContain("sort=stock_score");

    // metrik dari /sectors/{code}
    await expect(drawer).toContainText("RS-Ratio");
    await expect(drawer).toContainText("102,31");
    await expect(drawer).toContainText("Memimpin");

    // seri indeks vs IHSG: dua garis + legend
    await expect(drawer.getByTestId("sector-series")).toBeVisible();
    await expect(drawer.getByTestId("sector-series").locator("polyline")).toHaveCount(2);
    await expect(drawer.getByTestId("sector-series-legend")).toContainText("IHSG");

    // tabel konstituen dari /stocks
    await expect(drawer.locator("[data-testid^=constituent-]").first()).toBeVisible();
    await expect(drawer.getByRole("columnheader", { name: "Ticker" })).toBeVisible();

    // mini-RRG saham (scope=stock, dipotong 25 titik)
    await expect(drawer.locator("g[data-point]").first()).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Lihat semua di tabel" })).toHaveAttribute(
      "href",
      "/stocks?sector=IDXFINANCE",
    );
  });

  test("sorting konstituen mengubah param request (bukan mengurutkan di frontend)", async ({ page }) => {
    const stockCalls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/v1/stocks?")) stockCalls.push(request.url());
    });

    await page.goto("/?sector=IDXFINANCE");
    const drawer = page.getByRole("dialog");
    await expect(drawer.locator("[data-testid^=constituent-]").first()).toBeVisible();

    await drawer.getByRole("button", { name: "Ticker" }).click();
    await expect.poll(() => stockCalls.at(-1)).toContain("sort=ticker");
    expect(stockCalls.at(-1)).toContain("dir=desc");
    await drawer.getByRole("button", { name: "Ticker" }).click();
    await expect.poll(() => stockCalls.at(-1)).toContain("dir=asc");
  });

  test("Esc menutup drawer, membersihkan URL, dan fokus kembali ke baris asal", async ({ page }) => {
    await page.goto("/");
    const rowButton = page.getByRole("button", { name: "Pilih sektor Keuangan" });
    await rowButton.click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // fokus terkunci di dalam drawer
    const locked = await page.evaluate(() =>
      Boolean(document.querySelector("[role=dialog]")?.contains(document.activeElement)),
    );
    expect(locked).toBe(true);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => params(page).get("sector")).toBeNull();
    await expect(page.getByRole("button", { name: "Pilih sektor Keuangan" })).toBeFocused();
  });

  test("dibuka dari kartu hover chart (tombol Detail sektor)", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("point-IDXHEALTH").hover();
    await page.getByTestId("point-card-detail").click();

    await expect.poll(() => params(page).get("sector")).toBe("IDXHEALTH");
    await expect(page.getByRole("dialog")).toContainText("Kesehatan — detail sektor");
  });

  test("URL shareable: buka ?sector=IDXFINANCE langsung menampilkan drawer", async ({ page }) => {
    await page.goto("/?sector=IDXFINANCE&timeframe=w1_fri");
    await expect(page.getByRole("dialog")).toContainText("Keuangan — detail sektor");
    // filter tabel ikut menyempit ke sektor itu (param yang sama)
    await expect(page.locator("[data-testid^=sector-row-]")).toHaveCount(1);
  });
});
