import { defineAmibaConfig } from "./apps/desktop/scripts/desktop-local-config.mjs";

export default defineAmibaConfig({
  hermes: {
    mode: "direct-source",
    source: "/absolute/path/to/hermes-agent",
  },
});
