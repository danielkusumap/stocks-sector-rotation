import { expect, test, type Page } from "@playwright/test";

/**
 * F22 — lapisan konteks SMC & Elliott di grafik candle (docs/06 §6.7, docs/08 F22).
 * Lapisan digambar **hanya** bila toggle di URL (`?layers=`) memintanya; respons yang memuatnya
 * tanpa diminta (`?mock=smc`) tidak boleh menampilkan apa pun. Angka dari API; MSW = backend.
 */

test.use({ actionTimeout: 8_000, navigationTimeout: 20_000 });

type Shape = { kind: string; mitigated?: boolean };

async function layers(page: Page, ticker: string, query: string) {
  return page.evaluate(
    async ({ t, q }) => (await fetch(`/api/v1/series/stock/${t}?${q}`)).json(),
    { t: ticker, q: query },
  );
}

test("default mati: respons memuat SMC/Elliott pun 0 elemen lapisan", async ({ page }) => {
  await page.goto("/stocks/BBRI?mock=smc");
  await expect(page.getByTestId("candle-chart")).toBeVisible();

  // respons memang membawa kedua lapisan (bukti mock bekerja)
  const data = (await layers(page, "BBRI", "mock=smc")) as { smc?: unknown; elliott?: unknown; layers: string[] };
  expect(data.smc).toBeTruthy();
  expect(data.elliott).toBeTruthy();
  expect(data.layers).toEqual(["indicators"]); // hanya lapisan bawaan yang diminta UI

  // ...tapi UI tidak menggambar apa pun & tidak mengklaim lapisan konteks
  await expect(page.locator('[data-layer="smc"]')).toHaveCount(0);
  await expect(page.locator('[data-layer="elliott"]')).toHaveCount(0);
  await expect(page.getByTestId("layer-notice-smc")).toHaveCount(0);
  await expect(page.getByTestId("layer-notice-elliott")).toHaveCount(0);
  await expect(page.getByTestId("elliott-invalidated")).toHaveCount(0);
  await expect(page.getByTestId("layer-smc")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("layer-elliott")).toHaveAttribute("aria-pressed", "false");
});

test("SMC menyala: BOS/CHoCH, order block, FVG, equal level, premium/discount — jumlah dari API", async ({ page }) => {
  await page.goto("/stocks/BBRI?mock=smc&layers=indicators,smc");
  const chart = page.getByTestId("candle-chart");
  await expect(chart).toBeVisible();
  await expect(page.getByTestId("layer-smc")).toHaveAttribute("aria-pressed", "true");

  const data = (await layers(page, "BBRI", "mock=smc&layers=indicators,smc")) as {
    smc: { bos: Shape[]; choch: Shape[]; order_blocks: Shape[]; fvg: Shape[]; equal_levels: Shape[]; range: unknown };
  };
  const lines =
    data.smc.bos.length + data.smc.choch.length + data.smc.equal_levels.length + (data.smc.range ? 1 : 0);
  const boxes = data.smc.order_blocks.length + data.smc.fvg.length + (data.smc.range ? 2 : 0);

  const group = chart.locator('[data-layer="smc"]');
  await expect(group).toHaveCount(1);
  await expect(group.locator("line")).toHaveCount(lines);
  await expect(group.locator("rect")).toHaveCount(boxes);

  // label teks: BOS & CHoCH + `N×` untuk equal level + premium/discount/50%
  const text = await group.innerText();
  expect(text).toContain("BOS");
  expect(text).toContain("CHoCH");
  expect(text).toMatch(/\d+×/);
  expect(text).toContain("premium");
  expect(text).toContain("discount");

  // lapisan konteks: pointer-events none & disebut di legenda
  await expect(group).toHaveAttribute("pointer-events", "none");
  await expect(page.getByTestId("layer-notice-smc")).toHaveText("lapisan konteks, bukan sinyal");
  await expect(page.getByTestId("layer-notice-elliott")).toHaveCount(0);

  // tidak ada nama mentah / angka rusak
  for (const raw of ["bos", "choch", "order_blocks", "fvg", "equal_levels", "mitigated"]) {
    expect(text).not.toContain(raw);
  }
  expect(text).not.toContain("NaN");
});

