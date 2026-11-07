import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // Pure-logic tests run in node. Component tests (.tsx) opt into jsdom with a `@vitest-environment jsdom` comment.
  test: { environment: "node", include: ["tests/**/*.test.{ts,tsx}"] },
});
