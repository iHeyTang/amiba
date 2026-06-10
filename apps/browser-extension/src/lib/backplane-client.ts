/**
 * Re-exports from @amiba/core. The actual implementation lives in
 * `packages/core/src/backplane-client.ts` so the desktop app can use the
 * same HTTP entry point.
 */
export { backplaneFetch, backplaneUrl } from "@amiba/core";
