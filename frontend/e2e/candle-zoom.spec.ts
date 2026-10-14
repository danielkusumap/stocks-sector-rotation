import { expect, test, type Page } from "@playwright/test";

/**
 * F23 — zoom & pan grafik candle (docs/06 §6.8, docs/08 F23). Murni frontend: tidak ada endpoint
 * baru, tapi aturan interaksi lama harus tetap berlaku (kotak hover §6.3, garis level di posisi
 * harga yang benar, `aria-live` rentang terlihat).
 */

test.use({ actionTimeout: 8_000, navigationTimeout: 20_000 });

/** Jumlah bar yang tertulis di `aria-live` ("12 Agu – 9 Okt, 40 bar"). */
async function liveBars(page: Page): Promise<number> {
  const text = (await page.getByTestId("candle-live").textContent()) ?? "";
  const match = /,\s*(\d+)\s*bar\s*$/.exec(text.trim());
  if (!match) throw new Error(`label rentang tidak terbaca: "${text}"`);
  return Number(match[1]);
}

async function totalBars(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const body = (await (await fetch("/api/v1/series/stock/BBRI?window=3m")).json()) as { candles: unknown[] };
    return body.candles.length;
  });
}

/** Titik di dalam area plot (bukan padding kanan tempat label harga). */
async function plotPoint(page: Page, fraction: number) {
  const box = (await page.getByTestId("candle-chart").locator("svg").boundingBox())!;
  return { x: box.x + box.width * (0.05 + 0.85 * fraction), y: box.y + box.height * 0.25 };
}

test("roda mouse: menyempit di sekitar kursor (bukan selalu ke tengah) + aria-live berubah", async ({ page }) => {
  await page.goto("/stocks/BBRI");
  const chart = page.getByTestId("candle-chart");
  await expect(chart).toBeVisible();

  const total = await totalBars(page);
  expect(await liveBars(page)).toBe(total); // keadaan awal: seluruh data
  await expect(page.getByTestId("candle-reset")).toHaveCount(0);

  // kursor di seperempat kiri (≈ bar ke-30 dari 120) → rentang baru harus menempel di kiri
  const point = await plotPoint(page, 0.25);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -120);

  await expect.poll(() => liveBars(page)).toBe(Math.round(total * 0.8));
  await expect(page.getByTestId("candle-reset")).toBeVisible();

  // jangkar kursor: rentang mulai tepat di bar ke-6 (bukan 12 = tengah, bukan 24 = kanan)
  const startDate = await page.evaluate(async () => {
    const body = (await (await fetch("/api/v1/series/stock/BBRI?window=3m")).json()) as {
      candles: { date: string }[];
    };
    return body.candles.map((bar) => bar.date);
  });
  const label = (await page.getByTestId("candle-live").textContent()) ?? "";
  const short = (date: string) =>
    new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" }).format(
      new Date(`${date}T00:00:00+07:00`),
    );
  // toleransi ±2 bar (pembulatan piksel → indeks), tapi harus jelas di kiri dan bukan di tengah
  const matchIndex = startDate.findIndex((date) => label.startsWith(short(date)));
  expect(matchIndex).toBeGreaterThanOrEqual(4);
  expect(matchIndex).toBeLessThanOrEqual(8);
  expect(label.endsWith(`${Math.round(total * 0.8)} bar`)).toBe(true);
});

