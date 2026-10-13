import { expect, test, type Page } from "@playwright/test";

/**
 * F14 — chip filter kuadran saham di `SectorDrawer` (docs/06 §6.4).
 * Satu state menggerakkan chart mini-RRG **dan** tabel konstituen: angka chip dari
 * respons `/rrg` (tanpa permintaan tambahan), tabel menyaring lewat API (`quadrant=`).
 *
 * Angka mock: `/rrg?scope=stock&sector=IDXFINANCE` diisi sampai 60 titik (25 digambar,
 * sisanya ke tabel) → chip `Semua (60)`. Tabel konstituen dari `/stocks` = 4 saham
 * fixture IDXFINANCE (3 Memimpin, 1 Melemah; 0 Membaik, 0 Tertinggal).
 */
const chips = (page: Page) => page.getByTestId("drawer-quadrant-chips");
const chip = (page: Page, name: string) => chips(page).getByRole("button", { name });
const chartPoints = (page: Page) => page.locator("[role=dialog] g[data-point]");
const rows = (page: Page) => page.locator("[role=dialog] [data-testid^=constituent-]");

async function openDrawer(page: Page) {
  await page.goto("/?sector=IDXFINANCE");
  await expect(rows(page).first()).toBeVisible();
}

test.describe("SectorDrawer — chip kuadran saham", () => {
  test("Semua (default): angka chip dari /rrg, chart & tabel perilaku lama", async ({ page }) => {
    await openDrawer(page);

    await expect(chip(page, "Semua (60)")).toHaveAttribute("aria-pressed", "true");
    await expect(chip(page, "Memimpin (17)")).toBeVisible();
    await expect(chip(page, "Melemah (15)")).toBeVisible();
    await expect(chip(page, "Tertinggal (14)")).toBeVisible();
    await expect(chip(page, "Membaik (14)")).toBeVisible();

    // regresi F4/F13: titik dipotong 25 + catatan cap + tabel 4 baris
    await expect(chartPoints(page)).toHaveCount(25);
    await expect(page.getByTestId("rrg-cap-note")).toContainText("Menampilkan 25 dari 60");
    await expect(rows(page)).toHaveCount(4);
    await expect(page.getByRole("button", { name: "Tampilkan semua" })).toHaveCount(0);
  });

  test("satu kuadran: chart menyempit, tabel memakai kuadran itu di request", async ({
    page,
  }) => {
    const rrgCalls: string[] = [];
    const stockCalls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/v1/rrg")) rrgCalls.push(request.url());
      if (request.url().includes("/api/v1/stocks?")) stockCalls.push(request.url());
    });
    await openDrawer(page);

    const rrgBefore = rrgCalls.length;
    const stocksBefore = stockCalls.length;
    await chip(page, "Melemah (15)").click();

    await expect(chip(page, "Melemah (15)")).toHaveAttribute("aria-pressed", "true");
    await expect(chip(page, "Semua (60)")).toHaveAttribute("aria-pressed", "false");

    // (a) titik di luar kuadran dibuang SEBELUM digambar (batas 25 berlaku setelah filter)
    await expect(page.getByTestId("point-BBNI")).toBeVisible();
    await expect(page.getByTestId("point-BBRI")).toHaveCount(0);
    await expect(chartPoints(page)).toHaveCount(15);
    await expect(page.getByTestId("rrg-cap-note")).toHaveCount(0);

    // (b) tabel konstituen menyaring lewat API — isinya respons, bukan sisa unduhan chart
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByTestId("constituent-BBNI")).toBeVisible();
    await expect.poll(() => stockCalls.at(-1) ?? "").toContain("quadrant=weakening");

    // AC4: per klik hanya /stocks yang jalan (chip tidak memicu /rrg maupun /stocks berkali-kali)
    await page.waitForTimeout(300);
    expect(rrgCalls.length).toBe(rrgBefore);
    expect(stockCalls.length).toBe(stocksBefore + 1);
    console.log(`Network /stocks: ${stockCalls.at(-1)}`);
  });

  test("kuadran tanpa konstituen: EmptyState tabel + 'Tampilkan semua'", async ({ page }) => {
    await openDrawer(page);
    await chip(page, "Membaik (14)").click();

    await expect(page.getByText("Tidak ada konstituen di kuadran ini")).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
    // chart tetap digambar (mock mengisi 14 titik di kuadran itu)
    await expect(chartPoints(page)).toHaveCount(14);

    await page.getByRole("button", { name: "Tampilkan semua" }).first().click();
    await expect(rows(page)).toHaveCount(4);
    await expect(chip(page, "Semua (60)")).toHaveAttribute("aria-pressed", "true");
    await expect(chartPoints(page)).toHaveCount(25);
  });

  test("filter bertahan saat timeframe diganti dari topbar; as_of ikut ke chart", async ({
    page,
  }) => {
    const rrgCalls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/v1/rrg")) rrgCalls.push(request.url());
    });
    await page.goto("/?sector=IDXFINANCE&as_of=2026-10-09");
    await expect(rows(page).first()).toBeVisible();
    // chart memakai tanggal yang sama dengan tabel (docs/08 F14)
    await expect.poll(() => rrgCalls.at(-1) ?? "").toContain("as_of=2026-10-09");

    await chip(page, "Melemah (15)").click();
    await expect(chartPoints(page)).toHaveCount(15);

    // topbar ada di luar drawer (modal) → ditutup dulu, lalu dibuka lagi; state chip lokal
    // drawer bertahan karena komponennya tidak di-unmount (hanya isi dialog).
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Mingguan (Sen–Jum)" }).click();
    await page.getByRole("button", { name: "Pilih sektor Keuangan" }).click();
    await expect(rows(page).first()).toBeVisible();

    await expect(chip(page, "Melemah (15)")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => rrgCalls.at(-1) ?? "").toContain("timeframe=w1_fri");
    await expect.poll(() => rrgCalls.at(-1) ?? "").toContain("as_of=2026-10-09");
    await expect(chartPoints(page)).toHaveCount(15);

    // keyboard: chip dijangkau & dipilih dengan Enter (Segmented + aria-pressed)
    await chip(page, "Memimpin (17)").focus();
    await page.keyboard.press("Enter");
    await expect(chip(page, "Memimpin (17)")).toHaveAttribute("aria-pressed", "true");
    await expect(chartPoints(page)).toHaveCount(17);
  });
});
