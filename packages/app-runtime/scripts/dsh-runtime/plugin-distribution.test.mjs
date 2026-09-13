import YAML from 'yaml';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pluginInstallManifest, checkHostContract, isolatePluginDependencies } from './plugin-distribution.mjs';
import { validateDependencyLock } from './dependency-lock.mjs';
const root = new URL('../../../../', import.meta.url);
const catalog = YAML.parse(fs.readFileSync(new URL('pnpm-workspace.yaml', root), 'utf8')).catalog;
const read = relative => JSON.parse(fs.readFileSync(new URL(relative, root)));

test('host lock has no plugin business dependencies and plugin locks match their owners', () => {
  const host = read('packages/app-runtime/host-dependencies.json');
  const hostLock = read('packages/app-runtime/runtime-deps/package-lock.json');
  for (const name of ['@mofli/core', '@mofli/grove', '@mofli/studio', '@memtensor/memos-local-plugin', '@larksuiteoapi/node-sdk', 'dingtalk-stream', 'pdfjs-dist']) {
    assert.equal(host.dependencies[name], undefined);
    assert.equal(hostLock.packages[`node_modules/${name}`], undefined);
  }
  for (const name of fs.readdirSync(new URL('plugins/', root))) {
    const base = `plugins/${name}/`;
    const plugin = read(base + 'package.json');
    if (!fs.existsSync(new URL(base + 'distribution/default/package.json', root))) continue;
    for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64']) {
      const directory = base + `distribution/${plugin.amiba?.distribution?.targets?.[target] ? target : 'default'}/`;
      const recorded = read(directory + 'package.json');
      const lock = read(directory + 'package-lock.json');
      const manifest = pluginInstallManifest(plugin, host, (name, version) => version === 'catalog:' ? catalog[name] : version, target);
      validateDependencyLock(manifest, recorded, lock);
      checkHostContract(manifest, hostLock);
    }
  }
  const intel = read('plugins/dsh-plugin-memory-memos/distribution/darwin-x64/package-lock.json');
  const engines = Object.entries(intel.packages).filter(([name]) => name.endsWith('node_modules/onnxruntime-node'));
  assert.ok(engines.length);
  for (const [, pkg] of engines) assert.equal(pkg.version, '1.22.0');
});

test('plugins resolve private versions independently and share only compatible host instances', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-isolation-'));
  function pkg(relative, name, version, extra = {}) {
    const target = path.join(dir, relative);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name, version, main: 'index.cjs', ...extra }));
    fs.writeFileSync(path.join(target, 'index.cjs'), `module.exports = { version: '${version}' };`);
    return target;
  }
  try {
    pkg('node_modules/react', 'react', '18.3.1');
    const host = { packages: { 'node_modules/react': {version: '18.3.1'} } };
    for (const version of ['1.0.0', '2.0.0']) {
      const rel = `node_modules/plugin-${version}`;
      const plugin = pkg(rel, `plugin-${version}`, version);
      pkg(`${rel}/node_modules/private-lib`, 'private-lib', version, {peerDependencies: {react: '^18.0.0'}});
      pkg(`${rel}/node_modules/react`, 'react', '18.3.1');
      pkg(`${rel}/node_modules/unrelated`, 'unrelated', '1.0.0');
      const manifest = { name: 'plugin', dependencies: {'private-lib': version}, peerDependencies: {react: '^18.0.0'} };
      checkHostContract(manifest, host);
      isolatePluginDependencies(plugin, manifest, host);
      const require = createRequire(path.join(plugin, 'package.json'));
      assert.equal(require('private-lib').version, version);
      assert.equal(require('react'), createRequire(path.join(dir, 'app.cjs'))('react'));
      assert.ok(!fs.existsSync(path.join(plugin, 'node_modules/unrelated')));
    }
    assert.throws(() => checkHostContract({name:'bad',peerDependencies:{react:'^19.0.0'}},host), /does not satisfy/);
    fs.rmSync(path.join(dir, 'node_modules/plugin-1.0.0'), {recursive:true});
    assert.equal(createRequire(path.join(dir,'node_modules/plugin-2.0.0/package.json'))('private-lib').version, '2.0.0');
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
});
