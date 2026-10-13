import { expect, test } from "@playwright/test";

/**
 * F13d — `summary_lines` + `watchlist` dari `/briefing/morning` di panel "Ringkasan Pasar",
 * plus label regime `mixed` → "Campur". Teks dari API dirender apa adanya (dev server + MSW).
 */

test("ringkasan singkat + blok 'Perlu dipantau' tampil dengan alasan", async ({ page }) => {
  await page.goto("/");

  const summary = page.getByTestId("summary-lines");
  await expect(summary.getByRole("heading", { name: "Ringkasan singkat" })).toBeVisible();
  await expect(summary.locator("li")).toHaveCount(4);
  await expect(summary.locator("li").first()).toContainText("sektor naik hari ini");
  // kalimat dari backend: tanpa istilah teknis mentah
  await expect(summary).not.toContainText("RS-Ratio");
  await expect(summary).not.toContainText("quadrant");

  const watch = page.getByTestId("watchlist");
  await expect(watch.getByRole("heading", { name: "Perlu dipantau" })).toBeVisible();
  await expect(watch.locator("li")).toHaveCount(2);

  // sektor → nama + badge kuadran + streak; saham → ticker (+ nama sebagai keterangan)
  const sector = watch.getByTestId("watch-IDXFINANCE");
  await expect(sector).toContainText("Keuangan");
  await expect(sector).toContainText("Memimpin");
  await expect(sector).toContainText("2w");
  await expect(sector).toContainText("Memimpin 2 minggu berturut-turut");

  const stock = watch.getByTestId("watch-BBRI");
  await expect(stock).toContainText("BBRI");
  await expect(stock).toContainText("Bank Rakyat Indonesia");
  await expect(stock).toContainText("entry 4250, stop 4132");
});

test("summary_lines kosong → 'belum ada hasil hitung'; watchlist [] → blok hilang", async ({ page }) => {
  await page.goto("/?mock=empty");

  const summary = page.getByTestId("summary-lines");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("belum ada hasil hitung");
  await expect(summary.locator("li")).toHaveCount(0);
  // blok kosong jangan ditampilkan (docs/05 §3)
  await expect(page.getByTestId("watchlist")).toHaveCount(0);
});

test("regime 'mixed' dari backend tampil sebagai 'Campur', bukan kode mentah", async ({ page }) => {
  await page.goto("/?mock=mixed");
  await expect(page.getByText("Campur", { exact: true })).toBeVisible();
  await expect(page.getByText("mixed", { exact: true })).toHaveCount(0);
});
