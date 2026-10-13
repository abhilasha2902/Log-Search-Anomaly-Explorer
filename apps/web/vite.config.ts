import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// In dev the browser talks only to the Vite server: requests to /api/* are proxied to the
// API with the /api prefix removed. Same origin means the httpOnly auth cookie is stored and
// sent like on any normal site, with no cross-site cookie settings needed. (The API's CORS
// allow-list, CORS_ORIGIN, still covers calling it directly from http://localhost:5173.)
const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: apiTarget,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
