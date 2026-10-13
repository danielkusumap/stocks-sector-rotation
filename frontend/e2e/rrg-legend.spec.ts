import { expect, test, type Page } from "@playwright/test";

/**
 * F13 D — legenda interaktif RRG (docs/06 §6.2). Semua klaim diukur di DOM
 * (opacity, aria-pressed, posisi PointCard), bukan dari screenshot. Dev server + MSW.
 */

/** Titik yang tidak aktif saat mode fokus. */
const otherPoint = (page: Page, refId: string) => page.getByTestId(`point-${refId}`);
const legend = (page: Page, refId: string) => page.getByTestId(`legend-${refId}`);

test("hover entri legenda = hover titik: titik lain meredup + PointCard di posisi titik", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("rrg-legend")).toBeVisible();

  // normal: semua titik penuh
  await expect(otherPoint(page, "IDXENERGY")).toHaveAttribute("opacity", "1");

  await legend(page, "IDXFINANCE").hover();

  // (i) titik lain 0,22 + ekor lain 0,18 (docs/06 §6.1)
  await expect(otherPoint(page, "IDXENERGY")).toHaveAttribute("opacity", "0.22");
  await expect(page.getByTestId("tail-IDXENERGY-0").first()).toHaveAttribute("opacity", "0.18");
  // titik terfokus r membesar + digambar di lapisan paling akhir
  await expect(page.getByTestId("point-focus-IDXFINANCE")).toBeVisible();
  // PointCard muncul untuk titik itu (posisinya = posisi titik, bukan kursor legenda)
  const card = page.getByTestId("point-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Keuangan");
  const cardBox = (await card.boundingBox())!;
  const pointBox = (await page.getByTestId("point-IDXFINANCE").boundingBox())!;
  expect(Math.abs((cardBox.y + cardBox.height / 2) - (pointBox.y + pointBox.height / 2))).toBeLessThan(24);
});

test("klik entri = pin; klik baris tabel memindahkan pin; klik ulang melepas", async ({ page }) => {
  await page.goto("/");

  const finance = legend(page, "IDXFINANCE");
  await finance.click();
  await expect(finance).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("rrg-chart")).toHaveAttribute("data-pinned", "IDXFINANCE");

  // klik baris tabel → pin pindah (satu keadaan, docs/06 §6.1) + drawer detail sektor terbuka (F7)
  await page.getByTestId("sector-row-IDXENERGY").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape"); // tutup drawer supaya legenda bisa diklik (overlay modal)
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("rrg-chart")).toHaveAttribute("data-pinned", "IDXENERGY");
  await expect(legend(page, "IDXENERGY")).toHaveAttribute("aria-pressed", "true");
  await expect(finance).toHaveAttribute("aria-pressed", "false");

  // klik entri yang sama = lepas pin
  await legend(page, "IDXENERGY").click();
  await expect(legend(page, "IDXENERGY")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("rrg-chart")).toHaveAttribute("data-pinned", "");
});

test("keyboard: Tab sampai entri legenda + Enter = pin, Esc = lepas", async ({ page }) => {
  await page.goto("/");
  const energy = legend(page, "IDXENERGY");
  await expect(energy).toBeVisible();

  await energy.focus();
  await expect(energy).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Enter");
  await expect(energy).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("rrg-chart")).toHaveAttribute("data-pinned", "IDXENERGY");

  // teks entri memuat angka untuk pembaca layar (docs/06 §6.2)
  await expect(energy).toContainText("Energi");
  await expect(energy).toContainText("RS-Ratio");

  await page.keyboard.press("Escape");
  await expect(energy).toHaveAttribute("aria-pressed", "false");
});

test("legenda tidak ikut meredup saat ada pin, dan entri aktif ditandai", async ({ page }) => {
  await page.goto("/");
  await legend(page, "IDXFINANCE").click();

  // (iv) legenda tetap opacity 1 walau titik lain 0,22
  const legendBox = page.getByTestId("rrg-legend");
  await expect(legendBox).toBeVisible();
  expect(await legendBox.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  await expect(otherPoint(page, "IDXENERGY")).toHaveAttribute("opacity", "0.22");

  // hover titik di chart → entri legenda terkait ter-highlight (ring `--focus` + bg-surface-hover)
  await page.getByTestId("point-IDXHEALTH").hover();
  const health = legend(page, "IDXHEALTH");
  const highlighted = await health.evaluate((el) => getComputedStyle(el).boxShadow);
  const plain = await legend(page, "IDXBASIC").evaluate((el) => getComputedStyle(el).boxShadow);
  expect(highlighted).not.toBe("none");
  expect(highlighted).not.toBe(plain);
});

test("urutan entri sama dengan urutan chart, dan pencarian hanya memfilter legenda", async ({
  page,
}) => {
  await page.goto("/");
  const names = await page
    .getByTestId("rrg-legend")
    .locator("button")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-testid")));
  const chartOrder = await page
    .locator('[data-testid^="point-group-"]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-testid")));
  expect(names.map((n) => n?.replace("legend-", ""))).toEqual(
    chartOrder.map((n) => n?.replace("point-group-", "")),
  );

  // scope saham (25 titik) → kotak cari muncul & menyaring legenda saja
  await page.goto("/stocks/BBRI");
  const search = page.getByRole("searchbox", { name: "Cari entri legenda" });
  await expect(search).toBeVisible();
  const before = await page.getByTestId("rrg-legend").locator("button").count();
  await search.fill("BB");
  const after = await page.getByTestId("rrg-legend").locator("button").count();
  expect(after).toBeLessThan(before);
  // data chart tidak berubah oleh pencarian
  await expect(page.locator('[data-testid^="point-group-"]')).toHaveCount(25);
});
