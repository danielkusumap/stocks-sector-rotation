import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke test UI (docs/08 F11, dipasang lebih awal). Dijalankan terhadap dev server
 * + MSW — bukan backend nyata — jadi tidak butuh data hasil ingest.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
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
