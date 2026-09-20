import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageRuntime, exclusionReason } from './package-content.mjs';
test('package pruning keeps memory engines, target binaries and plugin installation tools', async () => {
  for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64']) {
    const [platform, arch] = target.split('-');
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'amiba-prune-'));
    try {
      const source = path.join(temp, 'original'), dest = path.join(temp, 'staged');
      const keep = ['node/include/node/node.h', 'node/lib/node_modules/npm/bin/npm-cli.js', 'app/node_modules/pnpm/bin/pnpm.cjs', 'app/node_modules/@memtensor/memos-local-plugin/dist/core/index.js', 'app/node_modules/onnxruntime-web/dist/ort-wasm.wasm', `app/node_modules/onnxruntime-node/bin/napi-v6/${platform}/${arch}/onnxruntime_binding.node`, 'app/node_modules/geo/world.map', 'app/LICENSE'];
      const remove = ['.cache/npm/download', 'app/node_modules/pkg/index.js.map', `app/node_modules/onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node`, `app/node_modules/onnxruntime-node/bin/napi-v6/${platform}/${arch === 'x64' ? 'arm64' : 'x64'}/onnxruntime_binding.node`];
      for (const name of [...keep, ...remove]) { const p = path.join(source, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'fixture'); }
      fs.writeFileSync(path.join(source, 'runtime-manifest.json'), JSON.stringify({ platform, arch }));
      const report = await stageRuntime(source, dest, target);
      for (const name of keep) assert.ok(fs.existsSync(path.join(dest, name)), name);
      for (const name of remove) { assert.ok(!fs.existsSync(path.join(dest, name)), name); assert.ok(fs.existsSync(path.join(source, name)), 'source must be untouched'); }
      assert.equal(report.removedFiles, remove.length);
      assert.equal(report.sourceBytes - report.stagedBytes, remove.length * 7);
      await assert.rejects(() => stageRuntime(source, source, target), /separate/);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  }
});
test('only known debug maps are removed, and ONNX architecture matching is exact', () => {
  assert.equal(exclusionReason('app/world.map', 'darwin-arm64'), undefined);
  assert.equal(exclusionReason('app/client.js.map', 'darwin-arm64'), 'source-map');
  assert.equal(exclusionReason('app/node_modules/onnxruntime-node/dist/binding.js', 'win32-x64'), undefined);
});

test('builder 25 exclusions work with real workspace paths as well as node_modules paths', async () => {
  const { createRequire } = await import('node:module');
  const { packageExclusions } = await import('./package-content.mjs');
  const { fileURLToPath } = await import('node:url');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const require = createRequire(fs.realpathSync(path.join(root, 'apps/desktop/node_modules/electron-builder/package.json')));
  const { FileMatcher } = require('app-builder-lib/out/fileMatcher.js');
  const filter = new FileMatcher(root, root, value => value, ['**/*', ...packageExclusions]).createFilter();
  const fileStat = { isDirectory: () => false };
  for (const relative of [
    'packages/app-runtime/resources/dsh-runtime/node/bin/node',
    'node_modules/@amiba/app-runtime/resources/dsh-runtime/node/bin/node',
    'packages/app-runtime/.cache/npm/tarball',
    'node_modules/example/dist/index.js.map',
    'node_modules/@amiba/app-runtime/README.zh-CN.md',
    'node_modules/@amiba/ui/src/index.ts',
  ]) {
    assert.equal(filter(path.join(root, relative), fileStat), false, relative);
  }
  // No workspace package may be packed, in either path form: electron-vite
  // inlines them into the app bundles, and builder's `asarUnpack` filter
  // resolves their pnpm links to these real paths and throws on any file
  // outside the app directory. Derived from disk so a new workspace package
  // cannot silently reintroduce the failure.
  const workspacePackages = [];
  for (const scope of ['packages', 'plugins']) {
    for (const entry of fs.readdirSync(path.join(root, scope))) {
      if (fs.existsSync(path.join(root, scope, entry, 'package.json'))) workspacePackages.push(`${scope}/${entry}`);
    }
  }
  assert.ok(workspacePackages.length > 5, `expected workspace packages, found ${workspacePackages.length}`);
  for (const workspacePackage of workspacePackages) {
    for (const file of ['package.json', 'README.zh-CN.md', 'src/index.ts']) {
      const relative = `${workspacePackage}/${file}`;
      assert.equal(filter(path.join(root, relative), fileStat), false, relative);
    }
  }
  for (const relative of ['apps/desktop/out/main/index.js', 'apps/desktop/package.json', 'node_modules/ws/index.js', 'node_modules/node-pty/build/Release/pty.node']) {
    assert.equal(filter(path.join(root, relative), fileStat), true, relative);
  }
});

test('runtime CLI links remain usable after moving the package off the build machine', { skip: process.platform === 'win32' }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'amiba-portable-links-'));
  try {
    const source = path.join(temp, 'source'), destination = path.join(temp, 'package');
    fs.mkdirSync(path.join(source, 'app/node_modules/.bin'), { recursive: true });
    fs.writeFileSync(path.join(source, 'runtime-manifest.json'), JSON.stringify({ platform: 'darwin', arch: 'arm64' }));
    const cli = path.join(source, 'app/cli.js'), link = path.join(source, 'app/node_modules/.bin/cli');
    fs.writeFileSync(cli, 'portable CLI'); fs.symlinkSync(cli, link);
    await stageRuntime(source, destination, 'darwin-arm64');
    assert.equal(fs.readlinkSync(link), cli, 'development runtime is untouched');
    const packagedLink = path.join(destination, 'app/node_modules/.bin/cli');
    assert.ok(!path.isAbsolute(fs.readlinkSync(packagedLink)));
    fs.rmSync(source, { recursive: true });
    assert.equal(fs.readFileSync(packagedLink, 'utf8'), 'portable CLI');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