test("batas: tidak bisa kurang dari 20 bar, tidak bisa melewati tepi data", async ({ page }) => {
  await page.goto("/stocks/BBRI");
  await expect(page.getByTestId("candle-chart")).toBeVisible();
  const total = await totalBars(page);

  // zoom masuk jauh melewati batas → berhenti di 20 bar dan berhenti bergerak
  const point = await plotPoint(page, 0.5);
  await page.mouse.move(point.x, point.y);
  for (let i = 0; i < 12; i += 1) await page.mouse.wheel(0, -120);
  await expect.poll(() => liveBars(page)).toBe(20);
  await page.mouse.wheel(0, -120);
  expect(await liveBars(page)).toBe(20);

  // pan jauh ke kanan (drag ke kiri) → tetap 20 bar, dan bar terakhir data tidak terlewat
  const before = (await page.getByTestId("candle-live").textContent()) ?? "";
  await page.mouse.move(point.x + 200, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x - 400, point.y, { steps: 6 });
  await page.mouse.up();
  const after = (await page.getByTestId("candle-live").textContent()) ?? "";
  expect(after).not.toBe(before);
  expect(await liveBars(page)).toBe(20);

  // pan terus sampai tepi: 20 kali → rentang berhenti di ujung data (tidak error, tetap 20 bar)
  for (let i = 0; i < 20; i += 1) {
    await page.mouse.move(point.x + 300, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x - 300, point.y, { steps: 3 });
    await page.mouse.up();
  }
  expect(await liveBars(page)).toBe(20);
  const edge = (await page.getByTestId("candle-live").textContent()) ?? "";
  expect(edge).not.toContain("NaN");

  // zoom keluar jauh → berhenti di seluruh data, tidak lebih
  for (let i = 0; i < 10; i += 1) await page.mouse.wheel(0, 120);
  await expect.poll(() => liveBars(page)).toBe(total);
  await expect(page.getByTestId("candle-reset")).toHaveCount(0);
});

test("drag memindahkan rentang; klik ganda & tombol Reset kembali ke seluruh data", async ({ page }) => {
  await page.goto("/stocks/BBRI");
  await expect(page.getByTestId("candle-chart")).toBeVisible();
  const total = await totalBars(page);

  const point = await plotPoint(page, 0.5);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -120);
  await page.mouse.wheel(0, -120);
  const zoomed = await liveBars(page);
  expect(zoomed).toBeLessThan(total);

  // drag ke kiri = melihat bar yang lebih baru
  const before = (await page.getByTestId("candle-live").textContent()) ?? "";
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x - 120, point.y, { steps: 5 });
  await page.mouse.up();
  const after = (await page.getByTestId("candle-live").textContent()) ?? "";
  expect(after).not.toBe(before);
  expect(await liveBars(page)).toBe(zoomed); // pan tidak mengubah jumlah bar terlihat

  // tombol Reset
  await page.getByTestId("candle-reset").click();
  expect(await liveBars(page)).toBe(total);
  await expect(page.getByTestId("candle-reset")).toHaveCount(0);

  // klik ganda di grafik juga reset
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -120);
  await expect(page.getByTestId("candle-reset")).toBeVisible();
  await page.mouse.dblclick(point.x, point.y);
  expect(await liveBars(page)).toBe(total);
});

test("keyboard: `-` memperbesar, `+` mengecil, `0` reset, panah menggeser", async ({ page }) => {
  await page.goto("/stocks/BBRI");
  const svg = page.getByTestId("candle-chart").locator("svg");
  await expect(svg).toBeVisible();
  const total = await totalBars(page);

  await svg.press("-");
  await expect.poll(() => liveBars(page)).toBe(Math.round(total * 0.8));
  await svg.press("-");
  const twice = await liveBars(page);
  expect(twice).toBeLessThan(Math.round(total * 0.8));

  await svg.press("+");
  const afterPlus = await liveBars(page);
  expect(afterPlus).toBeGreaterThan(twice);

  // panah menggeser rentang tanpa mengubah jumlah bar
  const before = (await page.getByTestId("candle-live").textContent()) ?? "";
  await svg.press("ArrowLeft");
  const after = (await page.getByTestId("candle-live").textContent()) ?? "";
  expect(after).not.toBe(before);
  expect(await liveBars(page)).toBe(afterPlus);

  await svg.press("0");
  expect(await liveBars(page)).toBe(total);
});

