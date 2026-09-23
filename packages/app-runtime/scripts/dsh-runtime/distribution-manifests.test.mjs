import { test } from 'node:test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parse } from 'yaml';
import { validateDependencyLock } from './dependency-lock.mjs';
import { pluginInstallManifest, checkHostContract } from './plugin-distribution.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const runtime = join(root, 'packages/app-runtime');
const host = json(join(runtime, 'host-dependencies.json'));
const hostLock = json(join(runtime, 'runtime-deps/package-lock.json'));
const catalog = parse(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')).catalog;
const resolveCatalog = (name, specifier) => specifier === 'catalog:' ? catalog[name] : specifier;

test('committed host distribution matches its source manifest', () => {
  validateDependencyLock(host, json(join(runtime, 'runtime-deps/package.json')), hostLock);
});

for (const name of readdirSync(join(root, 'plugins'))) {
  const directory = join(root, 'plugins', name);
  if (!existsSync(join(directory, 'distribution/default/package.json'))) continue;
  const plugin = json(join(directory, 'package.json'));
  for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']) {
    test(`${name} committed distribution matches source for ${target}`, () => {
      const manifest = pluginInstallManifest(plugin, host, resolveCatalog, target);
      const variant = plugin.amiba?.distribution?.targets?.[target] ? target : 'default';
      const path = join(directory, 'distribution', variant);
      checkHostContract(manifest, hostLock);
      validateDependencyLock(manifest, json(join(path, 'package.json')), json(join(path, 'package-lock.json')));
    });
  }
}

test('workspace, patched packages and managed host use the selected DSH release', () => {
  const { version } = json(join(runtime, 'dsh-runtime-manifest.json'));
  const workspace = json(join(root, 'package.json'));
  const lock = parse(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'));
  const assertVersion = (name, actual) => {
    if (actual !== version) throw new Error(`${name}: expected DSH ${version}, found ${actual}`);
  };
  for (const [name, spec] of Object.entries(workspace.pnpm.overrides)) {
    if (name.startsWith('@deepseek-ai/dsh')) assertVersion(name, spec);
  }
  for (const name of Object.keys(lock.packages)) {
    if (name.startsWith('@deepseek-ai/dsh')) {
      const resolved = name.slice(name.lastIndexOf('@') + 1).split('(')[0];
      assertVersion(name, resolved);
    }
  }
  for (const [name, entry] of Object.entries(hostLock.packages)) {
    if (/(?:^|\/)node_modules\/@deepseek-ai\/dsh[^/]*$/.test(name)) assertVersion(name, entry.version);
    const frameworkName = name.split('node_modules/').at(-1);
    if (frameworkName === '@deepseek-ai/cordis' && entry.version !== '4.0.2') throw new Error(`${name}: duplicate Cordis version`);
    if (frameworkName === '@deepseek-ai/cordis-plugin-hmr' && entry.version !== '1.0.17') throw new Error(`${name}: HMR patch would be bypassed`);
  }
  for (const name of Object.keys(workspace.pnpm.patchedDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh')) assertVersion(name, name.slice(name.lastIndexOf('@') + 1));
  }
});
