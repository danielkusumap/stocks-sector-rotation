import { expect, test, type Page } from "@playwright/test";

/**
 * F17 — panel analisa teknikal (drawer sektor + halaman saham), kolom insight di tabel,
 * dan tombol 7 di `/data`. Semua angka dari API (`/ta/*`); mock MSW = backend.
 */

/** Format yang sama dengan `lib/format.ts` (koma desimal) tanpa mengimpor kode aplikasi. */
const pct1 = (value: number) =>
  `${new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value * 100)}%`;

/** Baca `/ta/summary` dari dalam halaman supaya lewat MSW (service worker), bukan network langsung. */
async function taSummary(page: Page, scope: "sector" | "stock") {
  return page.evaluate(async (s) => {
    const res = await fetch(`/api/v1/ta/summary?scope=${s}&limit=500`);
    return res.json();
  }, scope);
}

test("@slow panel TA di drawer sektor: 4 angka, baris terakhir breakout, perbandingan filter, tabel event, cakupan", async ({
  page,
}) => {
  await page.goto("/sectors?sector=IDXFINANCE");
  const panel = page.getByTestId("ta-panel-IDXFINANCE");
  await expect(panel).toBeVisible();

  // kontrol: segmented MA + toggle filter tren MA50 (default dari /meta/config → ta)
  await expect(panel.getByRole("group", { name: "Periode MA" })).toBeVisible();
  await expect(panel.getByLabel("filter tren MA50")).toBeChecked();

  // empat angka besar
  await expect(panel).toContainText("+5% dulu");
  await expect(panel).toContainText("40,0%");
  await expect(panel).toContainText("Median periode ke +5%");
  await expect(panel).toContainText("10 periode");
  await expect(panel).toContainText("Median periode ke −5%");
  await expect(panel).toContainText("6 periode");
  // `expired`/`open` bukan kekalahan dan jumlahnya terlihat
  await expect(panel).toContainText("2 lewat batas · 0 belum selesai (bukan kekalahan)");

  // baris "terakhir breakout": tanggal → entry, harga penyesuaian, umur, gain, status
  const latest = page.getByTestId("ta-latest");
  await expect(latest).toContainText("Terakhir breakout");
  await expect(latest).toContainText("harga penyesuaian");
  await expect(latest).toContainText("9 periode sejak entry");
  await expect(latest).toContainText("lewat batas");

  // perbandingan filter dari SATU respons (filter_on/filter_off)
  await expect(page.getByTestId("ta-filter-compare")).toHaveText(
    "dengan filter tren: 40,0% (7 event) · tanpa filter: 80,0% (6 event)",
  );

  // tabel event terakhir (maks 20 dari backend)
  await expect(panel.getByRole("table", { name: /Event analisa teknikal IDXFINANCE/ })).toBeVisible();
  expect(await panel.locator("tbody tr").count()).toBeGreaterThan(4);

  // catatan cakupan wajib
  await expect(page.getByTestId("ta-coverage")).toContainText(
    "angka dari 11 sektor; 0 sektor dilewati karena riwayat kurang dari 60 bar",
  );
  await expect(page.getByTestId("ta-coverage")).toContainText("data 14 Okt 2024 – 13 Okt 2026 · harga penyesuaian");
});

test("@slow ganti MA & toggle filter tren → panel berubah tanpa reload, state bertahan selama drawer terbuka", async ({
  page,
}) => {
  await page.goto("/sectors?sector=IDXFINANCE");
  const panel = page.getByTestId("ta-panel-IDXFINANCE");
  await expect(panel).toContainText("40,0%"); // MA20 (default config) + filter tren aktif

  await panel.getByRole("button", { name: "MA50" }).click();
  await expect(panel).toContainText("85,7%");
  await expect(panel).toContainText("MA50 · ");

  await panel.getByLabel("filter tren MA50").uncheck();
  await expect(panel).toContainText("28,6%");
  // tanpa reload: drawer tetap terbuka & URL tidak berubah
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/sector=IDXFINANCE/);
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
});

test("@slow uji silang: angka panel = /ta/summary = sel kolom tabel (3 ticker)", async ({ page }) => {
  for (const ticker of ["BBRI", "BBCA", "TLKM"]) {
    // 1) angka backend (default MA & filter dari config) — tunggu tabel dulu supaya MSW aktif
    await page.goto("/stocks");
    await expect(page.getByTestId(`ta-win-${ticker}`)).toBeVisible();
    const summary = (await taSummary(page, "stock")) as {
      items: { ref_id: string; win_rate: number | null; median_periods_win: number | null }[];
    };
    const row = summary.items.find((item) => item.ref_id === ticker);
    expect(row, `${ticker} ada di /ta/summary`).toBeTruthy();

    // 2) sel kolom insight di tabel
    const cell = page.getByTestId(`ta-win-${ticker}`);
    await expect(cell).toHaveText(pct1(row!.win_rate as number));
    await expect(page.getByTestId(`ta-breakout-${ticker}`)).toContainText("periode");

    // 3) panel detail di halaman saham → angka sama dengan kolom & backend
    await page.goto(`/stocks/${ticker}`);
    const panel = page.getByTestId(`ta-panel-${ticker}`);
    await expect(panel).toContainText(pct1(row!.win_rate as number));
    await expect(panel).toContainText(`${row!.median_periods_win} periode`);
  }
});

