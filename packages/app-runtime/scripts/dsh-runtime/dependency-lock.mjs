import { isDeepStrictEqual } from "node:util";

/** Validate the distributable npm tree, independently of the workspace pnpm tree. */
export function validateDependencyLock(manifest, recordedManifest, lock) {
  if (!isDeepStrictEqual(manifest, recordedManifest) ||
      !isDeepStrictEqual(manifest.dependencies ?? {}, lock.packages?.[""]?.dependencies ?? {}) ||
      !isDeepStrictEqual(manifest.peerDependencies ?? {}, lock.packages?.[""]?.peerDependencies ?? {})) {
    throw new Error("Distribution dependencies changed. Run pnpm runtime:lock and commit the host and plugin distribution manifests and locks.");
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

/** Development links belong to DSH profiles, never to the shipped plugin build. */
export async function validatePluginBuildSources(workspaceDir, plugins) {
  const { realpath } = await import('node:fs/promises');
  const { join, relative, sep, isAbsolute } = await import('node:path');
  const installedRoot = await realpath(join(workspaceDir, 'node_modules'));
  for (const { directory, manifest } of plugins) {
    for (const [name, specifier] of Object.entries(manifest.dependencies ?? {})) {
      if (name.startsWith('@amiba/') && specifier.startsWith('workspace:')) continue;
      if (/^(?:file:|link:|workspace:|\.\.?\/|\/)/.test(specifier))
        throw new Error(`Cannot distribute ${manifest.name}: ${name} is a local dependency. Load development plugins in a DSH profile instead.`);
      const location = await realpath(join(directory, 'node_modules', name));
      const inside = relative(installedRoot, location);
      if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside) || /@(?:file|link)\+/.test(inside))
        throw new Error(`Cannot distribute ${manifest.name}: ${name} resolves to a local development package. Restore registry dependencies before building Amiba.`);
    }
  }
}
