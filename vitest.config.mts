import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    // Load .env / .env.local (LOCATIONIQ_API_KEY for the live geocoding test).
    env: loadEnv(mode, process.cwd(), ""),
  },
}));
