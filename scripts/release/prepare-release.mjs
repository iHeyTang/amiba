import fs from 'node:fs';
import path from 'node:path';
import { root, productVersion, nextVersion } from './version.mjs';
import { gh, preflightRelease } from './release-policy.mjs';
import { releaseSettings } from './config.mjs';

export function checkReleaseConfiguration(env, macSigning = 'signed') {
  if (!['signed', 'unsigned'].includes(macSigning)) throw new Error('Invalid macOS signing mode');
  const missing = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'].filter(key => !env[key]?.trim());
  if (macSigning === 'signed' && missing.length) throw new Error(`Release configuration missing: ${missing.join(', ')}. No version was changed. Configure repository Actions secrets, then run Release again.`);
  releaseSettings({ ...env, AMIBA_GITHUB_REPOSITORY: env.GITHUB_REPOSITORY }, 'darwin-arm64');
}

// API calls use structured JSON stdin: secrets never enter shell command text.
export function prepareRelease({ env, bump = 'patch', macSigning = 'signed', directory = root, request = gh, preflight = preflightRelease }) {
  checkReleaseConfiguration(env, macSigning);
  if (env.GITHUB_REF !== 'refs/heads/main' || !/^\d+$/.test(env.GITHUB_RUN_ID || '') || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')) throw new Error('Release preparation requires a main workflow run');
  const repo = env.GITHUB_REPOSITORY;
  const api = (route, method, body) => JSON.parse(request(['api', `repos/${repo}/${route}`, ...(method ? ['--method', method, '--input', '-'] : [])], body ? JSON.stringify(body) : undefined));
  const version = nextVersion(productVersion(directory), bump);
  const message = `chore: release v${version} [skip ci]\n\nAmiba-Release-Run: ${env.GITHUB_RUN_ID}`;
  const head = api('git/ref/heads/main').object.sha;
  if (head !== env.GITHUB_SHA) {
    const existing = api(`git/commits/${head}`);
    if (existing.message === message && existing.parents.length === 1 && existing.parents[0].sha === env.GITHUB_SHA) {
      // A full retry of this run reuses its version commit instead of bumping twice.
      preflight(repo, version, head);
      return { version, commit: head };
    }
    throw new Error('main changed since this run started. Start a new Release from current main; no version was changed.');
  }
  if (preflight(repo, version, head)) throw new Error(`v${version} already has a draft; resolve it before preparing a new release`);
  const parent = api(`git/commits/${head}`);
  const tree = ['package.json', 'apps/desktop/package.json'].map(file => {
    const pkg = JSON.parse(fs.readFileSync(path.join(directory, file)));
    pkg.version = version;
    return { path: file, mode: '100644', type: 'blob', content: JSON.stringify(pkg, null, 2) + '\n' };
  });
  const newTree = api('git/trees', 'POST', { base_tree: parent.tree.sha, tree });
  const commit = api('git/commits', 'POST', { message, tree: newTree.sha, parents: [head] });
  preflight(repo, version, commit.sha);
  // A concurrent push makes this non-fast-forward and GitHub rejects it. Never force main.
  api('git/refs/heads/main', 'PATCH', { sha: commit.sha, force: false });
  console.log(`Prepared Amiba ${version} at ${commit.sha}`);
  return { version, commit: commit.sha };
}
