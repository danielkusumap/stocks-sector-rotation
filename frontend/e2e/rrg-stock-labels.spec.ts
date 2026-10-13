import { expect, test } from "@playwright/test";

/** F16 — label/legenda/kartu pakai ticker untuk scope saham (docs/06 §6 + §6.2). */
test.describe("label RRG saham (docs/08 F16)", () => {
  test("drawer sektor: label titik = ticker, legenda & kartu `TICKER · Nama`", async ({ page }) => {
    await page.goto("/?sector=IDXFINANCE");
    const drawer = page.getByRole("dialog");
    await expect(drawer.locator("[data-testid^=constituent-]").first()).toBeVisible();

    // legenda: entri `BBRI · Bank Rakyat Indonesia`
    const legend = drawer.getByTestId("legend-BBRI");
    await expect(legend).toContainText("BBRI · Bank Rakyat Indonesia");
    await expect(legend.locator("span.truncate")).toHaveAttribute("title", "Bank Rakyat Indonesia");

    // kartu hover: judul memuat ticker + nama
    await legend.hover();
    await expect(drawer.getByTestId("point-card-title")).toHaveText("BBRI · Bank Rakyat Indonesia");

    // aria-live memuat ticker (bukan hanya nama panjang)
    await expect(drawer.getByTestId("rrg-live")).toContainText("BBRI · Bank Rakyat Indonesia");

    // label titik di chart: titik yang sedang di-hover berlabel ticker saja
    await expect(drawer.getByTestId("label-BBRI")).toHaveText("BBRI");
    await expect(drawer.getByTestId("label-BBRI")).not.toContainText("Bank");
    // label sektor lama tidak muncul di mini-RRG saham
    await expect(drawer.getByTestId("label-IDXFINANCE")).toHaveCount(0);
  });

  test("regresi scope sektor: label tetap nama sektor, tanpa ticker di legenda", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("legend-IDXFINANCE")).toContainText("Keuangan");
    await expect(page.getByTestId("legend-IDXFINANCE")).not.toContainText("IDXFINANCE ·");
    await page.getByTestId("legend-IDXFINANCE").hover();
    await expect(page.getByTestId("point-card-title")).toHaveText("Keuangan");
    await expect(page.getByTestId("rrg-live")).toContainText("Keuangan — Memimpin");
  });
});
