import { spawnSync } from 'node:child_process';
import { compareVersions, parseVersion, root } from './version.mjs';
export function assertReleasePolicy({ version, commit, releases, tagCommit }) {
  parseVersion(version);
  if (!/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Missing release source commit');
  if (tagCommit && tagCommit !== commit) throw new Error(`v${version} tag belongs to another commit`);
  for (const release of releases) {
    if (release.tag_name === `v${version}`) {
      if (!release.draft) throw new Error(`v${version} is already published. Increment the version.`);
      if (release.target_commitish !== commit) throw new Error('Release draft belongs to another commit. Increment the version or remove the obsolete draft explicitly.');
    }
    if (!release.draft && !release.prerelease && /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.tag_name) && compareVersions(version, release.tag_name.slice(1)) <= 0) {
      throw new Error(`Version must be newer than published ${release.tag_name}`);
    }
  }
}
export function gh(args, input) {
  const result = spawnSync('gh', args, { cwd: root, encoding: 'utf8', input, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`GitHub request failed: ${result.error?.message || result.stderr}`);
  return result.stdout;
}
export function preflightRelease(repo, version, commit) {
  const pages = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`]));
  const refs = JSON.parse(gh(['api', `repos/${repo}/git/matching-refs/tags/v${version}`]));
  let object = refs.find(ref => ref.ref === `refs/tags/v${version}`)?.object;
  for (let depth = 0; object?.type === 'tag' && depth < 10; depth++) object = JSON.parse(gh(['api', `repos/${repo}/git/tags/${object.sha}`])).object;
  if (object && object.type !== 'commit') throw new Error('Cannot resolve release tag commit');
  assertReleasePolicy({ version, commit, releases: pages.flat(), tagCommit: object?.sha });
  return pages.flat().find(release => release.tag_name === `v${version}`);
}
