/** Amiba's single application-runtime package boundary. */
export const APP_RUNTIME_PACKAGE = "@amiba/app-runtime";

/**
 * The public subpaths. The root deliberately does not import them: doing so
 * would make a browser-only consumer eagerly link Node, MCP, and Electron-side
 * modules. Consumers import the narrow subpath they actually execute.
 */
export const APP_RUNTIME_MODULES = [
  "core",
  "platform",
  "protocol",
  "dsh-client",
  "dsh-distribution",
  "dsh-runtime",
  "model-plane",
  "model-plane-dsh",
  "utils",
] as const;

export type AppRuntimeModule = (typeof APP_RUNTIME_MODULES)[number];
