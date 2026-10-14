import { expect, test, type Page } from "@playwright/test";

/**
 * F25 — menu **Swing Trade** `/swing` (docs/08 F25): picks 5 hari bursa terakhir + pantau yang
 * berjalan. Semua angka dari `GET /plan/picks` (MSW = backend); tab tanggal hidup di URL.
 */

test.use({ actionTimeout: 12_000, navigationTimeout: 60_000 });

const DATES = ["2026-10-13", "2026-10-12", "2026-10-09", "2026-10-08", "2026-10-07"];

function picksCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/plan/picks")) {
      calls.push(new URL(request.url()).searchParams.get("as_of") ?? "(tanpa as_of)");
    }
  });
  return calls;
}

async function apiPicks(page: Page, query: string) {
  return page.evaluate(
    async (q: string) => (await fetch(`/api/v1/plan/picks?${q}`)).json(),
    query,
  );
}

test("menu samping punya entri Swing Trade; halaman memuat picks tanggal terbaru tanpa klik", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Swing Trade" })).toBeVisible();
  await page.getByRole("link", { name: "Swing Trade" }).click();

  await expect(page).toHaveURL(/\/swing$/);
  await expect(page.getByRole("heading", { name: "Swing Trade" })).toBeVisible();
  await expect(page.getByTestId("swing-cards")).toBeVisible();
  // tab pertama (terbaru) aktif, tanpa `?date=` di URL
  await expect(page.getByTestId(`swing-date-${DATES[0]}`)).toHaveAttribute("aria-selected", "true");
  expect(new URL(page.url()).searchParams.get("date")).toBeNull();
});

