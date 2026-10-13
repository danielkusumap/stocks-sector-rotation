import { expect, test } from "@playwright/test";

/**
 * F13 B/C — kontrol lingkup pindah ke topbar (docs/06 §8) + label periode yang
 * berasal dari `data_status` (bukan dihitung frontend). Dev server + MSW.
 */

test("@slow label periode ikut berubah untuk 4 timeframe (nilainya dari API)", async ({ page }) => {
  await page.goto("/");
  const label = page.getByTestId("periode-label");
  await expect(label).toContainText("Harian · 12 Okt 2026 · jendela 3 bln");
  // rentang jendela datang dari `data_status.window_range_label`
  await expect(label).toContainText("(15 Jul – 12 Okt 2026)");

  await page.getByRole("button", { name: "Mingguan", exact: true }).click();
  await expect(label).toContainText("Mingguan · 12–13 Okt 2026");
  await expect(page).toHaveURL(/timeframe=w1/);

  await page.getByRole("button", { name: "Mingguan (Sen–Jum)" }).click();
  await expect(label).toContainText("Mingguan (Sen–Jum) · 5–9 Okt 2026");
  await expect(page).toHaveURL(/timeframe=w1_fri/);

  await page.getByRole("button", { name: "Tengah Hari" }).click();
  await expect(label).toContainText("Tengah Hari · 13 Okt 2026");
});

test("@slow mengganti Jendela mengubah bagian jendela di label", async ({ page }) => {
  await page.goto("/");
  const label = page.getByTestId("periode-label");
  await page.getByRole("combobox", { name: "Jendela" }).click();
  await page.getByRole("option", { name: "6 bln" }).click();
  await expect(label).toContainText("jendela 6 bln (13 Apr – 12 Okt 2026)");
  await expect(page).toHaveURL(/window=6m/);
});

test("@slow range_label null → 'belum ada data', halaman tetap tampil", async ({ page }) => {
  await page.goto("/?mock=empty");
  await expect(page.getByTestId("periode-label")).toContainText("belum ada data");
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
});

test("@slow kontrol Timeframe/Jendela tidak diduplikasi di FilterBar", async ({ page }) => {
  await page.goto("/");
  // hanya satu grup Timeframe (topbar) dan satu select Jendela (topbar)
  await expect(page.getByRole("group", { name: "Timeframe" })).toHaveCount(1);
  await expect(page.getByRole("combobox", { name: "Jendela" })).toHaveCount(1);
  // pembobotan tetap di FilterBar
  await page.getByRole("button", { name: /^Filter/ }).click();
  await expect(page.getByRole("combobox", { name: "Pembobotan" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Jendela" })).toHaveCount(1);
});

test("@slow chip timeframe tetap bisa dihapus dari FilterBar", async ({ page }) => {
  await page.goto("/?timeframe=w1_fri&window=6m");
  await expect(page.getByTestId("chip-timeframe")).toContainText("Mingguan (Sen–Jum)");
  await page.getByRole("button", { name: /Hapus filter Mingguan/ }).click();
  await expect(page).not.toHaveURL(/timeframe=/);
  await expect(page.getByTestId("periode-label")).toContainText("Harian");
});

test("@slow prasyarat tombol /data dibaca dari DATA, bukan riwayat run", async ({ page }) => {
  // mock: riwayat run kosong, tapi `last_ingest.prices_daily` + universe terisi → tombol aktif
  await page.goto("/data");
  const steps = page.locator("ol > li");
  await expect(steps.nth(0).getByRole("button", { name: "Pilih file & import" })).toBeEnabled();
  for (const index of [1, 2, 3, 4, 5, 6]) {
    await expect(steps.nth(index).getByRole("button", { name: "Jalankan" })).toBeEnabled();
  }
  // chip status tetap dari riwayat run
  await expect(steps.nth(3)).toContainText("belum pernah");

  // universe & harga kosong → semua terkunci dengan alasan
  await page.goto("/data?mock=empty");
  const locked = page.locator("ol > li");
  await expect(locked.nth(1).getByRole("button", { name: "Jalankan" })).toBeDisabled();
  await expect(locked.nth(1)).toContainText('Jalankan "Import sektor (Excel)" dulu.');
  for (const index of [3, 4, 5, 6]) {
    await expect(locked.nth(index).getByRole("button", { name: "Jalankan" })).toBeDisabled();
    await expect(locked.nth(index)).toContainText('Jalankan "Ambil harga harian" dulu.');
  }
});

test("@slow impor file yang sama dua kali → 409, tombol 2 tetap aktif", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/data");
  const file = {
    name: "saham_sektoral.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("xlsx-mock"),
  };
  await page.locator('input[type="file"]').setInputFiles(file);
  const second = page.locator("ol > li").nth(0);
  await expect(second).toContainText("terakhir sebagian berhasil", { timeout: 30_000 });

  // impor ulang: backend menolak (docs/07 §6 no.6) — pesannya bahasa manusia, tombol tetap hidup
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByText(/sudah pernah diimpor/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Jalankan" }).nth(0)).toBeEnabled();
});
