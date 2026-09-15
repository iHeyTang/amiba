import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@amiba/dsh-plugin-ui-shell/client": fileURLToPath(new URL("../dsh-plugin-file-preview/src/test/shell.ts", import.meta.url)) } },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
});
