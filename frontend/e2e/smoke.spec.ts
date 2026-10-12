import { expect, test } from "@playwright/test";

/**
 * Smoke test UI: dev server + MSW (mock), bukan backend nyata.
 *
 * Tiga tes bertanda `fixme` menunggu halaman yang belum ada — jangan diaktifkan
 * sebelum task-nya dikerjakan:
 *   - tabel sektor di `/`   → F5/F6 (SectorTable)
 *   - pill gate di `/status` → F10 (halaman Status belum dibangun)
 *   - drawer sektor         → F5 + F7 (drawer dibuka dari baris tabel)
 */
test.describe("smoke UI (dev server + MSW)", () => {
  test("/ menampilkan shell + judul halaman", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Menu utama" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Data" })).toBeVisible();
  });

  test.fixme("/ menampilkan tabel sektor (aktif saat F5/F6)", async ({ page }) => {
    await page.goto("/");
    const table = page.getByRole("table", { name: /sektor/i });
    await expect(table).toBeVisible();
    await expect(table.locator("tbody tr")).toHaveCount(11);
  });

  test("/data: 6 baris stepper, tombol ke-2 terkunci saat prasyarat belum ada", async ({ page }) => {
    await page.goto("/data");
    const steps = page.locator("ol > li");

    await expect(steps).toHaveCount(6);
    // MSW menjawab: riwayat run kosong (kalau worker mati, halaman menampilkan galat)
    await expect(page.getByText("Belum ada run.")).toBeVisible();

    // `input[type=file]` juga ber-role `button`, jadi tombol langkah 1 dicari lewat namanya
    await expect(steps.nth(0).getByRole("button", { name: "Pilih file & import" })).toBeEnabled();
    await expect(steps.nth(1).getByRole("button", { name: "Jalankan" })).toBeDisabled();
    await expect(steps.nth(1)).toContainText('Jalankan "Import sektor (Excel)" dulu.');
    for (const index of [3, 4, 5]) {
      await expect(steps.nth(index).getByRole("button", { name: "Jalankan" })).toBeDisabled();
      await expect(steps.nth(index)).toContainText('Jalankan "Ambil harga harian" dulu.');
    }
  });

  test("/status terbuka tanpa error walaupun data belum ada", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "Status" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Status" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Status data" })).toBeVisible();
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  });

  test.fixme("/status menampilkan pill gate walau endpoint mengembalikan null (aktif saat F10)", async ({
    page,
  }) => {
    await page.goto("/status");
    await expect(page.getByRole("button", { name: /gate|data/i })).toBeVisible();
  });

  test.fixme("klik baris sektor membuka drawer, Esc menutup & fokus kembali (aktif saat F5+F7)", async ({
    page,
  }) => {
    await page.goto("/");
    const row = page.getByRole("row").nth(1);
    await row.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(row).toBeFocused();
  });
});
