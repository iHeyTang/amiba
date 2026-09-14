import YAML from 'yaml';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pluginInstallManifest, checkHostContract, isolatePluginDependencies, distributionHashes } from './plugin-distribution.mjs';
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

test('changing or removing a plugin invalidates runtime dependency reuse even when the host is unchanged', () => {
  const before = distributionHashes('host', 'host-lock', ['pet-v1', 'memory-v1']);
  for (const locks of [['pet-v2', 'memory-v1'], ['memory-v1']]) {
    const after = distributionHashes('host', 'host-lock', locks);
    assert.notEqual(after.appTreeHash, before.appTreeHash);
    assert.notEqual(after.dependencyLockHash, before.dependencyLockHash);
  }
});

test('static resource packages retain files without retaining an unused executable graph', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-assets-'));
  try {
    for (const [name, manifest] of Object.entries({studio:{dependencies:{devserver:'1.0.0'}},devserver:{}})) {
      const folder=path.join(dir,'node_modules',name); fs.mkdirSync(folder,{recursive:true});
      fs.writeFileSync(path.join(folder,'package.json'),JSON.stringify({name,version:'1.0.0',...manifest}));
    }
    fs.writeFileSync(path.join(dir,'node_modules/studio/index.html'),'<h1>Studio</h1>');
    isolatePluginDependencies(dir,{name:'pet',dependencies:{studio:'1.0.0'}},{packages:{}},{assetDependencies:['studio']});
    assert.equal(fs.readFileSync(path.join(dir,'node_modules/studio/index.html'),'utf8'),'<h1>Studio</h1>');
    assert.ok(!fs.existsSync(path.join(dir,'node_modules/devserver')));
    assert.notEqual(distributionHashes('host','lock',['pet'],[{}]).appTreeHash,distributionHashes('host','lock',['pet'],[{assetDependencies:['studio']}]).appTreeHash);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('a stable peer range does not implicitly accept a prerelease host', () => {
  assert.throws(() => checkHostContract({name:'example',peerDependencies:{framework:'^1.0.0'}},{packages:{'node_modules/framework':{version:'1.1.0-beta.1'}}}), /does not satisfy/);
});
