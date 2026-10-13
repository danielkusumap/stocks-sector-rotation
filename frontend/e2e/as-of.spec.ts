import { expect, test, type Page } from "@playwright/test";

/**
 * F5 — AsOfPicker (docs/06 §5 + docs/05 §1 `meta/dates`).
 * Bukti inti: hari tanpa data dinonaktifkan **dan tidak mengirim request apa pun**.
 */
const params = (page: Page) => new URLSearchParams(new URL(page.url()).search);

test.describe("AsOfPicker", () => {
  test("hari tanpa data (libur/akhir pekan) nonaktif dan tidak mengirim request", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/v1/sectors/summary")) calls.push(request.url());
    });

    await page.goto("/");
    // dev server bisa masih dingin (kompilasi modul pertama) setelah topbar dapat kontrol baru
    await expect(page.getByTestId("sector-row-IDXFINANCE")).toBeVisible({ timeout: 20_000 });
    const before = calls.length;

    await page.getByTestId("asof-trigger").click();
    await expect(page.getByTestId("asof-month")).toHaveText("Oktober 2026");

    // 5 Okt = libur buatan di mock; 3–4 & 10–11 Okt = akhir pekan
    for (const iso of ["2026-10-05", "2026-10-04", "2026-10-10"]) {
      const cell = page.getByTestId(`asof-day-${iso}`);
      await expect(cell).toBeDisabled();
      await expect(cell).toHaveAttribute("data-available", "false");
    }
    await expect(page.getByTestId("asof-day-2026-10-09")).toBeEnabled();
    await expect(page.getByTestId("asof-day-2026-10-09")).toHaveAttribute("data-available", "true");

    // klik paksa di sel nonaktif: tombol disabled tidak menembakkan handler → tanpa request
    await page.getByTestId("asof-day-2026-10-05").click({ force: true });
    await page.waitForTimeout(400);
    expect(calls.length).toBe(before);
    expect(params(page).get("as_of")).toBeNull();
  });

  test("memilih tanggal yang ada datanya menulis as_of ke URL + mengirim request", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/v1/sectors/summary")) calls.push(request.url());
    });

    await page.goto("/");
    // dev server bisa masih dingin (kompilasi modul pertama) setelah topbar dapat kontrol baru
    await expect(page.getByTestId("sector-row-IDXFINANCE")).toBeVisible({ timeout: 20_000 });
    const before = calls.length;

    await page.getByTestId("asof-trigger").click();
    await page.getByTestId("asof-day-2026-10-09").click();

    await expect.poll(() => params(page).get("as_of")).toBe("2026-10-09");
    await expect.poll(() => calls.length).toBeGreaterThan(before);
    expect(calls.at(-1)).toContain("as_of=2026-10-09");
    await expect(page.getByTestId("chip-as_of")).toContainText("per 2026-10-09");
    await expect(page.getByTestId("asof-trigger")).toContainText("as of 9 Okt 2026");

    // "Pakai terbaru" melepas pilihan
    await page.getByTestId("asof-trigger").click();
    await page.getByTestId("asof-latest").click();
    await expect.poll(() => params(page).get("as_of")).toBeNull();
  });

  test("daftar tanggal kosong → input tanggal biasa, user tidak diblokir", async ({ page }) => {
    await page.goto("/?mock=empty");

    // picker jatuh ke <input type="date">; tabel tetap jalan (bukan error)
    await expect(page.getByTestId("asof-trigger")).toHaveCount(0);
    await expect(page.getByLabel("Tanggal acuan")).toBeVisible();
    await expect(page.getByTestId("sector-row-IDXFINANCE")).toBeVisible();

    await page.getByLabel("Tanggal acuan").fill("2026-10-09");
    await expect.poll(() => params(page).get("as_of")).toBe("2026-10-09");
  });

  test("pindah bulan menampilkan hari kerja bulan itu", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("asof-trigger").click();
    await page.getByRole("button", { name: "Bulan sebelumnya" }).click();
    await expect(page.getByTestId("asof-month")).toHaveText("September 2026");
    await expect(page.getByTestId("asof-day-2026-09-30")).toBeEnabled();
    await expect(page.getByTestId("asof-day-2026-09-26")).toBeDisabled(); // Sabtu
  });
});
