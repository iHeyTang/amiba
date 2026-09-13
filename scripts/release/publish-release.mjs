import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gh, preflightRelease } from './release-policy.mjs';
import { verifiedArtifacts } from './artifacts.mjs';

export function findRelease(repo, version, request = gh) {
  return JSON.parse(request(['api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`])).flat().find(item => item.tag_name === `v${version}`);
}

export function checkReleaseAssets(release, version, commit, names) {
  if (!release || release.tag_name !== `v${version}` || release.target_commitish !== commit || release.prerelease) throw new Error('Release identity mismatch');
  const actual = release.assets.map(asset => asset.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...new Set(names)].sort()) || release.assets.some(asset => asset.state !== 'uploaded')) throw new Error('Release assets are incomplete or unexpected; leaving draft unpublished');
}

// Used on a retry after publication succeeded but the runner lost its response.
// Never overwrite public assets: download and validate them instead.
export function verifyRemoteRelease(repo, version, sets, request = gh) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amiba-published-verify-'));
  try {
    request(['release', 'download', `v${version}`, '--repo', repo, '--dir', dir, ...sets.flatMap(set => set.names.flatMap(name => ['--pattern', name]))]);
    for (const set of sets) {
      fs.copyFileSync(path.join(set.dir, 'release-manifest.json'), path.join(dir, 'release-manifest.json'));
      verifiedArtifacts(dir, set.target, version, set.commit);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

export function publishRelease({ repo, version, commit, names, request = gh, preflight = preflightRelease }) {
  const release = findRelease(repo, version, request);
  checkReleaseAssets(release, version, commit, names);
  if (!release.draft) return release.html_url;
  preflight(repo, version, commit);
  const notes = JSON.parse(request(['api', `repos/${repo}/releases/generate-notes`, '--method', 'POST', '--input', '-'], JSON.stringify({ tag_name: `v${version}`, target_commitish: commit })));
  const published = JSON.parse(request(['api', `repos/${repo}/releases/${release.id}`, '--method', 'PATCH', '--input', '-'], JSON.stringify({
    name: `Amiba ${version}`, body: notes.body, draft: false, prerelease: false, make_latest: 'true',
  })));
  if (published.draft || published.tag_name !== `v${version}` || published.target_commitish !== commit) throw new Error('Could not confirm Release publication; rerun the failed job');
  return published.html_url;
}
