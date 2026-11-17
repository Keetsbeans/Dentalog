import { defineConfig } from "vitest/config";

// Unit tests for the shared helpers run in plain Node, without the Workers runtime.
export default defineConfig({
  test: { include: ["shared/**/*.test.ts", "worker/**/*.test.ts"] },
});
