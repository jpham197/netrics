import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.e2e.test.{ts,tsx}"],
    environment: "node",
    testTimeout: 30000,
  },
});