test("@slow kolom insight = satu permintaan /ta/summary per halaman, bukan per baris", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/ta/")) calls.push(new URL(request.url()).pathname + new URL(request.url()).search);
  });

  await page.goto("/");
  await expect(page.getByTestId("ta-win-IDXFINANCE")).toBeVisible();
  const tablesCalls = [...calls];
  // StrictMode dev memanggil dua kali query yang sama → hitung URL unik
  expect([...new Set(tablesCalls)].length).toBe(1);
  expect(tablesCalls.length).toBeLessThanOrEqual(2);
  expect(tablesCalls[0]).toContain("/api/v1/ta/summary?scope=sector");

  // jumlah permintaan tidak tumbuh walau baris berkurang (bukan per baris)
  calls.length = 0;
  await page.goto("/sectors?quadrant=leading");
  await expect(page.getByTestId("ta-win-IDXFINANCE")).toBeVisible();
  expect([...new Set(calls)].length).toBe(1);

  // halaman saham: satu permintaan lagi, dan tidak ada permintaan detail per baris
  calls.length = 0;
  await page.goto("/stocks");
  await expect(page.getByTestId("ta-win-BBRI")).toBeVisible();
  expect([...new Set(calls)]).toEqual(["/api/v1/ta/summary?scope=stock&limit=500"]);
});

test("@slow entitas tanpa event: EmptyState + angka `—` (bukan `0%`), halaman tetap jalan", async ({ page }) => {
  // ANTM ada di fixture tanpa satu pun event backtest → kasus "belum ada breakout"
  await page.goto("/stocks/ANTM");
  const panel = page.getByTestId("ta-panel-ANTM");
  await expect(panel).toContainText("belum ada breakout pada periode MA ini");
  await expect(panel).toContainText("—"); // angka kosong, bukan 0%
  await expect(panel).not.toContainText("0,0%");
  await expect(panel).toContainText("Jumlah event");
  // kolom insight di tabel juga `—` (bukan 0%) untuk entitas tanpa event
  await page.goto("/stocks");
  await expect(page.getByTestId("ta-win-ANTM")).toHaveText("—");
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
});

test("@slow /data: tombol 7 hitung analisa teknikal — terkunci, jalan, selesai dengan ringkasan hasil", async ({
  page,
}) => {
  test.setTimeout(120_000);

  // prasyarat harga harian kosong → tombol 7 disabled + alasan tertulis
  await page.goto("/data?mock=empty");
  const step7 = page.locator("ol > li").nth(6);
  await expect(step7).toContainText("Hitung analisa teknikal (MA & backtest)");
  await expect(step7).toContainText('Jalankan "Ambil harga harian" dulu.');
  await expect(step7.getByRole("button", { name: "Jalankan" })).toBeDisabled();

  // normal: 8 langkah, tombol 7 aktif, tombol 8 = refresh tampilan (tanpa chip status)
  await page.goto("/data");
  const steps = page.locator("ol > li");
  await expect(steps).toHaveCount(8);
  await expect(steps.nth(7)).toContainText("Refresh data tampilan");
  await expect(steps.nth(7).getByRole("button", { name: "Segarkan tampilan" })).toBeEnabled();
  await expect(steps.nth(7)).not.toContainText("belum pernah");
  const btn7 = step7Of(page).getByRole("button", { name: "Jalankan" });
  await expect(btn7).toBeEnabled();

  // jalankan → progres → selesai dengan chip status + ringkasan result_json
  await btn7.click();
  // run berjalan di latar belakang (docs/05 §4.3) → chip & ringkasan hasil muncul setelah final
  await expect(step7Of(page)).toContainText("terakhir ok", { timeout: 60_000 });
  await expect(step7Of(page).getByTestId("ta-result")).toContainText(
    "Hasil: 8.421 event dari 916 emiten · menang 58,0% · MA 10/20/50",
  );

  // riwayat run mengenali kind `compute_ta` (satu baris angka, bukan cuma JSON)
  const history = page.getByRole("table", { name: /Riwayat 20 run terakhir/ });
  await expect(history).toContainText("Hitung analisa teknikal (MA & backtest)");
  await history.getByRole("button", { name: "Detail" }).first().click();
  await expect(page.getByTestId(/run-ta-\d+/)).toContainText("analisa teknikal: 8.421 event · 916 emiten");
});

const step7Of = (page: Page) => page.locator("ol > li").nth(6);
