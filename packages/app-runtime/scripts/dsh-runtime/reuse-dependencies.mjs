import {createHash} from "node:crypto";

/** Allow only promotions of already-installed exact versions to direct dependencies.
 * Removals, range additions, changed versions and changed overrides still require install.
 */
export async function canReuseAddedDependencies(previous, next, installedVersion) {
  const {dependencies: before = {}, ...beforeConfig} = previous;
  const {dependencies: after = {}, ...afterConfig} = next;
  if (JSON.stringify(beforeConfig) !== JSON.stringify(afterConfig)) return false;
  for (const [name, version] of Object.entries(before)) if (after[name] !== version) return false;
  for (const [name, version] of Object.entries(after)) {
    if (name in before) continue;
    if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) return false;
    if (await installedVersion(name) !== version) return false;
  }
  return true;
}

/** npm's dependency lock does not describe our applied pnpm patches. */
export async function patchSetDigest(patches, readPatch) {
  const entries = await Promise.all(Object.entries(patches).sort(([a],[b])=>a.localeCompare(b)).map(async ([specifier,file])=>[specifier,await readPatch(file)]));
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}
export function canReusePatchSet(marker, digest) {
  return typeof marker.patchSetHash === "string" && marker.patchSetHash === digest;
}
