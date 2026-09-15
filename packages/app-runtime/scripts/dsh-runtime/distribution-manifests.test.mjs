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
