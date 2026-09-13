import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateDependencyLock } from "./dependency-lock.mjs";

const manifest = { private: true, dependencies: { example: "1.0.0" }, overrides: {} };
const lock = { lockfileVersion: 3, packages: {
  "": { dependencies: { example: "1.0.0" } },
  "node_modules/example": { version: "1.0.0", resolved: "https://registry.npmjs.org/example/-/example-1.0.0.tgz" },
} };

test("accepts a portable lock and equivalent manifests regardless of key order", () => {
  validateDependencyLock(manifest, { overrides: {}, dependencies: { example: "1.0.0" }, private: true }, lock);
});
test("dependency and override changes require explicit lock refresh", () => {
  for (const changed of [
    { ...manifest, dependencies: { example: "2.0.0" } },
    { ...manifest, overrides: { example: "2.0.0" } },
  ]) assert.throws(() => validateDependencyLock(changed, manifest, lock), /runtime:lock/);
  assert.throws(() => validateDependencyLock(manifest, manifest, { ...lock, packages: { "": { dependencies: {} } } }), /runtime:lock/);
});
test("cannot distribute lockfiles captured as local workspace links", () => {
  for (const entry of [{ link: true, resolved: "../workspace" }, { resolved: "file:/Users/test/package" }, { extraneous: true }]) {
    assert.throws(() => validateDependencyLock(manifest, manifest, { ...lock, packages: { ...lock.packages, "node_modules/local": entry } }), /non-distributable/);
  }
});

test("committed distribution lock retains native dependencies for all platforms", () => {
  const recorded = JSON.parse(readFileSync(new URL("../../runtime-deps/package.json", import.meta.url), "utf8"));
  const committed = JSON.parse(readFileSync(new URL("../../runtime-deps/package-lock.json", import.meta.url), "utf8"));
  validateDependencyLock(recorded, recorded, committed);
  const packages = committed.packages;
  function resolves(location, name) {
    for (;;) {
      if (packages[`${location ? location + "/" : ""}node_modules/${name}`]) return true;
      if (!location) return false;
      const index = location.lastIndexOf("/node_modules/");
      location = index < 0 ? "" : location.slice(0, index);
    }
  }
  for (const [location, entry] of Object.entries(packages)) {
    for (const name of Object.keys(entry.optionalDependencies ?? {})) {
      assert.ok(resolves(location, name), `${location} is missing optional dependency ${name}`);
    }
  }
});

test('distribution rejects local plugin dependencies while profile links stay independent', async () => {
  const fs = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { validatePluginBuildSources } = await import('./dependency-lock.mjs');
  const root = await fs.mkdtemp(join(tmpdir(), 'plugin-build-sources-'));
  try {
    const directory = join(root, 'plugins/example');
    const published = join(root, 'node_modules/.pnpm/example-lib@1.0.0/node_modules/example-lib');
    const local = join(root, 'local/example-lib');
    await fs.mkdir(published, { recursive: true });
    await fs.mkdir(local, { recursive: true });
    await fs.mkdir(join(directory, 'node_modules'), { recursive: true });
    const link = join(directory, 'node_modules/example-lib');
    await fs.symlink(published, link, 'junction');
    const manifest = { name: 'dsh-plugin-example', dependencies: { 'example-lib': '1.0.0' } };
    // A profile may freely link a plugin without changing the app build's sources.
    await fs.mkdir(join(root, 'profile/node_modules'), { recursive: true });
    await fs.symlink(local, join(root, 'profile/node_modules/example-lib'), 'junction');
    await validatePluginBuildSources(root, [{ directory, manifest }]);
    await fs.rm(link);
    await fs.symlink(local, link, 'junction');
    await assert.rejects(validatePluginBuildSources(root, [{ directory, manifest }]), /local development package/);
    const archiveInstall = join(root, 'node_modules/.pnpm/example-lib@file+vendor+example.tgz/node_modules/example-lib');
    await fs.mkdir(archiveInstall, { recursive: true });
    await fs.rm(link);
    await fs.symlink(archiveInstall, link, 'junction');
    await assert.rejects(validatePluginBuildSources(root, [{ directory, manifest }]), /local development package/);
    manifest.dependencies['example-lib'] = 'file:../local';
    await assert.rejects(validatePluginBuildSources(root, [{ directory, manifest }]), /local dependency/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});


test('Intel Mac pins a shipped native ONNX build without changing other targets', async () => {
  const { memoryPeerOverrides } = await import('./npm-overrides.mjs');
  assert.equal(memoryPeerOverrides('0.1.1-rc.2', 'darwin-x64')['onnxruntime-node'], '1.22.0');
  for (const target of ['darwin-arm64', 'win32-x64']) assert.equal(memoryPeerOverrides('0.1.1-rc.2', target)['onnxruntime-node'], undefined);
  const manifest = JSON.parse(readFileSync(new URL('../../runtime-deps/darwin-x64/package.json', import.meta.url), 'utf8'));
  const locked = JSON.parse(readFileSync(new URL('../../runtime-deps/darwin-x64/package-lock.json', import.meta.url), 'utf8'));
  validateDependencyLock(manifest, manifest, locked);
  assert.deepEqual(manifest.overrides, memoryPeerOverrides('0.1.1-rc.2', 'darwin-x64'));
  const engines = Object.entries(locked.packages).filter(([name]) => name.endsWith('node_modules/onnxruntime-node'));
  assert.ok(engines.length > 0);
  for (const [, engine] of engines) assert.equal(engine.version, '1.22.0');
});


test('published pet packages stay aligned in both distribution locks', () => {
  const read = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
  const pet = read('../../../../plugins/dsh-plugin-pets/package.json');
  for (const target of ['', 'darwin-x64/']) {
    const manifest = read(`../../runtime-deps/${target}package.json`);
    const lock = read(`../../runtime-deps/${target}package-lock.json`);
    for (const name of ['@mofli/core', '@mofli/grove', '@mofli/studio']) {
      const version = pet.dependencies[name];
      assert.match(version, /^\d+\.\d+\.\d+$/);
      assert.equal(manifest.dependencies[name], version);
      assert.equal(lock.packages[''].dependencies[name], version);
      const entries = Object.entries(lock.packages).filter(([location]) => location.endsWith(`node_modules/${name}`));
      assert.ok(entries.length > 0, `${target}${name} missing`);
      for (const [, entry] of entries) {
        assert.equal(entry.version, version);
        assert.ok(entry.resolved.startsWith('https://registry.npmjs.org/'), entry.resolved);
      }
    }
  }
});
