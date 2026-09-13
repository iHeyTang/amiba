import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import semver from 'semver';

export function pluginInstallManifest(plugin, host, resolveCatalog, target) {
  const dependencies = {}, peerDependencies = {};
  for (const [name, spec] of Object.entries(plugin.dependencies ?? {})) {
    if (name.startsWith('@amiba/')) continue; // Installed plugin contracts / compiled workspace code.
    const version = resolveCatalog(name, spec);
    (name in host.dependencies ? peerDependencies : dependencies)[name] = version;
  }
  for (const [name, spec] of Object.entries(plugin.peerDependencies ?? {})) {
    if (name.startsWith('@amiba/')) continue;
    if (!(name in host.dependencies)) throw new Error(`${plugin.name}: undeclared host interface ${name}`);
    peerDependencies[name] = resolveCatalog(name, spec);
  }
  const config = plugin.amiba?.distribution ?? {};
  return { name: plugin.name, version: plugin.version, private: true, dependencies,
    peerDependencies, overrides: { ...config.overrides, ...config.targets?.[target]?.overrides } };
}

export function checkHostContract(manifest, hostLock) {
  for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
    const version = hostLock.packages[`node_modules/${name}`]?.version;
    if (!version || !semver.satisfies(version, range))
      throw new Error(`${manifest.name}: host ${name}@${version ?? 'missing'} does not satisfy ${range}`);
  }
}

// npm installs and validates the complete dependency graph first. Keep only the
// private graph in the artifact; host peers resolve through the parent runtime.
// This preserves separate versions inside standalone applications (e.g. Studio).
export function isolatePluginDependencies(directory, manifest, hostLock, policy = {}) {
  const assets = new Set(policy.assetDependencies ?? []);
  for (const name of assets) if (!(name in manifest.dependencies)) throw new Error(`${manifest.name}: asset dependency ${name} must be a direct private dependency`);
  const packages = new Map();
  function inventory(modules) {
    if (!fs.existsSync(modules)) return;
    for (const item of fs.readdirSync(modules, { withFileTypes: true })) {
      if (item.name.startsWith('.') || item.isSymbolicLink()) continue;
      const location = path.join(modules, item.name);
      if (item.name.startsWith('@')) { inventoryScope(location); continue; }
      add(location);
    }
  }
  function inventoryScope(scope) { for (const name of fs.readdirSync(scope)) add(path.join(scope, name)); }
  function add(location) {
    if (!fs.existsSync(path.join(location, 'package.json'))) return;
    packages.set(location, JSON.parse(fs.readFileSync(path.join(location, 'package.json'))));
    inventory(path.join(location, 'node_modules'));
  }
  inventory(path.join(directory, 'node_modules'));
  const keep = new Set();
  const expanded = new Set();
  function resolve(from, name) {
    for (let current = from; current.startsWith(directory); current = path.dirname(current)) {
      const candidate = path.join(current, 'node_modules', name);
      if (packages.has(candidate)) return candidate;
      if (current === directory) break;
    }
  }
  function visit(from, name, range, optional = false) {
    const location = resolve(from, name);
    const installed = packages.get(location);
    const shared = hostLock.packages[`node_modules/${name}`];
    const owner = packages.get(from);
    const requiredRange = policy.overrides?.[`${owner?.name}@${owner?.version}`]?.[name] ?? range;
    const hostInterface = name in (manifest.peerDependencies ?? {}) || name in (hostLock.packages['']?.dependencies ?? {});
    if (hostInterface && shared && (name.startsWith('@deepseek-ai/') || !installed || installed.version === shared.version) && semver.satisfies(shared.version, requiredRange)) return;
    if (hostInterface && name.startsWith('@deepseek-ai/')) throw new Error(`${manifest.name}: incompatible host dependency ${name}@${range}`);
    if (!installed) {
      if (optional) return;
      throw new Error(`${manifest.name}: missing private dependency ${name} from ${from}`);
    }
    if (expanded.has(location)) return;
    keep.add(location);
    if (from === directory && assets.has(name)) return;
    expanded.add(location);
    for (const [child, spec] of Object.entries(installed.dependencies ?? {})) visit(location, child, spec, child in (installed.optionalDependencies ?? {}));
    for (const [child, spec] of Object.entries(installed.optionalDependencies ?? {})) visit(location, child, spec, true);
    for (const [child, spec] of Object.entries(installed.peerDependencies ?? {})) visit(location, child, spec, installed.peerDependenciesMeta?.[child]?.optional);
  }
  for (const [name, range] of Object.entries(manifest.dependencies)) visit(directory, name, range);
  // Deepest first, preserving nested packages until their own reachability is known.
  for (const location of [...packages.keys()].sort((a,b) => b.length-a.length)) {
    if (!keep.has(location)) fs.rmSync(location, { recursive: true, force: true });
  }
  function cleanLinks(current) {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isSymbolicLink()) { if (!fs.existsSync(filename)) fs.unlinkSync(filename); }
      else if (entry.isDirectory()) cleanLinks(filename);
    }
  }
  cleanLinks(path.join(directory, 'node_modules'));
  return [...keep].map(location => path.relative(directory, location));
}

export function distributionHashes(hostManifest, hostLock, pluginLocks, policies = []) {
  const dependencyLockHash = createHash('sha256').update(hostLock).update(pluginLocks.join('\0')).update(JSON.stringify(policies)).digest('hex');
  const appTreeHash = createHash('sha256').update(hostManifest).update(dependencyLockHash).digest('hex');
  return { dependencyLockHash, appTreeHash };
}