test("aturan §6.3 di 3 tingkat zoom: kotak hover tidak menutupi 20 bar terakhir", async ({ page }) => {
  await page.goto("/stocks/BBRI");
  const chart = page.getByTestId("candle-chart");
  await expect(chart).toBeVisible();
  const total = await totalBars(page);

  /**
   * `count <= 20` → setiap hover ada di 20 bar terakhir, jadi kotak wajib selalu ke kiri.
   * Lebih dari itu: hover di ujung kanan wajib ke kiri, hover di tengah wajib ke kanan garis.
   */
  const check = async (label: string, count: number) => {
    const box = (await chart.locator("svg").boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.96, box.y + box.height * 0.3);
    await expect(page.getByTestId("candle-hover")).toBeVisible();
    await expect(page.getByTestId("candle-hover"), `${label}: ujung kanan`).toHaveAttribute(
      "style",
      /translateX\(-105%\)/,
    );
    if (count > 20) {
      await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.3);
      await expect(page.getByTestId("candle-hover"), `${label}: tengah`).toHaveAttribute("style", /translateX\(4px\)/);
    }
  };

  expect(await liveBars(page)).toBe(total);
  await check(`semua data (${total} bar)`, total);

  const point = await plotPoint(page, 0.5);
  await page.mouse.move(point.x, point.y);
  for (let i = 0; i < 10 && (await liveBars(page)) > 60; i += 1) await page.mouse.wheel(0, -120);
  const midCount = await liveBars(page);
  expect(midCount).toBeLessThanOrEqual(60);
  await check(`${midCount} bar`, midCount);

  for (let i = 0; i < 10 && (await liveBars(page)) > 20; i += 1) await page.mouse.wheel(0, -120);
  expect(await liveBars(page)).toBe(20);
  await check("20 bar", 20);
});

test("setelah zoom: garis level hanya bila di rentang & posisi harganya tetap benar", async ({ page }) => {
  await page.goto("/stocks/BBRI");
  const chart = page.getByTestId("candle-chart");
  await expect(chart).toBeVisible();

  const data = await page.evaluate(async () => {
    const body = (await (await fetch("/api/v1/series/stock/BBRI?window=3m")).json()) as {
      candles: { low: number; high: number }[];
      levels: { stop: number; tp1: number; tp2: number } | null;
    };
    return body;
  });
  const nf = (value: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value);
  await expect(chart.locator('[data-level="SL"]')).toContainText(`SL ${nf(data.levels!.stop)}`);

  // zoom ke 20 bar terakhir: level yang jauh di luar rentang tidak boleh digambar
  const point = await plotPoint(page, 0.5);
  await page.mouse.move(point.x, point.y);
  for (let i = 0; i < 9; i += 1) await page.mouse.wheel(0, -120);
  expect(await liveBars(page)).toBe(20);

  const last = data.candles.slice(-20);
  const low = Math.min(...last.map((bar) => bar.low));
  const high = Math.max(...last.map((bar) => bar.high));
  const inRange = [data.levels!.stop, data.levels!.tp1, data.levels!.tp2].filter((value) => value >= low && value <= high).length;
  const drawn = await chart.locator('[data-overlay="levels"] [data-level]').count();
  expect(drawn).toBe(inRange);

  // label level yang digambar tetap memakai angka dari respons (bukan hasil hitung baru)
  if (inRange > 0) {
    const texts = await chart.locator('[data-overlay="levels"] [data-level]').allInnerTexts();
    for (const text of texts) {
      const value = Number(text.replace(/[^\d.]/g, "").replace(/\./g, ""));
      expect([data.levels!.stop, data.levels!.tp1, data.levels!.tp2]).toContain(value);
    }
  }
  await expect(chart).not.toContainText("NaN");
});

test("regresi: gesture beruntun tanpa error konsol & tanpa NaN; F21 tetap utuh", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/stocks/BBRI");
  const chart = page.getByTestId("candle-chart");
  await expect(chart).toBeVisible();
  const point = await plotPoint(page, 0.5);

  // roda + drag + keyboard beruntun (juga saat sudah di batas)
  await page.mouse.move(point.x, point.y);
  for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, i % 2 === 0 ? -120 : 120);
  await page.mouse.down();
  await page.mouse.move(point.x + 80, point.y + 40, { steps: 4 });
  await page.mouse.up();
  await page.mouse.dblclick(point.x, point.y);
  await page.getByTestId("candle-chart").locator("svg").press("0");

  // F21 tetap hidup setelah zoom & pan
  await expect(page.locator('[data-overlay="ursi"]')).toHaveCount(1);
  await expect(page.locator('[data-overlay="vwap"]')).toHaveCount(1);
  await expect(page.locator('[data-overlay="poc"]')).toHaveCount(1);
  await expect(chart).not.toContainText("NaN");
  expect(errors).toEqual([]);
});
