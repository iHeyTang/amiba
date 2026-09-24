import { mergeConfig } from "vite";
import base from "./vite.config";
export default mergeConfig(base, {
  resolve: {
    alias: {
      "@deepseek-ai/dsh-client-ui-primitives": new URL(
        "./src/dev/official-feature-atoms.tsx",
        import.meta.url,
      ).pathname,
    },
  },
});
