import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bumpVersion, productVersion, nextVersion, compareVersions } from './version.mjs';
import { assertReleasePolicy } from './release-policy.mjs';
import { artifactName, assertProvenance } from './provenance.mjs';
test('version bumps reset lower components and synchronize product manifests', () => {
  assert.equal(nextVersion('1.9.9', 'patch'), '1.9.10');
  assert.equal(nextVersion('1.9.9', 'minor'), '1.10.0');
  assert.equal(nextVersion('1.9.9', 'major'), '2.0.0');
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  for (const value of ['01.0.0', '1.0', '1.0.0-beta', '1.0.0+build']) assert.throws(() => nextVersion(value, 'patch'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amiba-version-'));
  try {
    fs.mkdirSync(path.join(dir, 'apps/desktop'), { recursive: true });
    for (const file of ['package.json', 'apps/desktop/package.json']) fs.writeFileSync(path.join(dir, file), JSON.stringify({ version: '1.9.9', name: file }));
    assert.equal(bumpVersion('minor', dir), '1.10.0');
    assert.equal(productVersion(dir), '1.10.0');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"version":"1.0.0"}');
    assert.throws(() => productVersion(dir), /differ/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('release preflight rejects stale versions, immutable releases and foreign drafts/tags', () => {
  const commit = 'a'.repeat(40), foreign = 'b'.repeat(40);
  const check = (releases, tagCommit) => assertReleasePolicy({ version: '1.2.0', commit, releases, tagCommit });
  check([{ tag_name: 'v1.1.9', draft: false }]);
  check([{ tag_name: 'v1.2.0', draft: true, target_commitish: commit }], commit);
  for (const tag_name of ['v1.2.0', 'v1.10.0']) assert.throws(() => check([{ tag_name, draft: false }]));
  assert.throws(() => check([{ tag_name: 'v1.2.0', draft: true, target_commitish: foreign }]), /another commit/);
  assert.throws(() => check([], foreign), /another commit/);
});
test('artifact identities distinguish retries and reject missing or dirty provenance', () => {
  assert.equal(artifactName('1.2.0', 'win32-x64', 'test', '123-2'), 'amiba-1.2.0-win32-x64-test-123-2');
  const manifest = { sourceCommit: 'a'.repeat(40), buildId: '123-2', mode: 'release', dirty: false };
  assertProvenance(manifest, manifest.sourceCommit);
  assert.throws(() => assertProvenance({}));
  assert.throws(() => assertProvenance({ ...manifest, dirty: true }));
  assert.throws(() => assertProvenance({ ...manifest, mode: 'test' }));
});
