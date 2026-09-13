import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sourceIdentity } from './provenance.mjs';
import { prepareRelease, checkReleaseConfiguration } from './prepare-release.mjs';
import { publishRelease, checkReleaseAssets } from './publish-release.mjs';

const base = 'a'.repeat(40), next = 'b'.repeat(40);
const env = { GITHUB_REF: 'refs/heads/main', GITHUB_SHA: base, GITHUB_RUN_ID: '123', GITHUB_REPOSITORY: 'owner/repo', CSC_LINK: 'certificate', CSC_KEY_PASSWORD: 'password', APPLE_ID: 'developer@example.com', APPLE_APP_SPECIFIC_PASSWORD: 'app-password', APPLE_TEAM_ID: 'TEAM' };
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amiba-auto-release-'));
  fs.mkdirSync(path.join(directory, 'apps/desktop'), { recursive: true });
  for (const file of ['package.json', 'apps/desktop/package.json']) fs.writeFileSync(path.join(directory, file), JSON.stringify({ name: 'amiba', version: '0.1.0' }));
  return directory;
}

test('missing release configuration fails before requests or version changes', () => {
  let calls = 0;
  assert.throws(() => prepareRelease({ env: { ...env, APPLE_ID: '' }, request: () => calls++ }), /APPLE_ID.*No version was changed/);
  assert.equal(calls, 0);
});

test('release uses the merged version and never mutates repository refs', () => {
  const directory = fixture();
  try {
    let calls = 0;
    const request = (args, input) => {
      calls++;
      assert.deepEqual(args, ['api', 'repos/owner/repo/git/ref/heads/main']);
      assert.equal(input, undefined);
      return JSON.stringify({ object: { sha: base } });
    };
    const options = { env, directory, request, preflight: () => undefined };
    assert.deepEqual(prepareRelease(options), { version: '0.1.0', commit: base });
    assert.deepEqual(prepareRelease(options), { version: '0.1.0', commit: base });
    assert.equal(calls, 2);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'package.json'))).version, '0.1.0');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('stale main and already published versions fail without mutations', () => {
  const directory = fixture();
  try {
    const request = () => JSON.stringify({ object: { sha: next } });
    assert.throws(() => prepareRelease({ env, directory, request, preflight: () => undefined }), /main changed/);
    assert.throws(() => prepareRelease({ env, directory, request: () => JSON.stringify({ object: { sha: base } }), preflight: () => { throw new Error('already published'); } }), /already published/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

const names = ['Amiba-0.1.1-mac-arm64.dmg', 'Amiba-0.1.1-mac-arm64.zip', 'Amiba-0.1.1-mac-x64.dmg', 'Amiba-0.1.1-mac-x64.zip', 'Amiba-0.1.1-win-x64.exe', 'latest-arm64-mac.yml', 'latest-x64-mac.yml', 'latest-x64.yml'];
const releaseFixture = () => ({ id: 1, draft: true, prerelease: false, tag_name: 'v0.1.1', target_commitish: next, html_url: 'https://github.com/owner/repo/releases/tag/v0.1.1', assets: names.map(name => ({ name, state: 'uploaded' })) });

test('publication requires the complete release, generates notes, and is idempotent', () => {
  let release = releaseFixture();
  const mutations = [];
  const request = (args, input) => {
    if (!input) return JSON.stringify([[release]]);
    const body = JSON.parse(input); mutations.push(body);
    if (args[1].endsWith('generate-notes')) return JSON.stringify({ body: 'Generated changelog' });
    assert.equal(body.body, 'Generated changelog');
    assert.equal(body.make_latest, 'true');
    release = { ...release, ...body };
    return JSON.stringify(release);
  };
  const options = { repo: 'owner/repo', version: '0.1.1', commit: next, names, request, preflight: () => undefined };
  assert.equal(publishRelease(options), release.html_url);
  assert.equal(release.draft, false);
  assert.equal(mutations.length, 2);
  assert.equal(publishRelease(options), release.html_url);
  assert.equal(mutations.length, 2, 'published releases must not be patched again');
});

test('missing/extra assets, foreign commits and release-note failures never publish', () => {
  const release = releaseFixture();
  for (const invalid of [{ ...release, assets: release.assets.slice(1) }, { ...release, assets: [...release.assets, { name: 'foreign.exe', state: 'uploaded' }] }, { ...release, target_commitish: base }]) {
    assert.throws(() => checkReleaseAssets(invalid, '0.1.1', next, names));
  }
  let patches = 0;
  assert.throws(() => publishRelease({ repo: 'owner/repo', version: '0.1.1', commit: next, names, preflight: () => undefined, request: (args, input) => {
    if (!input) return JSON.stringify([[release]]);
    if (args.includes('PATCH')) patches++;
    throw new Error('notes service unavailable');
  } }), /notes service unavailable/);
  assert.equal(patches, 0);
});


test('build identity pins the prepared commit rather than the dispatch commit', () => {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(sourceIdentity('test', { GITHUB_SHA: base, AMIBA_RELEASE_COMMIT: head }).sourceCommit, head);
  assert.throws(() => sourceIdentity('test', { GITHUB_SHA: head, AMIBA_RELEASE_COMMIT: base }), /Checkout does not match/);
});


test('unsigned release needs no Apple credentials, while signed release still requires them', () => {
  const unsignedEnv = { GITHUB_REPOSITORY: 'owner/repo' };
  assert.doesNotThrow(() => checkReleaseConfiguration(unsignedEnv, 'unsigned'));
  assert.throws(() => checkReleaseConfiguration(unsignedEnv, 'signed'), /configuration missing/);
  assert.throws(() => checkReleaseConfiguration(unsignedEnv, 'invalid'), /Invalid macOS/);
});
