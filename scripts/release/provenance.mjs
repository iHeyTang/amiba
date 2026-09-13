import { spawnSync } from 'node:child_process';
import { root, parseVersion } from './version.mjs';
export function sourceIdentity(mode, env = process.env) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const sourceCommit = result.stdout?.trim();
  if (result.status !== 0 || !/^[a-f0-9]{40}$/.test(sourceCommit || '')) throw new Error('Cannot resolve build commit');
  const expectedCommit = env.AMIBA_RELEASE_COMMIT || env.GITHUB_SHA;
  if (expectedCommit && expectedCommit !== sourceCommit) throw new Error('Checkout does not match CI commit');
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  if (status.status !== 0) throw new Error('Cannot inspect checkout');
  const dirty = !!status.stdout.trim();
  if (mode === 'release' && dirty) throw new Error('Commit changes before building a release');
  return { sourceCommit, buildId: env.GITHUB_RUN_ID ? `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT || '1'}` : `local-${Date.now()}`, mode, dirty };
}
export function assertProvenance(manifest, expectedCommit) {
  if (!/^[a-f0-9]{40}$/.test(manifest.sourceCommit || '') || !manifest.buildId || manifest.mode !== 'release' || manifest.dirty !== false) throw new Error('Rebuild: release provenance missing or checkout was dirty');
  if (expectedCommit && manifest.sourceCommit !== expectedCommit) throw new Error('Artifact source commit mismatch');
}
export function artifactName(version, target, mode, buildId) {
  parseVersion(version);
  if (!['darwin-arm64', 'darwin-x64', 'win32-x64'].includes(target) || !['test', 'release', 'verify'].includes(mode) || !/^[a-zA-Z0-9-]+$/.test(buildId || '')) throw new Error('Invalid artifact identity');
  return `amiba-${version}-${target}-${mode}-${buildId}`;
}
