import { expect, test } from "@playwright/test";

/**
 * F4 — QuadrantChart: mode fokus, pin, keyboard. Diukur dari atribut DOM
 * (`opacity`, `r`, `aria-activedescendant`), bukan dari screenshot.
 */
test.describe("QuadrantChart RRG", () => {
  test("mode fokus: hover meredupkan titik & ekor lain, garis 100 dan zona tetap", async ({ page }) => {
    await page.goto("/");
    const chart = page.getByTestId("rrg-chart");
    await expect(chart).toBeVisible();

    // 1) normal: semua titik penuh, ekor bertingkat 0,25 → 1
    await expect(page.getByTestId("point-IDXFINANCE")).toHaveAttribute("opacity", "1");
    await expect(page.getByTestId("point-IDXHEALTH")).toHaveAttribute("opacity", "1");
    await expect(page.getByTestId("tail-IDXFINANCE-0")).toHaveAttribute("opacity", "0.25");
    await expect(page.getByTestId("tail-IDXFINANCE-1")).toHaveAttribute("opacity", "1");
    await expect(page.getByTestId("point-IDXFINANCE")).toHaveAttribute("r", "7");
    await expect(page.getByTestId("rrg-focused")).toHaveCount(1);
    await expect(chart.locator("[data-testid=rrg-focused] > g")).toHaveCount(0);

    // 2) hover satu titik → mode fokus
    await page.getByTestId("point-IDXFINANCE").hover();
    await expect(page.getByTestId("point-IDXFINANCE")).toHaveAttribute("opacity", "1");
    await expect(page.getByTestId("point-focus-IDXFINANCE")).toHaveAttribute("r", "8");
    await expect(page.getByTestId("point-IDXHEALTH")).toHaveAttribute("opacity", "0.22");
    await expect(page.getByTestId("tail-IDXHEALTH-0")).toHaveAttribute("opacity", "0.18");
    await expect(page.getByTestId("label-IDXFINANCE")).toHaveCount(1);
    await expect(page.getByTestId("label-IDXHEALTH")).toHaveCount(0);

    // garis 100 & zona kuadran tidak ikut meredup
    await expect(page.getByTestId("axis-100-x")).toHaveAttribute("opacity", "1");
    await expect(page.getByTestId("axis-100-y")).toHaveAttribute("opacity", "1");
    for (const zone of ["leading", "weakening", "lagging", "improving"]) {
      await expect(page.getByTestId(`zone-${zone}`)).toHaveAttribute("opacity", "1");
    }

    // titik terfokus digambar paling akhir (z-order)
    expect(
      await chart.locator(":scope > g").last().evaluate((node) => node.getAttribute("data-testid")),
    ).toBe("rrg-focused");

    // 3) mouse keluar chart tanpa pin → kembali normal
    await page.mouse.move(5, 5);
    await expect(page.getByTestId("point-IDXHEALTH")).toHaveAttribute("opacity", "1");
  });

  test("pin bertahan saat mouse keluar, dilepas oleh klik area kosong", async ({ page }) => {
    await page.goto("/");
    const chart = page.getByTestId("rrg-chart");
    await page.getByTestId("point-IDXFINANCE").click();
    await expect(page.getByTestId("rrg-chart")).toHaveAttribute("data-pinned", "IDXFINANCE");

    await page.mouse.move(5, 5);
    await expect(page.getByTestId("point-IDXFINANCE")).toHaveAttribute("opacity", "1");
    await expect(page.getByTestId("point-IDXHEALTH")).toHaveAttribute("opacity", "0.22");

    // klik area kosong di dalam chart (pojok padding, di luar area plot)
    await chart.click({ position: { x: 10, y: 10 } });
    await expect(page.getByTestId("rrg-chart")).toHaveAttribute("data-pinned", "");
    await expect(page.getByTestId("point-IDXHEALTH")).toHaveAttribute("opacity", "1");
  });

  test("keyboard: Tab masuk → titik pertama, panah pindah, Enter pin, Esc lepas + fokus kembali", async ({
    page,
  }) => {
    await page.goto("/");
    const chart = page.getByTestId("rrg-chart");
    const themeToggle = page.getByRole("button", { name: /Ganti ke tema/ });

    await expect(page.getByTestId("rrg-live")).toHaveText("");

    // Urutan tab dari elemen sebelum chart: toggle tema → pill kesegaran → chart
    await themeToggle.focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: /sektor tipis|delay|data \d/ })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(chart).toBeFocused();
    await expect(chart).toHaveAttribute("aria-activedescendant", "rrg-point-IDXFINANCE");
    await expect(page.getByTestId("rrg-live")).toHaveText(
      "Keuangan — Memimpin, RS-Ratio 102,31, RS-Momentum 100,84",
    );

    // focus ring 2px memakai token --focus
    const ring = page.getByTestId("focus-ring");
    await expect(ring).toHaveAttribute("stroke-width", "2");
    const expectedFocus = await page.evaluate(() => {
      const probe = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      probe.setAttribute("style", "stroke: var(--focus)");
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).stroke;
      probe.remove();
      return value;
    });
    expect(await ring.evaluate((node) => getComputedStyle(node).stroke)).toBe(expectedFocus);

    // panah pindah titik + mode fokus ikut pindah + fokus DOM tetap di chart
    await page.keyboard.press("ArrowRight");
    await expect(chart).toHaveAttribute("aria-activedescendant", "rrg-point-IDXHEALTH");
    await expect(page.getByTestId("rrg-live")).toContainText("Kesehatan");
    await expect(page.getByTestId("point-IDXFINANCE")).toHaveAttribute("opacity", "0.22");
    await expect(chart).toBeFocused();

    // Enter = pin
    await page.keyboard.press("Enter");
    await expect(chart).toHaveAttribute("data-pinned", "IDXHEALTH");

    // Esc = lepas pin + fokus kembali ke elemen sebelum chart (pill kesegaran)
    await page.keyboard.press("Escape");
    await expect(chart).toHaveAttribute("data-pinned", "");
    await expect(page.getByRole("button", { name: /sektor tipis|delay|data \d/ })).toBeFocused();
  });

  test("tanpa ekor: hanya titik, tanpa error", async ({ page }) => {
    await page.goto("/playground");
    const panel = page.getByTestId("chart-demo-notail");
    await expect(panel.getByTestId("rrg-chart")).toBeVisible();
    await expect(panel.getByTestId(/^tail-/)).toHaveCount(0);
    await expect(panel.locator("g[data-point]")).toHaveCount(11);
  });

  test("scope saham: 60 titik dipotong jadi 25 + tautan lihat semua", async ({ page }) => {
    await page.goto("/playground");
    const panel = page.getByTestId("chart-demo-stocks");
    const chart = panel.getByTestId("rrg-chart");

    await expect(chart.locator("g[data-point]")).toHaveCount(25);
    await expect(panel.getByTestId("rrg-cap-note")).toContainText("25 dari 60");
    await expect(panel.getByRole("link", { name: "Lihat semua di tabel" })).toHaveAttribute(
      "href",
      "/stocks?sector=IDXFINANCE",
    );
  });
});
