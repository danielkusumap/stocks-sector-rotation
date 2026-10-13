import { expect, test } from "@playwright/test";

/**
 * Smoke test UI: dev server + MSW (mock), bukan backend nyata.
 *
 * Tiga tes dulu bertanda `fixme` (menunggu F5/F6, F7, F10) kini aktif — halamannya sudah ada;
 * cakupan mendalamnya tetap di `sector-table.spec.ts`, `sector-drawer.spec.ts`, dan
 * `status-readonly.spec.ts`.
 */
test.describe("smoke UI (dev server + MSW)", () => {
  test("/ menampilkan shell + judul halaman", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Menu utama" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Data" })).toBeVisible();
  });

  test("/ menampilkan tabel sektor (aktif saat F5/F6)", async ({ page }) => {
    await page.goto("/");
    // nama tabel lain di halaman ini juga memuat kata "sektor" (peta panas) → pakai caption persis
    const table = page.getByRole("table", { name: /^Sektor: kuadran/ });
    await expect(table).toBeVisible();
    await expect(table.locator("tbody tr")).toHaveCount(11);
  });

  test("/data: 6 baris stepper; prasyarat tombol dari data (universe & last_ingest)", async ({ page }) => {
    await page.goto("/data");
    const steps = page.locator("ol > li");

    await expect(steps).toHaveCount(6);
    // MSW menjawab: riwayat run kosong, tapi universe + harga harian ADA → tombol aktif
    // (docs/08 F13 A: prasyarat dari data, bukan dari riwayat run)
    await expect(page.getByText("Belum ada run.")).toBeVisible();
    await expect(steps.nth(3)).toContainText("belum pernah");

    // `input[type=file]` juga ber-role `button`, jadi tombol langkah 1 dicari lewat namanya
    await expect(steps.nth(0).getByRole("button", { name: "Pilih file & import" })).toBeEnabled();
    for (const index of [1, 2, 3, 4, 5]) {
      await expect(steps.nth(index).getByRole("button", { name: "Jalankan" })).toBeEnabled();
    }

    // data kosong → semua tombol (kecuali 1) terkunci dengan alasan yang bisa dibaca
    await page.goto("/data?mock=empty");
    const locked = page.locator("ol > li");
    await expect(locked.nth(1).getByRole("button", { name: "Jalankan" })).toBeDisabled();
    await expect(locked.nth(1)).toContainText('Jalankan "Import sektor (Excel)" dulu.');
    for (const index of [3, 4, 5]) {
      await expect(locked.nth(index).getByRole("button", { name: "Jalankan" })).toBeDisabled();
      await expect(locked.nth(index)).toContainText('Jalankan "Ambil harga harian" dulu.');
    }
  });

  test("/status terbuka tanpa error walaupun data belum ada", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "Status" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Status" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Status data" })).toBeVisible();
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  });

  test("/status menampilkan pill gate walau data minim (aktif saat F10)", async ({ page }) => {
    await page.goto("/status");
    const gate = page.locator("section").filter({ hasText: "Gate tengah hari" });
    await expect(gate).toContainText(/ok|stale/); // pill gate, bukan hanya warna
    await expect(page.getByRole("link", { name: "Buka halaman Data" })).toBeVisible();
  });

  test("klik baris sektor membuka drawer, Esc menutup & halaman tetap utuh (aktif saat F5+F7)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("sector-row-IDXFINANCE").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // kembali ke tabel utuh (fokus kembali ke baris diuji khusus di sector-drawer.spec.ts)
    await expect(page.locator("[data-testid^=sector-row-]")).toHaveCount(11);
    expect(new URL(page.url()).searchParams.get("sector")).toBeNull();
  });
});
