import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    env: {
      DATABASE_URL: "postgresql://hris:hris@localhost:5433/hris_test",
      JWT_SECRET: "test-secret-test-secret-test-secret-123456",
    },
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // DB tests share one database, so run files one at a time.
    fileParallelism: false,
  },
});
