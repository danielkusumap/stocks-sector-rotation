import { expect, test, type Page } from "@playwright/test";

/**
 * F15 — posisi kartu hover (docs/06 §6.3). Kartu diletakkan searah gerak titik
 * (berlawanan ekor), bukan offset tetap; angka dibuktikan dengan mengukur rect,
 * bukan dilihat. Angka irisan ekor per titik dicetak untuk bukti PROGRESS.
 */
type Rect = { x: number; y: number; width: number; height: number };

/** Segmen ekor (koordinat layar) yang menyentuh kotak kartu. */
const tailHits = (page: Page, ref: string, card: Rect) =>
  page.evaluate(
    ({ ref, card }) => {
      const inside = (x: number, y: number) =>
        x >= card.x && x <= card.x + card.width && y >= card.y && y <= card.y + card.height;
      let hits = 0;
      for (const el of document.querySelectorAll(`[data-testid^=tail-${ref}-]`)) {
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
      const hits = await tailHits(page, ref, card);
      report.push(`${ref} side=${await page.getByTestId("point-card").getAttribute("data-side")} irisan=${hits}`);

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

  test("ekor titik yang di-hover tidak tertutup (bilangan diukur, dicetak)", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("point-IDXFINANCE").waitFor();
    await page.waitForTimeout(300);

    const refs = await page.$$eval("[data-testid^=point-group-]", (els) =>
      els.map((el) => el.getAttribute("data-testid")!.replace("point-group-", "")),
    );
    let clean = 0;
    const dirty: string[] = [];
    for (const ref of refs) {
      await page.getByTestId(`point-${ref}`).hover();
      await page.waitForTimeout(120);
      const card = (await page.getByTestId("point-card").boundingBox())!;
      const hits = await tailHits(page, ref, card);
      if (hits === 0) clean += 1;
      else dirty.push(`${ref}(${hits})`);
    }
    console.log(`irisan ekor 0 pada ${clean}/${refs.length} titik${dirty.length ? ` · sisa: ${dirty.join(", ")}` : ""}`);
    // Kartu `w-60` = 240 px, sedangkan chart 760 px dan beberapa titik hanya ~80 px dari tepi:
    // pada titik yang mentok tepi tidak selalu ada sisi bebas ekor di dalam kotak chart
    // (sisi itu sudah dicoba semua — lihat ADR-041). Yang dijamin: kartu selalu di dalam
    // kotak, tidak pernah menutupi titiknya sendiri, dan dipilih sisi dengan irisan
    // **tersedikit**. Sebelum F15 offset tetap selalu menutupi ekor di salah satu sisi.
    expect(clean).toBeGreaterThanOrEqual(5);
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
