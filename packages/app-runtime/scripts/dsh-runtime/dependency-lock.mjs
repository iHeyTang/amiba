import { isDeepStrictEqual } from "node:util";

/** Validate the distributable npm tree, independently of the workspace pnpm tree. */
export function validateDependencyLock(manifest, recordedManifest, lock) {
  if (!isDeepStrictEqual(manifest, recordedManifest) ||
      !isDeepStrictEqual(manifest.dependencies, lock.packages?.[""]?.dependencies)) {
    throw new Error("Runtime dependencies changed. Run pnpm runtime:lock and commit runtime-deps/package.json and package-lock.json.");
  }
  if (lock.lockfileVersion !== 3) throw new Error("Runtime requires an npm v3 lockfile");
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (!location) continue;
    if (!location.startsWith("node_modules/") || location.split("/").includes("..") || entry.link || entry.extraneous ||
        (entry.resolved && !entry.resolved.startsWith("https://registry.npmjs.org/"))) {
      throw new Error(`Runtime lock contains a non-distributable entry: ${location}`);
    }
  }
}
