import { expect, test, type Page } from "@playwright/test";

/**
 * F19 — grafik candle + overlay TA di halaman detail saham (docs/06 §6.5).
 * Angka overlay/level/event dari `GET /series/stock/{ticker}`; MSW = backend.
 * Uji silang lewat `page.evaluate(fetch)` (page.request tidak lewat MSW).
 */

test.use({ actionTimeout: 8_000, navigationTimeout: 20_000 });

async function series(page: Page, ticker: string, query = "window=6m") {
  return page.evaluate(
    async ({ t, q }) => (await fetch(`/api/v1/series/stock/${t}?${q}`)).json(),
    { t: ticker, q: query },
  );
}

test("candle + level plan: jumlah bar dari API, warna naik/turun, level identik respons", async ({ page }) => {
  await page.goto("/stocks/BBRI");
  const chart = page.getByTestId("candle-chart");
  await expect(chart).toBeVisible();

  const data = (await series(page, "BBRI")) as {
    candles: { date: string; open: number; close: number }[];
    levels: { stop: number; tp1: number; tp2: number } | null;
  };
  await expect(chart.locator("[data-candle]")).toHaveCount(data.candles.length);
  const last = data.candles.at(-1)!;
  const lastBar = chart.locator("[data-candle]").last();
  await expect(lastBar).toHaveAttribute("data-candle", last.close >= last.open ? "up" : "down");

  // level plan digambar & angkanya dari respons
  const nf = (v: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(v);
  await expect(chart.locator('[data-level="SL"]')).toContainText(`SL ${nf(data.levels!.stop)}`);
  await expect(chart.locator('[data-level="TP2"]')).toContainText(`TP2 ${nf(data.levels!.tp2)}`);
  await expect(chart.locator('[data-overlay="levels"]')).toHaveCount(1);

  // label jujur + tidak ada angka rusak
  await expect(chart).toContainText("harga penyesuaian");
  await expect(chart).not.toContainText("NaN");
  await expect(chart).not.toContainText("undefined");

  // regresi F17: panel TA & sparkline tetap ada
  await expect(page.getByTestId("ta-panel-BBRI")).toBeVisible();
  await expect(page.getByTestId("sparkline")).toBeVisible();
});

test("saham tanpa pick mingguan → tanpa garis level (bukan garis nol)", async ({ page }) => {
  await page.goto("/stocks/TLKM");
  const chart = page.getByTestId("candle-chart");
  await expect(chart).toBeVisible();
  const data = (await series(page, "TLKM")) as { levels: unknown };
  expect(data.levels).toBeNull();
  await expect(chart.locator('[data-overlay="levels"]')).toHaveCount(0);
  await expect(chart.locator("[data-candle]")).not.toHaveCount(0);
});

test("overlay mengikuti rezim: kanal S/R hanya di range, legenda menjelaskan alasannya", async ({ page }) => {
  // tren naik (default): kanal tidak digambar walau backend mengirim `channels`
  await page.goto("/stocks/BBRI");
  const chart = page.getByTestId("candle-chart");
  await expect(chart).toBeVisible();
  const data = (await series(page, "BBRI")) as { regime: string; overlays: { channels: unknown[] } };
  expect(data.regime).toBe("tren_naik");
  expect(data.overlays.channels.length).toBe(0);
  await expect(chart.locator('[data-overlay="channel"]')).toHaveCount(0);

  // rezim range → kanal tampil
  await page.goto("/stocks/BBRI?mock=range");
  const rangeChart = page.getByTestId("candle-chart");
  await expect(rangeChart).toBeVisible();
  const rangeData = (await series(page, "BBRI", "window=6m&mock=range")) as {
    regime: string;
    overlays: { channels: unknown[] };
    regime_reason: string;
  };
  expect(rangeData.regime).toBe("range");
  expect(rangeData.overlays.channels.length).toBeGreaterThan(0);
  await expect(rangeChart.locator('[data-overlay="channel"]')).toHaveCount(rangeData.overlays.channels.length);
  await expect(page.getByTestId("candle-legend")).toContainText(rangeData.regime_reason);
});

test("penanda event: satu per event, klik menampilkan hasil", async ({ page }) => {
  await page.goto("/stocks/BBRI");
  const chart = page.getByTestId("candle-chart");
  await expect(chart).toBeVisible();
  const data = (await series(page, "BBRI")) as { events: { result: string }[] };
  await expect(chart.locator("[data-event-result]")).toHaveCount(data.events.length);
  await chart.locator("[data-event-result]").first().click();
  const line = page.getByTestId("candle-event-line");
  await expect(line).toBeVisible();
  const first = data.events[0].result;
  const expected =
    first === "open" ? "belum selesai" : first === "expired" ? "lewat batas waktu" : first === "win" ? "+5% dulu" : "−5% dulu";
  await expect(line).toContainText(expected);
});

test("candles kosong → EmptyState, bukan grafik/NaN", async ({ page }) => {
  await page.goto("/stocks/BBRI?mock=nocandle");
  await expect(page.getByText("belum ada bar harga untuk saham ini")).toBeVisible();
  await expect(page.getByTestId("candle-chart")).toHaveCount(0);
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
});

test("hover: kotak angka O/H/L/C + volume, tidak menutupi 20 bar terakhir", async ({ page }) => {
  await page.goto("/stocks/BBRI");
  const chart = page.getByTestId("candle-chart");
  await expect(chart).toBeVisible();
  const svg = chart.locator("svg");
  const box = await svg.boundingBox();
  // hover di bar terakhir (paling kanan, sisakan ruang label kanan)
  await page.mouse.move(box!.x + box!.width * 0.92, box!.y + box!.height * 0.3);
  const hover = page.getByTestId("candle-hover");
  await expect(hover).toBeVisible();
  await expect(hover).toContainText("O ");
  await expect(hover).toContainText("Vol ");

  // aturan §6.3: saat hover di 20 bar terakhir, kotak harus berada DI KIRI garis bidik
  const data = (await series(page, "BBRI")) as { candles: unknown[] };
  const count = data.candles.length;
  const xAtBar = (index: number) => box!.x + (box!.width * (index + 0.5)) / count;
  const boxRect = (await hover.boundingBox())!;
  const twentyFromEnd = xAtBar(count - 20);
  expect(boxRect.x + boxRect.width).toBeLessThanOrEqual(twentyFromEnd + 2);
});

test("satu permintaan /series/stock per halaman", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/series/")) calls.push(new URL(request.url()).pathname);
  });
  await page.goto("/stocks/BBRI");
  await expect(page.getByTestId("candle-chart")).toBeVisible();
  const unique = [...new Set(calls)];
  expect(unique).toEqual(["/api/v1/series/stock/BBRI"]);
  expect(calls.length).toBeLessThanOrEqual(2); // dev StrictMode memanggil 2×
});

test("tinggi panel sama sebelum & sesudah data datang (tanpa CLS)", async ({ page }) => {
  await page.route("**/api/v1/series/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  await page.goto("/stocks/BBRI");
  const skeleton = page.locator('[data-testid="candle-skeleton"]');
  const before = await skeleton.boundingBox();
  await expect(page.getByTestId("candle-chart")).toBeVisible();
  const after = await page.getByTestId("candle-chart").boundingBox();
  expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThan(4);
});
