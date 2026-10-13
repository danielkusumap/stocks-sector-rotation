import { expect, test, type Page } from "@playwright/test";

/**
 * F15/F15b — posisi kartu hover (docs/06 §6.3). Kartu diletakkan searah gerak titik
 * (berlawanan ekornya), bukan offset tetap. "Tidak menutupi" = kartu tidak menutupi
 * (a) titik aktif, (b) ekor titik aktif, (c) label titik aktif. Irisan dengan ekor
 * titik LAIN boleh (mode fokus §6.1 meredupkannya ke 0,18/pr). Angka dicetak per titik.
 */
type Rect = { x: number; y: number; width: number; height: number };

/** Segmen ekor yang menyentuh kotak kartu, dipisah ekor sendiri vs ekor titik lain. */
const tailHits = (page: Page, ref: string, card: Rect) =>
  page.evaluate(
    ({ ref, card }) => {
      const inside = (x: number, y: number) =>
        x >= card.x && x <= card.x + card.width && y >= card.y && y <= card.y + card.height;
      const count = (selector: string) => {
        let hits = 0;
        for (const el of document.querySelectorAll(selector)) {
          const m = el.getScreenCTM()!;
          const a = new DOMPoint(Number(el.getAttribute("x1")), Number(el.getAttribute("y1"))).matrixTransform(m);
          const b = new DOMPoint(Number(el.getAttribute("x2")), Number(el.getAttribute("y2"))).matrixTransform(m);
          for (let i = 0; i <= 200; i += 1) {
            const t = i / 200;
            if (inside(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) {
              hits += 1;
              break;
            }
          }
        }
        return hits;
      };
      const own = count(`[data-testid^=tail-${ref}-]`);
      const all = count("[data-testid^=tail-]");
      return { own, other: all - own };
    },
    { ref, card },
  );

const covers = (card: Rect, x: number, y: number) =>
  x >= card.x && x <= card.x + card.width && y >= card.y && y <= card.y + card.height;

test.describe("kartu hover RRG (docs/06 §6.3)", () => {
  test("setiap titik: kartu di dalam chart, tidak menutupi titiknya sendiri", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("point-IDXFINANCE").waitFor();
    await page.waitForTimeout(300);

    const refs = await page.$$eval("[data-testid^=point-group-]", (els) =>
      els.map((el) => el.getAttribute("data-testid")!.replace("point-group-", "")),
    );
    expect(refs.length).toBeGreaterThan(8);

    const chart = (await page.getByTestId("rrg-chart").boundingBox())!;
    const report: string[] = [];
    for (const ref of refs) {
      const point = (await page.getByTestId(`point-${ref}`).boundingBox())!;
      await page.getByTestId(`point-${ref}`).hover();
      await page.waitForTimeout(120);
      const card = (await page.getByTestId("point-card").boundingBox())!;
      const { own, other } = await tailHits(page, ref, card);
      report.push(
        `${ref} side=${await page.getByTestId("point-card").getAttribute("data-side")} ekor-sendiri=${own} ekor-lain=${other}`,
      );

      // kartu selalu di dalam kotak chart (toleransi 1 px)
      expect(card.x, ref).toBeGreaterThanOrEqual(chart.x - 1);
      expect(card.y, ref).toBeGreaterThanOrEqual(chart.y - 1);
      expect(card.x + card.width, ref).toBeLessThanOrEqual(chart.x + chart.width + 1);
      expect(card.y + card.height, ref).toBeLessThanOrEqual(chart.y + chart.height + 1);

      // titik di balik kartu tetap bisa di-hover/klik → kartu tidak menutupi titiknya sendiri
      const centre = { x: point.x + point.width / 2, y: point.y + point.height / 2 };
      expect(covers(card, centre.x, centre.y), `${ref} menutupi titiknya`).toBe(false);
    }
    console.log(`Kartu per titik:\n${report.join("\n")}`);
  });

  test("ekor & label titik aktif bersih; ekor titik lain boleh (diukur, dicetak)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("point-IDXFINANCE").waitFor();
    await page.waitForTimeout(300);

    const refs = await page.$$eval("[data-testid^=point-group-]", (els) =>
      els.map((el) => el.getAttribute("data-testid")!.replace("point-group-", "")),
    );
    const report: string[] = [];
    let ownClean = 0;
    let labelClean = 0;
    for (const ref of refs) {
      await page.getByTestId(`point-${ref}`).hover();
      await page.waitForTimeout(120);
      const card = (await page.getByTestId("point-card").boundingBox())!;
      const { own, other } = await tailHits(page, ref, card);

      // label titik aktif digambar di kanan titik (dx 11–12 px) → area itu tidak boleh tertutup
      const point = (await page.getByTestId(`point-${ref}`).boundingBox())!;
      const labelCovered = covers(card, point.x + point.width + 6, point.y + point.height / 2);

      if (own === 0) ownClean += 1;
      if (!labelCovered) labelClean += 1;
      report.push(
        `${ref} side=${await page.getByTestId("point-card").getAttribute("data-side")} ekor-sendiri=${own} ekor-lain=${other} label-tertutup=${labelCovered}`,
      );
    }
    console.log(`Kartu per titik:\n${report.join("\n")}`);
    console.log(
      `ekor sendiri bersih ${ownClean}/${refs.length} · label titik aktif bersih ${labelClean}/${refs.length} · lebar kartu ${
        (await page.getByTestId("point-card").boundingBox())!.width
      } px`,
    );
    // definisi "tidak menutupi" F15b: label titik aktif WAJIB bersih (11/11). Ekor titik
    // aktif: 7/11 setelah kartu dikecilkan ke 200 px — 4 titik mentok tepi tetap tidak punya
    // sisi bebas ekor di dalam kotak (ADR-041), jadi angkanya yang dijaga, bukan nol mutlak.
    expect(labelClean).toBe(refs.length);
    expect(ownClean).toBeGreaterThanOrEqual(7);
  });

  test("hover entri legenda menaruh kartu di titiknya, bukan di legenda (§6.2)", async ({ page }) => {
    await page.goto("/");
    const legend = page.getByTestId("legend-IDXFINANCE");
    await legend.hover();
    const card = (await page.getByTestId("point-card").boundingBox())!;
    const point = (await page.getByTestId("point-IDXFINANCE").boundingBox())!;
    const centre = { x: point.x + point.width / 2, y: point.y + point.height / 2 };
    // kartu berada di dekat titik (≤ 300 px) dan bukan di area legenda
    expect(Math.abs(card.x - centre.x)).toBeLessThan(300);
    expect(Math.abs(card.y - centre.y)).toBeLessThan(320);
    await expect(page.getByTestId("point-card")).toBeVisible();
  });
});
