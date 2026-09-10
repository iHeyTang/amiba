import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    environmentMatchGlobs: [["src/client/**", "jsdom"]],
    setupFiles: ["./src/test/setup.ts"],
  },
});
