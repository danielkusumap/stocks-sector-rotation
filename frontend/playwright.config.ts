import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke test UI (docs/08 F11, dipasang lebih awal). Dijalankan terhadap dev server
 * + MSW — bukan backend nyata — jadi tidak butuh data hasil ingest.
 */
export default defineConfig({
  testDir: "./e2e",
  // Data sudah mock (MSW) → hambatan sebenarnya cuma serialisasi (docs/08 F24)
  fullyParallel: true,
  workers: process.env.CI ? 2 : "75%",
  forbidOnly: true,
  retries: 0,
  // 30 s (usulan docs/08 F24) terbukti gagal-palsu untuk spec tab-walk saat 6 worker → 60 s
  timeout: 60_000,
  // 5 s (usulan docs/08 F24) terbukti gagal-palsu saat 8 worker → 10 s (lihat ADR)
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