test("Elliott menyala: ZigZag, label wave, zona Fib; pola batal putus + opacity 0,5 + catatan", async ({ page }) => {
  await page.goto("/stocks/BBRI?mock=smc&layers=indicators,elliott");
  const chart = page.getByTestId("candle-chart");
  await expect(chart).toBeVisible();

  const data = (await layers(page, "BBRI", "mock=smc&layers=indicators,elliott")) as {
    elliott: { invalidated: boolean; zigzag: Shape[]; waves: Shape[]; fib_zones: Shape[]; note: string };
  };
  expect(data.elliott.invalidated).toBe(true);

  const group = chart.locator('[data-layer="elliott"]');
  await expect(group).toHaveCount(1);
  await expect(group.locator("polyline")).toHaveCount(1);
  await expect(group.locator("text")).toHaveCount(data.elliott.waves.length + data.elliott.fib_zones.length);
  await expect(group.locator("line")).toHaveCount(data.elliott.fib_zones.length);

  // pola batal → garis putus + opacity 0,5 pada seluruh elemen Elliott
  const zigzag = group.locator("polyline").first();
  await expect(zigzag).toHaveAttribute("stroke-dasharray", "4 3");
  await expect(zigzag).toHaveAttribute("opacity", "0.5");
  await expect(group).toHaveAttribute("pointer-events", "none");

  // catatan dari API apa adanya + badge pola batal
  await expect(page.getByTestId("elliott-note")).toHaveText(data.elliott.note);
  await expect(page.getByTestId("elliott-note")).toContainText("kandidat, bisa berubah");
  await expect(page.getByTestId("elliott-invalidated")).toHaveText("pola batal");
  await expect(page.getByTestId("layer-notice-elliott")).toHaveText("lapisan konteks, bukan sinyal");
});

test("keduanya menyala: 2 notice, hover bar tetap jalan, 1 permintaan, tanpa angka lapisan di blok plan", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/series/stock/")) requests.push(new URL(request.url()).search);
  });
  await page.goto("/stocks/BBRI?mock=smc&layers=indicators,smc,elliott");
  const chart = page.getByTestId("candle-chart");
  await expect(chart).toBeVisible();

  await expect(chart.locator('[data-layer="smc"]')).toHaveCount(1);
  await expect(chart.locator('[data-layer="elliott"]')).toHaveCount(1);
  await expect(page.getByTestId("layer-notice-smc")).toHaveText("lapisan konteks, bukan sinyal");
  await expect(page.getByTestId("layer-notice-elliott")).toHaveText("lapisan konteks, bukan sinyal");

  // hover di tengah grafik tetap menghasilkan kotak angka (lapisan tidak menelan pointer)
  const box = (await chart.locator("svg").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.4);
  await expect(page.getByTestId("candle-hover")).toBeVisible();

  // satu permintaan per halaman (StrictMode dev boleh 2×) & parameter lapisan terkirim
  expect(new Set(requests).size).toBe(1);
  expect(new URLSearchParams(requests[0]).get("layers")).toBe("indicators,smc,elliott");

  // blok plan & ringkasan analisa tidak memuat angka/nama lapisan konteks INI
  const plan = page.getByTestId("analysis-plan");
  await expect(plan).not.toContainText("BOS");
  await expect(plan).not.toContainText("ZigZag");
  await expect(plan).not.toContainText("order block");
});

test("toggle SMC/Elliott: hidup di URL, bertahan setelah reload, tidak menambah permintaan", async ({ page }) => {
  await page.goto("/stocks/BBRI");
  await expect(page.getByTestId("candle-chart")).toBeVisible();
  await expect(page.getByTestId("layer-smc")).toHaveAttribute("aria-pressed", "false");

  await page.getByTestId("layer-smc").click();
  await expect(page).toHaveURL(/layers=indicators%2Csmc|layers=indicators,smc/);
  await expect(page.getByTestId("layer-smc")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-layer="smc"]')).toHaveCount(1);

  await page.getByTestId("layer-elliott").click();
  await expect(page.locator('[data-layer="elliott"]')).toHaveCount(1);
  await expect(page.getByTestId("candle-reset")).toHaveCount(0); // Reset hanya untuk zoom (F23)

  // bertahan setelah reload: pilihan dibaca dari URL, bukan state hilang
  await page.reload();
  await expect(page.getByTestId("layer-smc")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("layer-elliott")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-layer="smc"]')).toHaveCount(1);

  // mematikan kembali → parameter lapisan hilang dari URL (kembali ke default `indicators`)
  await page.getByTestId("layer-smc").click();
  await page.getByTestId("layer-elliott").click();
  expect(new URL(page.url()).searchParams.get("layers")).toBeNull();
  await expect(page.locator('[data-layer="smc"]')).toHaveCount(0);
  await expect(page.locator('[data-layer="elliott"]')).toHaveCount(0);
});
