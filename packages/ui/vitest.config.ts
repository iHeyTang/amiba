import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { alias: { "@amiba/dsh-plugin-ui-shell/client": fileURLToPath(new URL("../../plugins/dsh-plugin-file-preview/src/test/shell.ts", import.meta.url)) } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
})
