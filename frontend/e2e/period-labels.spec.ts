import { expect, test } from "@playwright/test";

/**
 * F13b — label periode di header panel (docs/08 F13 C11) + tombol "Segarkan tampilan" di `/data`.
 * Dev server + MSW; angka periode selalu dari API (`data_status`), tidak dihitung frontend.
 */

test("header panel RRG & tabel sektor memuat periode yang dipakai", async ({ page }) => {
  await page.goto("/?timeframe=w1_fri&window=6m");

  const notes = page.getByTestId("periode-note");
  await expect(notes).toHaveCount(2); // panel RRG + panel Sektor
  await expect(notes.first()).toContainText("Mingguan (Sen–Jum) · 5–9 Okt 2026 · jendela 6 bln");
  // teksnya identik dengan label di topbar (satu sumber: lib/period.ts)
  const label = await page.getByTestId("periode-label").innerText();
  expect(await notes.first().innerText()).toBe(label);
});

test("/data: 'Segarkan tampilan' + tooltip jelas + periode run terakhir dari params/result", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/data");

  // tombol lama "Muat ulang data" diganti supaya tidak disangka menjalankan pipeline
  await expect(page.getByRole("button", { name: "Segarkan tampilan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Muat ulang data" })).toHaveCount(0);

  await page.getByRole("button", { name: "Segarkan tampilan" }).focus();
  // hint langkah 8 (docs/05 §4.1) juga memuat kalimat ini → cek tooltip-nya lewat role
  await expect(
    page.getByRole("tooltip", {
      name: "Ambil ulang data dari server — tidak menjalankan pipeline, tidak menarik harga baru.",
    }),
  ).toBeVisible();

  await expect(page.getByTestId("run-period")).toContainText("belum ada run");

  // jalankan langkah 1 → periode run terakhir dibaca dari params_json/result_json run itu
  await page.locator('input[type="file"]').setInputFiles({
    name: "saham_sektoral.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("xlsx-mock"),
  });
  await expect(page.getByTestId("run-period")).toContainText("tidak terikat periode (daftar emiten)", {
    timeout: 30_000,
  });
});
