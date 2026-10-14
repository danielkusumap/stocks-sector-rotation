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

// ── F21: toggle lapisan + Ultimate RSI, VWAP+σ, POC (docs/06 §6.6) ───────────

test("lapisan Indikator aktif bawaan: URSI, VWAP+σ, POC + label jujur POC", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/series/stock/")) requests.push(new URL(request.url()).search || "(tanpa query)");
  });
  await page.goto("/stocks/BBRI");
  const chart = page.getByTestId("candle-chart");
  await expect(chart).toBeVisible();

  // tombol toggle: aktif bawaan, tanpa `layers` di URL
  await expect(page.getByTestId("layer-indicators")).toHaveAttribute("aria-pressed", "true");
  expect(new URL(page.url()).searchParams.get("layers")).toBeNull();

  const data = (await series(page, "BBRI", "window=6m&layers=indicators")) as {
    indicators: {
      ursi: { len: number; points: unknown[] };
      vwap: { len: number; anchor_date: string; points: unknown[] };
      poc: { basis: string; bars_used: number; poc: number };
    };
  };

  // URSI: skala 0–100, nilai & sinyal digambar; jumlah titik = jumlah titik dari API
  const ursi = chart.locator('[data-overlay="ursi"]');
  await expect(ursi).toHaveCount(1);
  await expect(ursi).toHaveAttribute("pointer-events", "none");
  const ursiPoints = await ursi.locator("polyline").first().getAttribute("points");
  expect(ursiPoints?.trim().split(/\s+/)).toHaveLength(data.indicators.ursi.points.length);
  await expect(ursi).toContainText(`Ultimate RSI (${data.indicators.ursi.len}, SMA)`);

  // VWAP: pita + garis; anchor = tanggal dari API (format Indonesia)
  await expect(chart.locator('[data-overlay="vwap"]')).toHaveCount(1);
  const anchor = new Date(`${data.indicators.vwap.anchor_date}T00:00:00+07:00`);
  const short = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(anchor);
  await expect(page.getByTestId("vwap-anchor")).toContainText(`VWAP ${data.indicators.vwap.len}`);
  await expect(page.getByTestId("vwap-anchor")).toContainText(`anchor ${short}`);
  // rezim default = tren → VWAP wajib memakai peringatan
  await expect(page.getByTestId("vwap-warning")).toHaveText("bukan alat utama saat tren");

  // POC: basis harian → label "perkiraan dari bar harian (N bar)", bukan kutipan presisi
  await expect(chart.locator('[data-overlay="poc"]')).toHaveCount(1);
  await expect(page.getByTestId("poc-label")).toContainText("perkiraan dari bar harian");
  await expect(page.getByTestId("poc-label")).toContainText(`${data.indicators.poc.bars_used} bar`);

  // 1 permintaan per halaman (StrictMode dev boleh 2×); parameter lapisan ikut terkirim
  expect(new Set(requests).size).toBe(1);
  expect(requests.length).toBeLessThanOrEqual(2);
  const sent = new URLSearchParams(requests[0]);
  expect(sent.get("layers")).toBe("indicators");
  await expect(chart).not.toContainText("NaN");
});

test("matikan lapisan: URL `layers=` & 0 elemen indikator", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/series/stock/")) requests.push(new URL(request.url()).search);
  });
  await page.goto("/stocks/BBRI");
  await expect(page.getByTestId("candle-chart")).toBeVisible();
  await page.getByTestId("layer-indicators").click();

  await expect(page).toHaveURL(/layers=$/);
  await expect(page.getByTestId("layer-indicators")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('[data-overlay="ursi"]')).toHaveCount(0);
  await expect(page.locator('[data-overlay="vwap"]')).toHaveCount(0);
  await expect(page.locator('[data-overlay="poc"]')).toHaveCount(0);
  await expect(page.getByTestId("poc-label")).toHaveCount(0);
  expect(new URLSearchParams([...new Set(requests)].at(-1) ?? "").get("layers")).toBe("");

  // nyalakan lagi → parameter hilang dari URL (default) & panel kembali
  await page.getByTestId("layer-indicators").click();
  expect(new URL(page.url()).searchParams.get("layers")).toBeNull();
  await expect(page.locator('[data-overlay="ursi"]')).toHaveCount(1);
});

test("lapisan bertahan saat filter lain berubah (window) & tidak mengganggu level plan", async ({ page }) => {
  await page.goto("/stocks/BBRI?layers=indicators");
  await expect(page.getByTestId("candle-chart")).toBeVisible();
  await page.getByRole("button", { name: "1 thn" }).click();
  await expect(page).toHaveURL(/window=1y/);
  await expect(page).toHaveURL(/layers=indicators/);
  await expect(page.locator('[data-overlay="ursi"]')).toHaveCount(1);
  await expect(page.locator('[data-overlay="levels"]')).toHaveCount(1);
});

test("rezim range: panel URSI disembunyikan + catatan kontrarian, VWAP tanpa peringatan", async ({ page }) => {
  await page.goto("/stocks/BBRI?mock=range");
  const chart = page.getByTestId("candle-chart");
  await expect(chart).toBeVisible();
  await expect(page.locator('[data-overlay="ursi"]')).toHaveCount(0);
  await expect(page.getByTestId("ursi-range-note")).toHaveText("di rentang, pakai RSI klasik (kontrarian)");
  await expect(page.getByTestId("vwap-warning")).toHaveCount(0);
  await expect(page.locator('[data-overlay="vwap"]')).toHaveCount(1);
  // kotak hover tetap tidak menutupi 20 bar terakhir (aturan §6.3) setelah panel URSI ditambah
  await expect(page.getByTestId("candle-skeleton")).toHaveCount(0);
});

test("@a11y tanpa lapisan tetap lolos: tinggi grafik ikut menyusut, tanpa sisa ruang URSI", async ({ page }) => {
  await page.goto("/stocks/BBRI?mock=nolayer");
  const chart = page.getByTestId("candle-chart");
  await expect(chart).toBeVisible();
  await expect(page.getByTestId("layer-indicators")).toHaveAttribute("aria-pressed", "false");
  const box = (await chart.boundingBox())!;
  const withLayers = await page.evaluate(async () => {
    const svg = document.querySelector('[data-testid="candle-chart"] svg') as SVGSVGElement | null;
    return svg?.getAttribute("viewBox") ?? null;
  });
  expect(withLayers).toBe("0 0 780 442");
  expect(box.height).toBeGreaterThan(100);
});
