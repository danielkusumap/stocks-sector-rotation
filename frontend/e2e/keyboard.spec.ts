import { expect, test, type Page } from "@playwright/test";

/**
 * F11 — keyboard: Tab/Enter/Esc di toolbar, tabel, popover filter, stepper `/data`, dan
 * pemilih pekan `/weekly`; focus ring terlihat di kedua tema. Chart RRG sudah diuji di
 * `rrg.spec.ts` (Tab masuk → panah → Enter pin → Esc lepas) dan drawer di `sector-drawer.spec.ts`.
 */
interface FocusInfo {
  tag: string;
  name: string;
  label: string;
  outlineWidth: string;
  outlineStyle: string;
  outlineColor: string;
}

const focused = (page: Page) =>
  page.evaluate((): FocusInfo => {
    const el = document.activeElement as HTMLElement | null;
    const style = el ? getComputedStyle(el) : null;
    return {
      tag: el?.tagName ?? "",
      // tanda arah sort (▲/▼) dibuang supaya nama tombol header bisa dicocokkan
      name: (el?.textContent?.trim() ?? "").replace(/[▲▼]/g, ""),
      label: el?.getAttribute("aria-label") ?? "",
      outlineWidth: style?.outlineWidth ?? "",
      outlineStyle: style?.outlineStyle ?? "",
      outlineColor: style?.outlineColor ?? "",
    };
  });

/** Tab sampai elemen yang cocok jadi fokus aktif — membuktikan urutannya benar-benar terjangkau. */
async function tabTo(page: Page, match: (info: FocusInfo) => boolean, steps = 30) {
  const seen: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press("Tab");
    const info = await focused(page);
    seen.push(info.name || info.label || info.tag);
    if (match(info)) return info;
  }
  throw new Error(`tidak tercapai lewat Tab (${steps} langkah): ${seen.join(" → ")}`);
}

/** Tunggu aplikasi benar-benar ter-mount (MSW perlu waktu saat mesin sibuk) sebelum menekan Tab. */
const ready = (page: Page) =>
  expect(page.getByRole("navigation", { name: "Menu utama" })).toBeVisible();

const focusToken = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--focus").trim());

for (const theme of ["dark", "light"] as const) {
  test(`focus ring terlihat saat Tab di tema ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await ready(page);
    // tabel harus sudah berisi data: header urut baru ada setelah `sectors/summary` datang
    await expect(page.locator("[data-testid^=sector-row-]")).toHaveCount(11);

    // Tab pertama = tautan "Lewati ke konten" yang baru muncul saat fokus keyboard
    const first = await tabTo(page, (info) => info.name.startsWith("Lewati ke konten"));
    expect(first.outlineWidth).toBe("2px");
    expect(first.outlineStyle).toBe("solid");
    expect(first.outlineColor).toBe(await focusToken(page));

    // dan berlaku juga untuk kontrol di tabel (bukan hanya tautan awal) — anggaran Tab
    // dinaikkan karena topbar kini memuat Timeframe + Jendela (docs/08 F13 B)
    const header = await tabTo(page, (info) => info.name === "RS-Ratio", 40);
    expect(header.label).toBe(""); // hanya teks
    expect(header.outlineWidth).toBe("2px");
    expect(header.outlineColor).toBe(await focusToken(page));
  });
}

test("@slow tabel: Enter di header mengurutkan dan menulis URL (juga saat ditekan cepat dua kali)", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await expect(page.locator("[data-testid^=sector-row-]")).toHaveCount(11);

  await tabTo(page, (info) => info.name === "RS-Ratio", 40);
  await page.keyboard.press("Enter");
  await expect.poll(() => new URL(page.url()).searchParams.get("sort")).toBe("rs_ratio");

  await page.keyboard.press("Enter");
  await expect.poll(() => new URL(page.url()).searchParams.get("dir")).toBe("asc");
  await expect(page.getByRole("columnheader", { name: "RS-Ratio" })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
});

test("@slow popover Filter: Enter membuka, Esc menutup dan fokus kembali ke tombolnya", async ({ page }) => {
  await page.goto("/");
  await ready(page);

  // legenda RRG menambah 11 tombol sebelum tabel → anggaran Tab dinaikkan
  const trigger = await tabTo(page, (info) => info.name.startsWith("Filter"), 60);
  expect(trigger.tag).toBe("BUTTON");
  await page.keyboard.press("Enter");
  // chip kuadran dicari di dalam popover: legenda RRG juga memuat label kuadran
  await expect(page.getByRole("dialog").getByRole("button", { name: "Membaik" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Filter/ })).toBeFocused();
});

test("@slow /data: stepper terjangkau Tab, Enter di tombol 1 membuka pemilih berkas", async ({ page }) => {
  await page.goto("/data");
  // 8 langkah sejak F17 (analisa teknikal + refresh tampilan)
  await expect(page.locator("ol > li")).toHaveCount(8);

  // dua langkah baru menambah elemen fokusable → anggaran Tab dinaikkan
  const picks = await tabTo(page, (info) => info.name === "Pilih file & import", 60);
  expect(picks.outlineWidth).toBe("2px");

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.keyboard.press("Enter"),
  ]);
  expect(chooser.isMultiple()).toBe(false);
});

test("@slow /weekly: pemilih pekan bisa dibuka & dipilih dengan keyboard", async ({ page }) => {
  await page.goto("/weekly");
  await expect(page.getByTestId("weekly-picks")).toBeVisible();

  const trigger = await tabTo(page, (info) => info.label === "Pekan", 40);
  expect(trigger.outlineWidth).toBe("2px");

  // buka daftar pakai keyboard, lalu batalkan: URL tidak berubah
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option").first()).toBeVisible();
  const before = new URL(page.url()).searchParams.get("week_end");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Pekan" })).toBeFocused();
  expect(new URL(page.url()).searchParams.get("week_end")).toBe(before);

  // pilih pekan berikutnya dengan panah + Enter → `week_end` masuk URL, daftar tertutup
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("week_end")).not.toBe(before);
  expect(new URL(page.url()).searchParams.get("week_end")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
