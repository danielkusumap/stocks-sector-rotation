import { expect, test, type Page, type Locator } from "@playwright/test";

/** Buka `<details>` lewat DOM: klik `<summary>` menunggu "stable" dan baris pick punya elemen dinamis. */
const open = (locator: Locator) =>
  locator.evaluate((el) => {
    (el as HTMLDetailsElement).open = true;
  });

/** Buka baris pick + expander "plan" di dalamnya (dua `<details>` bersarang). */
async function openPlan(page: Page, ticker: string) {
  const row = page.getByTestId(`pick-stock-${ticker}`);
  await open(row); // elemen baris pick sendiri adalah <details> luar
  await open(row.getByTestId(`plan-${ticker}`));
}

// Dev server + MSW mengembalikan data dalam milidetik → operasi yang butuh > 6 s berarti gagal;
// timeout pendek supaya kegagalan terlihat cepat (bukan 30 s).
test.use({ actionTimeout: 6_000, navigationTimeout: 15_000 });

/**
 * F18 — trading plan TA di halaman Weekly (`docs/06` §5.2, `docs/05` §3 api_version 1.2).
 * Angka dari `/weekly/picks`; uji silang lewat `page.evaluate(fetch)` (MSW tidak dilewati `page.request`).
 */

async function picks(page: Page) {
  return page.evaluate(async () => {
    const res = await fetch("/api/v1/weekly/picks");
    return res.json();
  });
}

test("baris pick & blok plan: angka identik dengan respons API, alasan ikut, tanpa nama alat mentah", async ({
  page,
}) => {
  await page.goto("/weekly");
  const row = page.getByTestId("pick-stock-BBRI");
  await expect(row).toBeVisible();

  const body = (await picks(page)) as {
    stocks: { ticker: string; plan: { entry_zone: { low: number; high: number }; stop: { level: number; pct: number }; tp2: { rr: number } } }[];
  };
  const plan = body.stocks.find((s) => s.ticker === "BBRI")!.plan;
  const nf = (value: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value);

  // uji silang: zona, batas rugi, R:R dari respons ada di baris
  const figures = page.getByTestId("pick-figures-line").first();
  await expect(figures).toContainText(`zona ${nf(plan.entry_zone.low)}–${nf(plan.entry_zone.high)}`);
  await expect(figures).toContainText(`SL ${nf(plan.stop.level)}`);
  await expect(figures).toContainText(`R:R ${plan.tp2.rr.toFixed(2).replace(".", ",")}:1`);

  // badge rezim
  await expect(row.getByTestId("plan-regime")).toHaveText("Tren naik");

  // expander kedua "plan" (setelah "kenapa?")
  const planBlock = row.getByTestId("plan-BBRI");
  await openPlan(page, "BBRI");
  for (const key of ["tool", "confirm", "zone", "stop", "tp1", "tp2", "hold", "invalidation"]) {
    await expect(planBlock.locator(`[data-plan-row="${key}"]`)).toBeVisible();
  }
  await expect(planBlock.locator('[data-plan-row="tool"]')).toContainText("pantulan ke penyangga 20 hari");
  await expect(planBlock.locator('[data-plan-row="hold"]')).toContainText("TP1 kena 62%");
  // tidak ada nama alat mentah di DOM
  await expect(page.locator("body")).not.toContainText("pullback_ma20");
  await expect(page.locator("body")).not.toContainText("breakout_donchian");

  // regresi F9: expander "kenapa?" tetap utuh
  await expect(row.getByTestId("rule-hits")).toBeAttached();
});

test("peluang null → 'belum cukup riwayat', bukan 0%", async ({ page }) => {
  await page.goto("/weekly");
  const row = page.getByTestId("pick-stock-BBCA");
  await expect(row).toBeVisible();
  await openPlan(page, "BBCA");
  await expect(row.getByTestId("plan-BBCA").locator('[data-plan-row="hold"]')).toContainText(
    "belum cukup riwayat",
  );
  await expect(row.getByTestId("plan-BBCA").locator('[data-plan-row="hold"]')).not.toContainText("0%");
});

test("?mock=notrade → satu kalimat 'tidak ada rencana beli', tanpa angka level", async ({ page }) => {
  await page.goto("/weekly?mock=notrade");
  const row = page.getByTestId("pick-stock-BBRI");
  await expect(row).toBeVisible();
  await expect(row).toContainText("tidak ada rencana beli");
  await expect(row.getByTestId("plan-state")).toHaveText("tidak ada rencana beli");
  const figures = row.getByTestId("pick-figures-line");
  await expect(figures).not.toContainText("zona");
  await expect(figures).not.toContainText("SL ");
  await expect(figures).not.toContainText("NaN");
});

test("?mock=planfail → badge 'perlu ditinjau' + notes terlihat tanpa membuka expander", async ({ page }) => {
  await page.goto("/weekly?mock=planfail");
  const row = page.getByTestId("pick-stock-BBRI");
  await expect(row.getByTestId("plan-state")).toHaveText("perlu ditinjau");
  await expect(row.getByTestId("plan-notes")).toContainText("Imbal hasil terhadap risiko di bawah 3:1");
  // pick tidak disembunyikan
  await expect(row).toBeVisible();
});

test("plan null → catatan 'plan belum tersedia', tanpa NaN/undefined", async ({ page }) => {
  await page.goto("/weekly?mock=noplan");
  const row = page.getByTestId("pick-stock-BBRI");
  await expect(row).toBeVisible();
  await expect(row.getByTestId("plan-BBRI")).toContainText("plan belum tersedia untuk pekan ini");
  await expect(row.getByTestId("pick-figures-line")).toContainText("entry");
  await expect(page.locator("body")).not.toContainText("NaN");
  await expect(page.locator("body")).not.toContainText("undefined");
});
