import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["apps/*/src/**/*.ts", "packages/*/src/**/*.ts", "scripts/**/*.mjs"],
      provider: "v8",
      reporter: ["text", "json-summary"],
    },
    include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
