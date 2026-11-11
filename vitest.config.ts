import { defineConfig } from "vitest/config";
import path from "node:path";

const integration = process.argv.some((a) => a.includes("tests/integration"));

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: { LOG_LEVEL: "silent", BCRYPT_ROUNDS: "4" },
    ...(integration
      ? { setupFiles: ["tests/integration/setup.ts"], globalSetup: ["tests/integration/global-setup.ts"], fileParallelism: false }
      : {}),
  },
});
