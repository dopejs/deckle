import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["packages/*/src/**/*.ts", "scripts/**/*.mjs"],
      provider: "v8",
      reporter: ["text", "json-summary"],
    },
    include: ["packages/*/src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
