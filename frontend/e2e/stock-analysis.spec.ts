import { expect, test, type Page } from "@playwright/test";

/**
 * F20 — panel "Analisa teknikal" di halaman detail saham untuk SEMUA emiten
 * (`docs/06` §5.3, sumber `GET /plan/stock/{ticker}`). Angka dari API; MSW = backend.
 * Uji silang lewat `page.evaluate(fetch)` (page.request tidak lewat MSW).
 */

test.use({ actionTimeout: 8_000, navigationTimeout: 20_000 });

async function plan(page: Page, ticker: string) {
  return page.evaluate(async (t) => (await fetch(`/api/v1/plan/stock/${t}`)).json(), ticker);
}

test("panel lengkap: rezim, ringkasan, skenario (dengan n_events), plan, level, cakupan", async ({ page }) => {
  await page.goto("/stocks/BBRI");
  const panel = page.getByTestId("analysis-panel");
  await expect(panel).toBeVisible();

  const data = (await plan(page, "BBRI")) as {
    regime: { code: string; label: string; active_tools: string[] };
    summary_lines: string[];
    scenario: { n_events: number; p_tp1_first: number };
    levels_table: { label: string }[];
    coverage: { bars_available: number };
  };

  // badge rezim (header + panel) dari respons yang sama
  await expect(page.getByTestId("analysis-regime")).toHaveText(data.regime.label);
  await expect(page.getByTestId("stock-regime")).toHaveText(data.regime.label);
  await expect(page.getByText("harga penyesuaian").first()).toBeVisible();

  // ringkasan = kalimat dari API
  await expect(page.getByTestId("analysis-summary")).toContainText(data.summary_lines[0]);

  // skenario: peluang tanpa tanda + jumlah event wajib tampil
  const tp1 = panel.locator('[data-scenario="tp1"]');
  await expect(tp1).toHaveText(`${Math.round(data.scenario.p_tp1_first * 100)}%`);
  await expect(panel.locator('[data-scenario="tp1"]')).not.toContainText("+");
  await expect(panel.locator('[data-scenario="events"]')).toContainText(String(data.scenario.n_events));

  // plan: baris + alasan; daftar level; cakupan
  for (const key of ["tool", "confirm", "zone", "stop", "tp1", "tp2", "hold", "invalidation"]) {
    await expect(panel.locator(`[data-plan-row="${key}"]`)).toBeVisible();
  }
  await expect(page.getByTestId("analysis-levels")).toContainText(data.levels_table[0].label);
  await expect(page.getByTestId("analysis-coverage")).toContainText(String(data.coverage.bars_available));
  await expect(page.getByTestId("analysis-coverage")).toContainText("harga penyesuaian");

  // tidak ada istilah mentah / angka rusak
  const text = await panel.innerText();
  for (const raw of ["pullback_ma20", "breakout_donchian", "SMA20", "ATR", "R:R"]) {
    expect(text).not.toContain(raw);
  }
  expect(text).not.toContain("NaN");
  expect(text).not.toContain("undefined");
});

test("uji silang 3 ticker beda rezim: angka panel = respons /plan/stock", async ({ page }) => {
  for (const ticker of ["BBRI", "TLKM", "GOTO"]) {
    await page.goto(`/stocks/${ticker}`);
    const panel = page.getByTestId("analysis-panel");
    await expect(panel).toBeVisible();
    const data = (await plan(page, ticker)) as {
      regime: { label: string };
      levels_table: { label: string; level?: number; low?: number; high?: number }[];
    };
    const nf = (v: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(v);
    await expect(page.getByTestId("analysis-regime")).toHaveText(data.regime.label);
    const first = data.levels_table[0];
    const expected = first.low !== undefined && first.high !== undefined ? `${nf(first.low!)}–${nf(first.high!)}` : nf(first.level!);
    await expect(page.getByTestId("analysis-levels")).toContainText(expected);
  }
});

test("scenario null (sampel kecil) → 'belum cukup riwayat', bukan 0%", async ({ page }) => {
  await page.goto("/stocks/GOTO");
  const panel = page.getByTestId("analysis-panel");
  await expect(panel).toBeVisible();
  const data = (await plan(page, "GOTO")) as { scenario: unknown };
  expect(data.scenario).toBeNull();
  await expect(panel.locator('[data-scenario="short"]')).toContainText("belum cukup riwayat");
  await expect(panel).not.toContainText("0%");
});

test("?mock=shortdata → 'Data belum cukup' + panel tetap tampil tanpa tabel kosong", async ({ page }) => {
  await page.goto("/stocks/BBRI?mock=shortdata");
  const panel = page.getByTestId("analysis-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("analysis-regime")).toHaveText("Data belum cukup");
  await expect(page.getByTestId("analysis-summary")).toContainText("belum cukup 60 bar");
  // tanpa tabel skenario & daftar level (bukan tabel kosong)
  await expect(page.getByTestId("analysis-scenario")).toHaveCount(0);
  await expect(page.getByTestId("analysis-levels")).toHaveCount(0);
  await expect(page.getByTestId("analysis-plan-empty")).toBeVisible();
  await expect(page.getByTestId("analysis-coverage")).toBeVisible();
});

test("?mock=planfail → 'perlu ditinjau' + notes terlihat tanpa membuka apa pun", async ({ page }) => {
  await page.goto("/stocks/BBRI?mock=planfail");
  await expect(page.getByTestId("analysis-plan-state")).toHaveText("perlu ditinjau");
  await expect(page.getByTestId("analysis-notes")).toContainText("Imbal hasil terhadap risiko");
});

test("satu permintaan plan per halaman; regresi panel lama tetap ada", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/plan/stock/")) calls.push(new URL(request.url()).pathname);
  });
  await page.goto("/stocks/BBRI");
  await expect(page.getByTestId("analysis-panel")).toBeVisible();
  expect([...new Set(calls)]).toEqual(["/api/v1/plan/stock/BBRI"]);
  expect(calls.length).toBeLessThanOrEqual(2); // dev StrictMode memanggil 2×
  // regresi: metrik, sparkline, grafik candle, TaPanel, RRG tetap tampil
  await expect(page.getByTestId("sparkline")).toBeVisible();
  await expect(page.getByTestId("candle-chart")).toBeVisible();
  await expect(page.getByTestId("ta-panel-BBRI")).toBeVisible();
});
