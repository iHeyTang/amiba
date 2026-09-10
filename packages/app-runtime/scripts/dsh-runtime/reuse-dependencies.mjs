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