test("tab tanggal: 5 hari, di URL, dan tidak menambah permintaan saat bolak-balik", async ({ page }) => {
  const calls = picksCalls(page);
  await page.goto("/swing");
  await expect(page.getByTestId("swing-cards")).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(5);
  await expect(page.getByTestId(`swing-date-${DATES[0]}`)).toHaveAttribute("aria-selected", "true");
  // halaman dibuka = satu permintaan untuk tanggal aktif (bukan 5 sekaligus)
  await expect.poll(() => calls.filter((asOf) => asOf === DATES[0]).length).toBe(1);

  await page.getByTestId(`swing-date-${DATES[1]}`).click();
  await expect(page).toHaveURL(new RegExp(`date=${DATES[1]}`));
  await expect(page.getByTestId(`swing-date-${DATES[1]}`)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("swing-cards")).toBeVisible();

  // tunggu pra-muat tab lain (setelah idle) selesai, baru ukur
  await expect(page.getByTestId(`running-day-${DATES[2]}`)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(300);
  const sebelumKembali = calls.length;

  // bolak-balik tab → dari cache TanStack (staleTime 5 menit), tidak ada permintaan baru
  await page.getByTestId(`swing-date-${DATES[0]}`).click();
  await expect(page.getByTestId(`swing-date-${DATES[0]}`)).toHaveAttribute("aria-selected", "true");
  await page.getByTestId(`swing-date-${DATES[1]}`).click();
  await expect(page.getByTestId(`swing-date-${DATES[1]}`)).toHaveAttribute("aria-selected", "true");
  await page.waitForTimeout(600);
  expect(calls.length).toBe(sebelumKembali);
  // satu permintaan per tanggal, bukan per klik
  for (const date of DATES) {
    expect(calls.filter((asOf) => asOf === date).length).toBeLessThanOrEqual(2);
  }
});

test("kartu pick: kepala, angka, penggaris level, rencana, alasan, peluang tanpa tanda", async ({ page }) => {
  await page.goto("/swing");
  const card = page.getByTestId("pick-BBRI");
  await expect(card).toBeVisible();

  const data = (await apiPicks(page, `as_of=${DATES[0]}`)) as {
    picks: {
      ticker: string;
      name: string;
      sector_code: string;
      close: number;
      stop: { level: number };
      tp1: { level: number; rr: number };
      tp2: { level: number; rr: number };
      entry_zone: { low: number; high: number };
      regime_label: string;
      zone_status: string;
      ranks?: number;
      rank: number;
      skor: number;
      status: string;
      hit_tp1?: number | null;
    }[];
    screened: number;
    ihsg_support: number;
  };
  const pick = data.picks[0];
  const nf = (value: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value);

  await expect(page.getByTestId("pick-ticker-BBRI")).toHaveText(pick.ticker);
  await expect(card).toContainText(pick.name);
  await expect(card).toContainText(pick.regime_label);
  await expect(page.getByTestId("pick-zone-badge-BBRI")).toHaveText(
    pick.zone_status === "di_zona" ? "Di zona beli" : "Mendekati zona",
  );
  await expect(page.getByTestId("pick-status-BBRI")).toBeVisible();

  // uji silang 3 angka dari kartu vs respons API (AC 6: tidak ada hitungan di frontend)
  await expect(page.getByTestId("pick-plan-BBRI").locator('[data-plan-row="stop"]')).toContainText(nf(pick.stop.level));
  await expect(page.getByTestId("pick-plan-BBRI").locator('[data-plan-row="zone"]')).toContainText(
    `${nf(pick.entry_zone.low)}–${nf(pick.entry_zone.high)}`,
  );
  const rr = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(pick.tp2.rr);
  await expect(page.getByTestId("pick-plan-BBRI").locator('[data-plan-row="tp2"]')).toContainText(`R:R ${rr}:1`);

  // penggaris level: aria-label memuat angka (AC 8) + semua tick ada
  const ruler = page.getByTestId("level-ruler-BBRI");
  await expect(ruler).toHaveAttribute("aria-label", new RegExp(`batas rugi ${nf(pick.stop.level)}`));
  await expect(ruler.locator('[data-ruler="stop"]')).toHaveCount(1);
  await expect(ruler.locator('[data-ruler="tp1"]')).toHaveCount(1);
  await expect(ruler.locator('[data-ruler="tp2"]')).toHaveCount(1);
  await expect(ruler.locator('[data-ruler="last"]')).toHaveCount(1);

  // alasan via disclosure (kartu tidak memanjang)
  const reasons = page.getByTestId("pick-reasons-BBRI");
  await expect(reasons.locator("summary")).toHaveText("Kenapa level ini?");
  await reasons.locator("summary").click();
  await expect(reasons).toContainText("ATR");

  // peluang tanpa tanda bila API mengirimnya
  const chanceRow = page.getByTestId("pick-plan-BBRI").locator('[data-plan-row="chance"]');
  if (pick.hit_tp1 === null || pick.hit_tp1 === undefined) {
    await expect(chanceRow).toHaveCount(0);
  } else {
    await expect(chanceRow).toHaveText(`${Math.round(pick.hit_tp1 * 100)}%`);
    await expect(chanceRow).not.toContainText("+");
  }

  // tautan ke halaman detail yang sudah ada
  await expect(page.getByTestId("pick-link-BBRI")).toHaveAttribute("href", "/stocks/BBRI");
  await expect(card).not.toContainText("NaN");
  await expect(card).not.toContainText("undefined");
});

test("ringkasan hari + badge tanggal bukan hari terakhir", async ({ page }) => {
  await page.goto("/swing");
  await expect(page.getByTestId("swing-summary")).toContainText("kandidat lolos");
  await expect(page.getByTestId("swing-summary")).toContainText("emiten disaring");
  await expect(page.getByTestId("swing-summary")).toContainText("support IHSG");

  await page.getByTestId(`swing-date-${DATES[1]}`).click();
  await expect(page.getByTestId("swing-day-badge")).toContainText(`data per`);
  await expect(page.getByTestId("swing-day-badge")).toContainText("hari ini");
});

test("pantau yang berjalan: dikelompokkan per status, klik pindah ke tanggalnya", async ({ page }) => {
  await page.goto("/swing");
  await expect(page.getByTestId("swing-cards")).toBeVisible();
  const watch = page.getByTestId("running-watch");
  await expect(watch).toBeVisible();
  // dimuat setelah idle — tunggu sampai kelompok muncul
  await expect(page.getByTestId(`running-day-${DATES[1]}`)).toBeVisible({ timeout: 15_000 });

  // kelompok dari data hari-hari sebelumnya: kena target 2 (BBCA) & kena batas rugi (ACES) di 2026-10-09
  const day2 = page.getByTestId(`running-day-${DATES[2]}`);
  await expect(day2.getByTestId("running-group-kena_tp2")).toContainText("Kena target 2");
  await expect(day2.getByTestId("running-pick-BBCA")).toBeVisible();
  await expect(day2.getByTestId("running-group-kena_stop")).toContainText("Kena batas rugi");

  // pick "menunggu zona" tidak masuk kelompok pantauan
  await expect(day2.getByTestId("running-group-menunggu_zona")).toHaveCount(0);

  // klik ticker → pindah ke tab tanggal pick itu
  await day2.getByTestId("running-pick-BBCA").click();
  await expect(page).toHaveURL(new RegExp(`date=${DATES[2]}`));
  await expect(page.getByTestId(`swing-date-${DATES[2]}`)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("pick-BBCA")).toBeVisible();
  await expect(page.getByTestId("pick-status-BBCA")).toContainText("Kena target 2");
});

test("tab tanggal lama menampilkan status berjalan per kartu", async ({ page }) => {
  await page.goto(`/swing?date=${DATES[1]}`);
  const card = page.getByTestId("pick-ASSA");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("pick-status-ASSA")).toContainText("Kena target 1");
  await expect(page.getByTestId("pick-running-ASSA")).toContainText("sejak pick");
  await expect(page.getByTestId("pick-running-ASSA")).toContainText("sempat naik");
  await expect(page.getByTestId("pick-running-ASSA")).toContainText("sempat turun");
});

