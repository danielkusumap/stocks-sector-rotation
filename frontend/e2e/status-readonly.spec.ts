import { expect, test, type Page } from "@playwright/test";

/**
 * F10 — `/status` baca-saja di dev server + MSW (bukan backend nyata).
 * Gate kesegaran, waktu bar per probe, config aktif, dan riwayat run yang sama dengan `/data`.
 */

const panel = (page: Page, title: string) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });

test("@slow gate ok: pill, syarat, waktu bar per probe, dan config aktif", async ({ page }) => {
  await page.goto("/status?mock=ok");

  const gate = panel(page, "Gate tengah hari");
  await expect(gate).toContainText("ok");
  await expect(gate).toContainText("Bar terakhir 13 Okt 2026 11:42 · syarat bar ≥ 11:30 WIB");
  await expect(gate).toContainText("Ingest harga harian: ok · data terakhir 12 Okt 2026 16:10");

  const probes = gate.getByRole("table", { name: "Waktu bar terakhir per ticker probe" });
  await expect(probes.getByRole("row")).toHaveCount(6); // header + 5 probe
  await expect(probes.getByRole("row").nth(1)).toContainText("BBCA");
  await expect(probes.getByRole("row").nth(1)).toContainText("13 Okt 2026 11:42");

  const config = panel(page, "Konfigurasi aktif");
  await expect(config).toContainText("Turnover minimum (Rp)");
  await expect(config).toContainText("1,0 M");
  await expect(config).toContainText("Minimum titik RRG");
  await expect(config).toContainText("d1 60 · w1 30 · w1_fri 30 · midday 60");
  await expect(config).toContainText("Harga harian terakhir");
  await expect(config).toContainText("12 Okt 2026 16:31");

  // baca-saja: tombol pipeline tidak diduplikasi dari /data (cukup tautan)
  await expect(page.getByRole("button", { name: "Jalankan" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Pilih file/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Buka halaman Data" }).click();
  await expect(page).toHaveURL(/\/data$/);
});

test("@slow gate stale: kalimat tindakan, bukan hanya warna", async ({ page }) => {
  await page.goto("/status?mock=stale");

  const gate = panel(page, "Gate tengah hari");
  await expect(gate).toContainText("stale");
  await expect(gate).toContainText(
    "Data Yahoo belum sampai 11:30 WIB (bar terakhir 11:05 WIB), coba lagi nanti.",
  );
  await expect(gate.getByRole("row").nth(1)).toContainText("13 Okt 2026 11:05");
});

test("@slow riwayat kosong: halaman tetap tampil tanpa error", async ({ page }) => {
  await page.goto("/status");
  const history = panel(page, "Riwayat run");
  await expect(history).toContainText("Belum ada run.");
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
});

test("@slow riwayat run sama di /data dan /status; klik baris membuka detail", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/data");

  // Jalankan langkah 1 dari UI (mock menyelesaikan run ±6 s) supaya riwayat berisi satu baris
  await page.locator('input[type="file"]').setInputFiles({
    name: "saham_sektoral.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("xlsx-mock"),
  });

  const dataHistory = panel(page, "Riwayat run");
  await expect(dataHistory.getByRole("table", { name: /Riwayat 20 run/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(dataHistory.getByRole("row")).toHaveCount(2); // header + 1 run
  await expect(dataHistory).toContainText("Import sektor (Excel)");

  // ke /status lewat sidebar (navigasi SPA: keadaan mock bertahan)
  await page.getByRole("link", { name: "Status", exact: true }).click();
  const statusHistory = panel(page, "Riwayat run");
  await expect(statusHistory).toContainText("Import sektor (Excel)");
  await expect(statusHistory).toContainText("sebagian berhasil");

  // AC F10: klik baris → params_json, result_json, failed_tickers
  await statusHistory.getByRole("row").nth(1).click();
  await expect(statusHistory).toContainText("run #1");
  await expect(statusHistory).toContainText("kind: import_excel");
  await expect(statusHistory).toContainText("rows_total: 962");
  await expect(statusHistory).toContainText('"inserted": 950');
});
