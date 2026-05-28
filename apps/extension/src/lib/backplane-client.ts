/**
 * Re-exports from @hermes-x/core. The actual implementation lives in
 * `packages/core/src/backplane-client.ts` so the desktop app can use the
 * same HTTP entry point.
 */
export { backplaneFetch, backplaneUrl } from "@hermes-x/core";