test("keadaan kosong: picks kosong → jujur + panel aturan, bukan kartu palsu", async ({ page }) => {
  await page.goto("/swing?mock=swingempty");
  await expect(page.getByTestId("swing-empty")).toBeVisible();
  await expect(page.getByTestId("swing-empty")).toContainText("Tidak ada kandidat lolos saring");
  await expect(page.getByTestId("swing-cards")).toHaveCount(0);

  const rules = page.getByTestId("rules-panel");
  await expect(rules).toBeVisible();
  await rules.locator("summary").click();
  await expect(rules).toContainText("bukan daftar 962 emiten");
  await expect(rules.locator("li")).toHaveCount(9);
  await expect(rules).not.toContainText("TODO");
});

test("banner 'belum dihitung' + tombol Hitung memanggil POST /admin/compute lalu mem-poll run", async ({ page }) => {
  const posts: { url: string; body: unknown }[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/admin/compute")) {
      posts.push({ url: request.url(), body: request.postDataJSON() });
    }
  });

  await page.goto("/swing?mock=swing1day");
  await expect(page.getByTestId("swing-compute-banner")).toBeVisible();
  await expect(page.getByTestId("swing-compute-banner")).toContainText("5 hari bursa terakhir belum dihitung");
  await expect(page.getByTestId("swing-compute-banner")).toContainText("baru 1 tanggal tersedia");
  await expect(page.getByTestId("swing-compute-banner")).toContainText("±2,5 menit");

  await page.getByTestId("swing-compute-button").click();
  await expect.poll(() => posts.length).toBeGreaterThan(0);
  expect(posts[0].body).toEqual({ stage: "ta", plan_days: 5 });
  expect(new URL(posts[0].url).searchParams.get("async")).toBe("true");

  // progres dari GET /admin/runs/{id} sampai final + tombol muat ulang
  await expect(page.getByTestId("swing-compute-progress")).toBeVisible();
  await expect(page.getByTestId("swing-reload-button")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("swing-compute-progress")).not.toContainText("menghitung…", { timeout: 20_000 });
  await page.getByTestId("swing-reload-button").click();
  await expect(page.getByTestId("swing-cards")).toBeVisible();
});

test("@a11y tab = tablist, badge status punya teks, tanpa error konsol", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/swing");
  await expect(page.getByTestId("swing-cards")).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Tanggal pick" })).toBeVisible();
  expect(await page.getByRole("tab").count()).toBe(5);
  for (const date of DATES) {
    await expect(page.getByTestId(`swing-date-${date}`)).toHaveAttribute("aria-selected", /true|false/);
  }
  // badge status: teks ada, bukan hanya warna
  await page.getByTestId(`swing-date-${DATES[2]}`).click();
  const status = page.getByTestId("pick-status-BBCA");
  await expect(status).toHaveText(/Kena target 2/);
  expect(errors).toEqual([]);
});

test("404 tanggal tanpa isi → pesan jujur, bukan kartu kosong", async ({ page }) => {
  await page.goto("/swing?date=2026-01-02");
  // backend mengembalikan 404 (mock) → ErrorState, halaman tidak pernah crash
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("swing-cards")).toHaveCount(0);
});
