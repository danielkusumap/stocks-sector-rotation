import { expect, test, type Page } from "@playwright/test";

/**
 * F9 — halaman /weekly (docs/08 F9). Data dari MSW (fixture docs/05 §3):
 * 3 sektor + 6 saham pada pekan final 2026-10-09.
 */
const params = (page: Page) => new URLSearchParams(new URL(page.url()).search);
const picks = (page: Page, scope: "sector" | "stock") =>
  page.locator(`[data-testid^=pick-${scope}-]`);

test.describe("halaman Weekly", () => {
  test("dua blok terisi: rank, badge hanya saat streak ≥ 2w, entry/stop/target monospace", async ({
    page,
  }) => {
    await page.goto("/weekly");

    await expect(page.getByTestId("weekly-week")).toContainText("pekan 5–9 Okt 2026");
    await expect(page.getByTestId("weekly-week")).toContainText("final");
    await expect(picks(page, "sector")).toHaveCount(3);
    await expect(picks(page, "stock")).toHaveCount(6);

    const keuangan = page.getByTestId("pick-sector-IDXFINANCE");
    await expect(keuangan).toContainText("Keuangan");
    await expect(keuangan).toContainText("skor 87,4");
    // badge streak: ada saat 2w
    await expect(keuangan.getByTestId("pick-streak")).toHaveText("2w");

    // streak 1 → badge tidak muncul (docs/08 F9 AC), tapi barisnya tetap tampil
    const kesehatan = page.getByTestId("pick-sector-IDXHEALTH");
    await expect(kesehatan).toHaveAttribute("data-streak", "1");
    await expect(kesehatan.getByTestId("pick-streak")).toBeEmpty();
    await expect(kesehatan.getByTestId("pick-streak")).toHaveAttribute("data-weeks", "1");

    // entry/stop/target: angka format Indonesia + font monospace (docs/06 §4/§5)
    const bbri = page.getByTestId("pick-stock-BBRI");
    await expect(bbri).toContainText("BBRI");
    await expect(bbri.getByTestId("pick-figures")).toHaveText(
      "entry 4.250 · stop 4.132 · target 4.486 · 12 lot · skor 92,1",
    );
    await expect(bbri.getByTestId("pick-figures").locator(".font-mono")).toHaveCSS(
      "font-family",
      /mono/i,
    );
    await expect(bbri.getByTestId("pick-streak")).toHaveText("3w");

    // rational datang dari API, apa adanya
    await expect(bbri).toContainText("3 minggu berturut-turut masuk daftar");
  });

  test("expander 'kenapa?' membuka SEMUA rule_hits dengan label Indonesia", async ({ page }) => {
    await page.goto("/weekly");

    const bbri = page.getByTestId("pick-stock-BBRI");
    const stockRules = bbri.getByTestId("rule-hits");
    await expect(stockRules).toBeHidden();
    await bbri.locator("summary").click();
    await expect(stockRules).toBeVisible();

    // 7 aturan docs/03 §6.2 — tidak ada yang disembunyikan
    await expect(stockRules.locator("li")).toHaveCount(7);
    for (const key of [
      "liquidity_ok",
      "price_ok",
      "trend_ok",
      "rs_ok",
      "momentum_ok",
      "rsi_ok",
      "no_suspension",
    ]) {
      await expect(stockRules.locator(`li[data-rule=${key}]`)).toHaveCount(1);
    }
    await expect(stockRules.locator("li[data-rule=trend_ok]")).toContainText(
      "tren: close > SMA20 > SMA50",
    );
    await expect(stockRules.locator("li[data-rule=no_suspension]")).toContainText("tidak suspend");
    // status lolos/gagal diumumkan ke pembaca layar, bukan hanya ikon
    await expect(stockRules.locator("li[data-rule=rsi_ok]")).toContainText("lolos");

    // keyboard: Enter pada summary menutup lagi (details native, tanpa handler sendiri)
    await bbri.locator("summary").press("Enter");
    await expect(stockRules).toBeHidden();

    // sektor: kuadran = baris info, sisanya 4 aturan docs/03 §6.1
    const keuangan = page.getByTestId("pick-sector-IDXFINANCE");
    await keuangan.locator("summary").click();
    await expect(keuangan.getByTestId("rule-hits").locator("li")).toHaveCount(5);
    await expect(keuangan.locator("li[data-rule=quadrant]")).toContainText("kuadran Memimpin");
    await expect(keuangan.locator("li[data-ok=info]")).toHaveCount(1);
    await expect(keuangan.locator("li[data-rule=constituents_ok]")).toContainText(
      "konstituen ≥ 3 saham",
    );
  });

  test("memilih pekan berjalan → catatan 'belum final' + daftar kosong, bukan error", async ({
    page,
  }) => {
    await page.goto("/weekly");
    await expect(picks(page, "sector")).toHaveCount(3); // default: minggu final terakhir

    await page.getByRole("combobox", { name: "Pekan" }).click();
    await page.getByRole("option").filter({ hasText: "belum final" }).click();

    await expect(page.getByTestId("weekly-not-final")).toContainText("belum final");
    await expect(page.getByTestId("weekly-not-final")).toContainText(
      "tersedia setelah penutupan Jumat",
    );
    await expect(picks(page, "sector")).toHaveCount(0);
    await expect(picks(page, "stock")).toHaveCount(0);
    await expect(page.getByTestId("weekly-block-sektor")).toContainText("Belum ada kandidat");
    await expect(page.getByTestId("weekly-week")).toContainText("belum final");
    await expect(page.getByText("Gagal memuat data")).toHaveCount(0);
    // pekan yang dipilih tercatat di URL
    await expect.poll(() => params(page).get("week_end")).not.toBeNull();

    // balik ke pekan final: daftar muncul lagi
    await page.getByRole("combobox", { name: "Pekan" }).click();
    await page.getByRole("option", { name: "pekan 5–9 Okt 2026" }).click();
    await expect(picks(page, "sector")).toHaveCount(3);
    await expect(page.getByTestId("weekly-not-final")).toHaveCount(0);
    expect(params(page).get("week_end")).toBe("2026-10-09");
  });

  test("min_streak & scope di URL ikut dikirim ke API", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/weekly/picks")) calls.push(request.url());
    });
    await page.goto("/weekly");
    await expect(picks(page, "sector")).toHaveCount(3);
    await expect.poll(() => calls.at(-1) ?? "").toContain("min_streak=1");

    await page.getByRole("combobox", { name: "Streak minimal" }).click();
    await page.getByRole("option", { name: "streak ≥ 3" }).click();
    await expect.poll(() => params(page).get("min_streak")).toBe("3");
    await expect.poll(() => calls.at(-1) ?? "").toContain("min_streak=3");
    // fixture: streak tertinggi 2 → tidak ada kandidat, tapi bukan error
    await expect(picks(page, "sector")).toHaveCount(0);
    await expect(page.getByText("Belum ada kandidat").first()).toBeVisible();

    // reload mempertahankan filter
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Streak minimal" })).toContainText("streak ≥ 3");
    expect(params(page).get("min_streak")).toBe("3");

    // streak = 1 (default) tidak ditulis ke URL
    await page.getByRole("combobox", { name: "Streak minimal" }).click();
    await page.getByRole("option", { name: "streak ≥ 1" }).click();
    await expect.poll(() => params(page).get("min_streak")).toBeNull();
    await expect(picks(page, "sector")).toHaveCount(3);

    // lingkup: satu blok saja, param `scope` di URL
    await page.getByRole("button", { name: "Saham saja" }).click();
    await expect.poll(() => params(page).get("scope")).toBe("stock");
    await expect(page.getByTestId("weekly-block-sektor")).toHaveCount(0);
    await expect(picks(page, "stock")).toHaveCount(6);
  });

  test("minggu dari URL (shareable) langsung dipakai di request", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/weekly/picks")) calls.push(request.url());
    });
    await page.goto("/weekly?week_end=2026-10-02");

    await expect.poll(() => calls.at(-1) ?? "").toContain("week_end=2026-10-02");
    await expect(page.getByRole("combobox", { name: "Pekan" })).toContainText(
      "28 Sep 2026–2 Okt 2026",
    );
  });
});
