import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: {
    // `public/` hanya berisi `mockServiceWorker.js` (MSW): dev tetap menyajikannya dari
    // `publicDir`, tapi build produksi tidak perlu membawanya (F11/C).
    copyPublicDir: false,
  },
  // Uji unit hanya di src/ — spec Playwright (e2e/) dijalankan `npx playwright test`, bukan Vitest.
  test: { include: ["src/**/*.test.ts"] },
});
