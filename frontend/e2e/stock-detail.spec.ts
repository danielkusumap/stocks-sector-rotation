import { expect, test } from "@playwright/test";

/**
 * F8 — `/stocks/{ticker}`: metrik, sparkline, RRG vs sektor, snapshot pick terakhir.
 * AC docs/08 F8: saham tanpa pick menampilkan "—" (bukan error).
 */
test.describe("Detail saham", () => {
  test("BBRI: metrik, sparkline, RRG saham, snapshot pick", async ({ page }) => {
    await page.goto("/stocks/BBRI");

    await expect(page.getByRole("heading", { name: "Bank Rakyat Indonesia (BBRI)" })).toBeVisible();
    const header = page.locator("section", { hasText: "Bank Rakyat Indonesia (BBRI)" }).first();
    // harga & delta dari API (format Indonesia)
    await expect(header.getByText("4.250")).toBeVisible();
    await expect(header.getByText("+0,62%").first()).toBeVisible();
    await expect(header.getByText("Memimpin")).toBeVisible();
    await expect(header.getByText("IDXFINANCE · BBRI.JK")).toBeVisible();

    // metrik (dl pertama = blok metrik)
    const metrics = header.locator("dl").first();
    await expect(metrics.getByText("RS-Ratio")).toBeVisible();
    await expect(metrics.getByText("103,10")).toBeVisible();
    await expect(metrics.getByText("62,4")).toBeVisible(); // RSI
    await expect(metrics.getByText("77")).toBeVisible(); // ATR 76,5 → rupiah bulat

    // sparkline 80×24 dari seri harga
    const sparkline = page.getByTestId("sparkline");
    await expect(sparkline).toBeVisible();
    await expect(sparkline).toHaveAttribute("viewBox", "0 0 80 24");
    await expect(sparkline.locator("polyline")).toHaveCount(1);

    // RRG saham sektor (scope=stock, satu titik = BBRI)
    await expect(page.locator("g[data-point]").first()).toBeVisible();
    await expect(page.getByTestId("point-BBRI")).toBeVisible();
    await expect(page.getByRole("link", { name: "Lihat semua di tabel" })).toHaveAttribute(
      "href",
      "/stocks?sector=IDXFINANCE",
    );

    // snapshot pick terakhir
    const pick = page.locator("section", { hasText: "Snapshot pick terakhir" }).first();
    await expect(pick.getByText("pekan 9 Okt 2026")).toBeVisible();
    await expect(pick.getByText("peringkat 1")).toBeVisible();
    await expect(pick.getByText("4.132")).toBeVisible(); // stop
    await expect(pick.getByText("4.486")).toBeVisible(); // target
    await expect(pick.getByText(/3 minggu berturut-turut masuk daftar/)).toBeVisible();
    await expect(pick.getByText("3w")).toBeVisible(); // streak badge
  });

  test("saham tanpa pick: tampil —, bukan error", async ({ page }) => {
    await page.goto("/stocks/TLKM");

    await expect(page.getByRole("heading", { name: "Telkom Indonesia (TLKM)" })).toBeVisible();
    await expect(page.getByTestId("no-pick")).toBeVisible();
    await expect(page.getByTestId("no-pick")).toContainText("—");
    // panel lain tetap tampil
    await expect(page.getByTestId("sparkline")).toBeVisible();
    await expect(page.locator("dl").first().getByText("RS-Ratio")).toBeVisible();
  });

  test("ticker tidak dikenal: ErrorState + Coba lagi (bukan layar putih)", async ({ page }) => {
    await page.goto("/stocks/ZZZZ");

    await expect(page.getByText(/Coba lagi/).first()).toBeVisible();
    await expect(page.getByText(/stock_not_found|tidak ada/i).first()).toBeVisible();
  });

  test("navigasi: dari tabel ke detail dan kembali", async ({ page }) => {
    await page.goto("/stocks?sector=IDXFINANCE&limit=10");
    await page.getByRole("button", { name: "Buka detail BBCA" }).click();
    await expect.poll(() => page.url()).toContain("/stocks/BBCA");
    await expect(page.getByRole("heading", { name: /BBCA/ })).toBeVisible();

    await page.getByRole("link", { name: "← Semua saham" }).click();
    // kembali ke tabel dengan filter yang sama (link membawa query)
    await expect.poll(() => page.url()).toContain("/stocks?");
    expect(new URLSearchParams(new URL(page.url()).search).get("sector")).toBe("IDXFINANCE");
    await expect(page.getByTestId("stock-row-BBCA")).toBeVisible();
  });
});
