import { expect, test } from "@playwright/test";

/**
 * F13c — kartu IHSG dari `GET /meta/market?live=true` (bukan `/briefing/morning`), poll sesuai
 * `market.poll_seconds`, dan **tidak pernah tampil seolah live** kalau angkanya dari DB.
 * Dev server + MSW.
 */

test("@slow kartu IHSG: angka, waktu bar, kata delay, dan penanda live", async ({ page }) => {
  await page.goto("/");
  const card = page.getByTestId("ihsg-card");
  await expect(card).toBeVisible();

  await expect(page.getByTestId("ihsg-close")).toHaveText("5.936,15");
  await expect(card).toContainText("−2,59%");
  await expect(page.getByTestId("ihsg-meta")).toContainText("WIB");
  await expect(page.getByTestId("ihsg-meta")).toContainText("delay");
  await expect(page.getByTestId("ihsg-source-dot")).toHaveAttribute("data-source", "live");
  // session = open → baris intraday ikut tampil (docs/08 F13c no.4)
  await expect(page.getByTestId("ihsg-intraday")).toBeVisible();
  // tidak ada lagi kartu IHSG dari briefing (satu sumber saja)
  await expect(page.getByTestId("ihsg-card")).toHaveCount(1);
});

test("@slow kutipan jatuh ke data tersimpan: penanda amber + kalimat jujur, tanpa baris intraday", async ({
  page,
}) => {
  await page.goto("/?mock=stale");
  const card = page.getByTestId("ihsg-card");
  await expect(card).toBeVisible();

  await expect(page.getByTestId("ihsg-source-dot")).toHaveAttribute("data-source", "db");
  await expect(page.getByTestId("ihsg-stored")).toContainText("data tersimpan terakhir 12 Okt 2026 16:00");
  await expect(page.getByTestId("ihsg-meta")).toContainText("delay");
  // `ret_intraday` null di luar jam bursa → barisnya tidak ditampilkan (bukan dicetak "—")
  await expect(page.getByTestId("ihsg-intraday")).toHaveCount(0);
});

test("@slow poll berjalan: label 'per …' bergerak dan angka tidak menggeser kartu", async ({ page }) => {
  await page.goto("/?mock=fast");
  const meta = page.getByTestId("ihsg-meta");
  await expect(meta).toBeVisible();

  const first = await meta.innerText();
  const box = (await page.getByTestId("ihsg-close").boundingBox())!;

  // `poll_seconds: 1` di mock → dua poll berikutnya cukup cepat
  await expect.poll(async () => meta.innerText(), { timeout: 15_000 }).not.toBe(first);

  const boxAfter = (await page.getByTestId("ihsg-close").boundingBox())!;
  expect(boxAfter.x).toBeCloseTo(box.x, 0);
  expect(boxAfter.width).toBeCloseTo(box.width, 0);
  await expect(page.getByTestId("ihsg-close")).toHaveText("5.936,15");
});

test("@slow fetch gagal tidak mengosongkan kartu (angka terakhir bertahan + penanda tersimpan)", async ({
  page,
}) => {
  // `?mock=down`: poll pertama ok, poll berikutnya 500 → kartu memakai data terakhir
  await page.goto("/?mock=down");
  await expect(page.getByTestId("ihsg-close")).toHaveText("5.936,15");
  await expect(page.getByTestId("ihsg-stored")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("ihsg-close")).toHaveText("5.936,15");
  await expect(page.getByTestId("ihsg-source-dot")).toHaveAttribute("data-source", "db");
});
