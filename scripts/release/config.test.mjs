import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseSettings, githubRepository } from './config.mjs';
test('CDN first and GitHub fallback with architecture-isolated channels', () => {
  const env = { AMIBA_GITHUB_REPOSITORY: 'owner/amiba', AMIBA_UPDATE_URLS: 'https://cdn.example/stable' };
  assert.deepEqual(releaseSettings(env, 'darwin-arm64').sources, ['https://cdn.example/stable/', 'https://github.com/owner/amiba/releases/latest/download/']);
  assert.equal(releaseSettings(env, 'darwin-arm64').channel, 'latest-arm64');
  assert.equal(releaseSettings(env, 'darwin-x64').channel, 'latest-x64');
});
test('rejects insecure or credential-bearing sources and unsupported targets', () => {
  for (const url of ['http://cdn.example', 'https://user:pass@cdn.example', 'https://cdn.example?secret=1']) {
    assert.throws(() => releaseSettings({ AMIBA_GITHUB_REPOSITORY: 'owner/amiba', AMIBA_UPDATE_URLS: url }, 'win32-x64'));
  }
  assert.throws(() => releaseSettings({}, 'linux-x64'));
});

test('infers GitHub repository from HTTPS and SSH remotes', () => {
  for (const remote of ['https://github.com/iHeyTang/amiba.git', 'git@github.com:iHeyTang/amiba.git', 'ssh://git@github.com/iHeyTang/amiba.git']) assert.equal(githubRepository(remote), 'iHeyTang/amiba');
  assert.equal(githubRepository('https://other.example/iHeyTang/amiba.git'), undefined);
});
