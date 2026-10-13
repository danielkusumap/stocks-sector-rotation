import { expect, test, type Page } from "@playwright/test";

/**
 * F8 — `/stocks`: tabel + filter URL + paginasi `limit`/`offset` + pencarian `q` debounce.
 * AC docs/08 F8: paginasi tidak kehilangan baris; `q` kosong tidak mengirim param.
 */
const params = (page: Page) => new URLSearchParams(new URL(page.url()).search);
const rows = (page: Page) => page.locator("[data-testid^=stock-row-]");
const tickers = (page: Page) =>
  page.locator("[data-testid^=stock-row-]").evaluateAll((nodes) =>
    nodes.map((node) => (node.getAttribute("data-testid") ?? "").replace("stock-row-", "")),
  );

test.describe("Halaman Saham", () => {
  test("paginasi limit/offset tidak kehilangan atau menggandakan baris", async ({ page }) => {
    await page.goto("/stocks?limit=10");
    await expect(rows(page)).toHaveCount(10);
    await expect(page.getByTestId("stock-range")).toHaveText("1–10 dari 30");
    await expect(page.getByTestId("stock-page")).toHaveText("halaman 1 dari 3");
    await expect(page.getByTestId("stock-prev")).toBeDisabled();
    const page1 = await tickers(page);

    await page.getByTestId("stock-next").click();
    await expect.poll(() => params(page).get("offset")).toBe("10");
    await expect(page.getByTestId("stock-range")).toHaveText("11–20 dari 30");
    const page2 = await tickers(page);

    await page.getByTestId("stock-next").click();
    await expect(page.getByTestId("stock-range")).toHaveText("21–30 dari 30");
    await expect(page.getByTestId("stock-page")).toHaveText("halaman 3 dari 3");
    await expect(page.getByTestId("stock-next")).toBeDisabled();
    const page3 = await tickers(page);

    // 3 halaman × 10 = 30 ticker unik, tidak ada yang hilang atau dobel
    const all = [...page1, ...page2, ...page3];
    expect(all).toHaveLength(30);
    expect(new Set(all).size).toBe(30);

    // "Sebelumnya" kembali satu halaman, dan offset balik ke 10
    await page.getByTestId("stock-prev").click();
    await expect.poll(() => params(page).get("offset")).toBe("10");
    await expect(page.getByTestId("stock-range")).toHaveText("11–20 dari 30");

    // offset dijepit: offset besar tidak menampilkan tabel kosong
    await page.goto("/stocks?limit=10&offset=999");
    await expect(page.getByTestId("stock-range")).toHaveText("0 dari 30");
  });

  test("pencarian q: debounce 300 ms, kosong tidak mengirim param", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/v1/stocks?")) calls.push(request.url());
    });

    await page.goto("/stocks");
    await expect(rows(page)).toHaveCount(30);
    // tanpa q: param `q` tidak pernah muncul di request
    expect(calls.every((url) => !url.includes("q="))).toBe(true);

    const search = page.getByLabel("Cari ticker atau nama");
    await search.fill("bbr");
    // debounce: param belum masuk sebelum 300 ms
    await page.waitForTimeout(150);
    expect(params(page).get("q")).toBeNull();
    await expect.poll(() => params(page).get("q")).toBe("bbr");
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByTestId("stock-row-BBRI")).toBeVisible();
    expect(calls.at(-1)).toContain("q=bbr");

    // dikosongkan → param `q` hilang dari URL, dan tidak ada request baru yang membawa q
    const before = calls.length;
    await search.fill("");
    await expect.poll(() => params(page).get("q")).toBeNull();
    await expect(rows(page)).toHaveCount(30); // data lama dari cache, tanpa request baru
    expect(calls.slice(before).every((url) => !url.includes("q="))).toBe(true);

    // tidak ada hasil → EmptyState + tombol reset
    await search.fill("zzzz");
    await expect(page.getByText("Tidak ada saham yang cocok")).toBeVisible();
    await page.getByRole("button", { name: "Reset filter" }).click();
    await expect.poll(() => params(page).get("q")).toBeNull();
    await expect(rows(page)).toHaveCount(30);
  });

  test("sorting dari header mengubah sort/dir di URL", async ({ page }) => {
    await page.goto("/stocks");
    await expect(rows(page).first()).toHaveAttribute("data-testid", "stock-row-BBRI"); // skor desc

    await page.getByRole("button", { name: "Ticker", exact: true }).click();
    await expect.poll(() => params(page).get("sort")).toBe("ticker");
    expect(params(page).get("dir")).toBeNull(); // desc = default
    await expect(rows(page).first()).toHaveAttribute("data-testid", "stock-row-UNVR");

    await page.getByRole("button", { name: "Ticker", exact: true }).click();
    await expect.poll(() => params(page).get("dir")).toBe("asc");
    await expect(rows(page).first()).toHaveAttribute("data-testid", "stock-row-ACES");
    await expect(page.getByRole("columnheader", { name: "Ticker" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );

    // kolom tanpa kunci sort di /stocks tidak bisa diklik
    await expect(page.getByRole("button", { name: "RS-Mom" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "ATR" })).toHaveCount(0);
  });

  test("filter lain lewat URL, dan baris klik membuka detail", async ({ page }) => {
    await page.goto("/stocks?sector=IDXFINANCE");
    await expect(rows(page)).toHaveCount(4); // BBRI, BBCA, BMRI, BBNI
    await expect(page.getByTestId("chip-sector:IDXFINANCE")).toContainText("Keuangan");

    await page.goto("/stocks?min_price_idr=10000");
    await expect(rows(page)).toHaveCount(2); // fixture: hanya 2 saham ≥ Rp 10.000

    await page.goto("/stocks?quadrant=leading");
    await expect(rows(page)).toHaveCount(11); // fixture: 11 saham kuadran Memimpin
    await expect(page.getByTestId("chip-quadrant:leading")).toContainText("Memimpin");

    // klik baris → halaman detail (filter ikut dibawa)
    await page.goto("/stocks");
    await page.getByTestId("stock-row-BBRI").click();
    await expect.poll(() => page.url()).toContain("/stocks/BBRI");
  });
});
