import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * F11 — a11y otomatis: axe WCAG 2 A/AA (0 violation) di kedua tema untuk semua halaman,
 * plus `prefers-reduced-motion`. Dijalankan terhadap dev server + MSW (bukan backend nyata).
 */
const PAGES = ["/", "/sectors", "/stocks", "/stocks/BBRI", "/weekly", "/status", "/data"] as const;
const THEMES = ["dark", "light"] as const;

/** Ringkas saja: id + dampak + node yang kena, supaya laporan gagal bisa langsung dibaca. */
function summarize(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]) {
  return violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => n.target.join(" ")),
  }));
}

for (const theme of THEMES) {
  for (const path of PAGES) {
    test(`@a11y axe bersih (WCAG2AA) — ${theme} ${path}`, async ({ page }) => {
      // tema dipasang sebelum paint supaya tidak ada kedip + axe mengukur tema yang benar
      await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();

      expect(summarize(results.violations)).toEqual([]);
      // tema benar-benar terpasang (kalau tidak, tes di atas mengukur tema yang sama dua kali)
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    });
  }
}

test("@a11y tidak ada CLS saat skeleton berganti data (jaringan diperlambat)", async ({ page }) => {
  // catat pergeseran tata letak sejak sebelum React mount
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  // perbesar jendela skeleton → konten supaya pergeseran (kalau ada) benar-benar terukur
  await page.route("**/api/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });

  await page.goto("/");
  // tunggu data (bukan asersi ketepatan): dengan 6 worker + delay 400 ms, 10 s bawaan terlalu ketat
  await expect(page.locator("[data-testid^=sector-row-]")).toHaveCount(11, { timeout: 30_000 });
  await page.waitForTimeout(1200);

  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  console.log(`CLS / = ${cls}`);
  expect(cls).toBeLessThan(0.1); // ambang "baik" Core Web Vitals
});

test("prefers-reduced-motion: transisi panel & titik jadi 0, tidak ada animasi berjalan", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // token gerak runtuh ke 0 (tokens.css) → tidak ada animasi lebar sidebar/panel
  const motion = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      panel: style.getPropertyValue("--motion-panel").trim(),
      hover: style.getPropertyValue("--motion-hover").trim(),
    };
  });
  expect(motion).toEqual({ panel: "0ms", hover: "0ms" });

  // panel yang memakainya juga benar-benar 0 detik, dan tidak ada animasi CSS yang jalan
  await page.getByRole("button", { name: "Tutup label menu" }).click();
  const durations = await page.evaluate(() => {
    const durations = [...document.querySelectorAll("aside, [role=dialog]")].map(
      (el) => getComputedStyle(el).transitionDuration,
    );
    return { durations, running: document.getAnimations().length };
  });
  expect(durations.durations.every((value) => value === "0s")).toBe(true);
  expect(durations.running).toBe(0);

  // titik RRG tidak dianimasikan (opasitasnya murni atribut)
  const points = await page.evaluate(() =>
    [...document.querySelectorAll("[data-testid^=point-]")].map((el) => {
      const style = getComputedStyle(el);
      return `${style.animationName}/${style.transitionDuration}`;
    }),
  );
  expect(points.length).toBeGreaterThan(0);
  expect(points.every((value) => value === "none/0s")).toBe(true);
});
