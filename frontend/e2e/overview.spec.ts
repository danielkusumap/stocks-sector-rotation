import { expect, test } from "@playwright/test";

/**
 * F6 — Ringkasan pasar, peta panas, matriks rotasi.
 * AC: angka heatmap = response `/heatmap`; warna tidak pernah jadi satu-satunya penanda;
 * regime tampil dengan kalimat penjelasan.
 */
test.describe("Overview: ringkasan pasar, heatmap, matriks", () => {
  test("peta panas: angka persis dari response + selalu bertanda", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("heatmap-row-IDXFINANCE")).toBeVisible();

    // nilai fixture: 1d 0,0021 · 1w 0,0181 · 1m 0,0412 · 3m 0,0903
    await expect(page.getByTestId("heatmap-cell-IDXFINANCE-1d")).toHaveText("+0,21%");
    await expect(page.getByTestId("heatmap-cell-IDXFINANCE-1w")).toHaveText("+1,81%");
    await expect(page.getByTestId("heatmap-cell-IDXFINANCE-1m")).toHaveText("+4,12%");
    await expect(page.getByTestId("heatmap-cell-IDXFINANCE-3m")).toHaveText("+9,03%");
    // negatif memakai minus U+2212
    await expect(page.getByTestId("heatmap-cell-IDXENERGY-1w")).toHaveText("\u22124,30%");
    await expect(page.getByTestId("heatmap-cell-IDXENERGY-3m")).toHaveText("\u22127,80%");

    // setiap sel punya angka bertanda → warna bukan satu-satunya penanda
    const texts = await page.locator("[data-testid^=heatmap-cell-]").allTextContents();
    expect(texts).toHaveLength(11 * 4);
    for (const text of texts) {
      expect(text).toMatch(/^[+\u2212]?\d+,\d{2}%$/);
    }
    expect(texts.filter((t) => t.startsWith("+")).length).toBeGreaterThan(0);
    expect(texts.filter((t) => t.startsWith("\u2212")).length).toBeGreaterThan(0);

    // intensitas latar ikut nilai: |3m| Keuangan (9,03%) lebih besar dari |1d| (0,21%)
    const alphaBig = Number(
      await page.getByTestId("heatmap-bg-IDXFINANCE-3m").evaluate((el) => (el as HTMLElement).style.opacity),
    );
    const alphaSmall = Number(
      await page.getByTestId("heatmap-bg-IDXFINANCE-1d").evaluate((el) => (el as HTMLElement).style.opacity),
    );
    expect(alphaBig).toBeGreaterThan(alphaSmall);
    expect(alphaBig).toBeLessThanOrEqual(0.55);
    expect(alphaSmall).toBeGreaterThanOrEqual(0.08);
    // warna latar = token tema (bukan hex dari API): bandingkan dengan nilai token di :root
    const [upToken, downToken] = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      return [styles.getPropertyValue("--up").trim(), styles.getPropertyValue("--down").trim()];
    });
    expect(upToken).not.toBe(downToken);
    await expect(page.getByTestId("heatmap-bg-IDXFINANCE-3m")).toHaveCSS("background-color", upToken);
    await expect(page.getByTestId("heatmap-bg-IDXENERGY-3m")).toHaveCSS("background-color", downToken);
  });

  test("matriks rotasi: 4×4 sel + daftar perubahan kuadran", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("matrix-cell-leading-leading")).toBeVisible();

    await expect(page.locator("[data-testid^=matrix-cell-]")).toHaveCount(16);
    await expect(page.getByTestId("matrix-cell-improving-leading")).toHaveAttribute("data-count", "2");
    await expect(page.getByTestId("matrix-cell-lagging-improving")).toHaveAttribute("data-count", "3");
    await expect(page.getByTestId("matrix-cell-leading-weakening")).toHaveAttribute("data-count", "2");
    // sel tanpa transisi ditandai ·, bukan 0
    await expect(page.getByTestId("matrix-cell-weakening-leading")).toHaveText("·");

    await expect(page.getByTestId("matrix-change-IDXFINANCE")).toContainText("Keuangan");
    await expect(page.getByTestId("matrix-change-IDXFINANCE")).toContainText("Membaik → Memimpin");
    await expect(page.getByTestId("matrix-change-IDXINFRA")).toContainText("Tertinggal → Membaik");
  });

  test("ringkasan pasar: IHSG, breadth, regime + kalimat penjelasan, seri mini", async ({ page }) => {
    await page.goto("/");
    const summary = page.locator("section", { hasText: "Ringkasan Pasar" }).first();

    await expect(summary).toContainText("IHSG");
    await expect(summary).toContainText("5.936,15");
    await expect(summary).toContainText("\u22122,59%"); // ihsg_ret_1d
    await expect(summary).toContainText("7 / 4"); // sectors_up / sectors_down (fixture)
    await expect(summary).toContainText("164 ↑ / 164 ↓"); // breadth
    await expect(summary).toContainText("Risk-on"); // regime dari mock (7 naik vs 4 turun)
    // delta selalu bertanda & pakai minus U+2212 (docs/06 §4)
    await expect(summary).toContainText("IHSG 1 minggu \u22122,04%");

    // regime wajib punya kalimat penjelasan
    const note = page.getByTestId("regime-note");
    await expect(note).toBeVisible();
    await expect(note).toContainText("7 dari 11 sektor naik");

    // mini SectorSeries sektor teratas + legend dua garis
    await expect(page.getByTestId("sector-series")).toBeVisible();
    await expect(page.getByTestId("sector-series-legend")).toContainText("IHSG");
    await expect(page.getByTestId("sector-series-legend")).toContainText(/RS \d/);
    await expect(page.getByTestId("sector-series").locator("polyline")).toHaveCount(2);

    // daftar perubahan kuadran dari briefing
    await expect(page.getByTestId("change-IDXFINANCE")).toContainText("Membaik → Memimpin");
  });

  test("halaman tetap utuh saat data ringkasan gagal (ErrorState, bukan layar putih)", async ({ page }) => {
    // `?mock=fail` membuat hanya /briefing/morning yang gagal (mock dev)
    await page.goto("/?mock=fail");

    await expect(page.getByText(/Coba lagi/).first()).toBeVisible();
    // panel lain tetap tampil
    await expect(page.getByTestId("sector-row-IDXFINANCE")).toBeVisible();
    await expect(page.getByTestId("heatmap-row-IDXFINANCE")).toBeVisible();
  });
});
