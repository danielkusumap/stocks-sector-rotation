import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  // Uji unit hanya di src/ — spec Playwright (e2e/) dijalankan `npx playwright test`, bukan Vitest.
  test: { include: ["src/**/*.test.ts"] },
});
