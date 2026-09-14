import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { installerName, runnerTargets } from './ci-plan.mjs';
import { verifiedArtifacts, publicArtifactNames } from './artifacts.mjs';
import { findRelease, checkReleaseAssets, verifyRemoteRelease, publishRelease } from './publish-release.mjs';
const { include } = JSON.parse(process.env.BUILD_MATRIX);
if (include.length !== runnerTargets.length || !runnerTargets.every(row => include.some(item => item.target === row.target))) throw new Error('Release requires all three platforms');
const version = JSON.parse(fs.readFileSync('apps/desktop/package.json')).version;
const sets = [];
for (const { target } of include) {
  if (!runnerTargets.some(row => row.target === target)) throw new Error('Invalid target');
  const source = path.resolve('release-downloads', `metadata-${version}-${target}`);
  const installer = installerName(version, target);
  const packages = target.startsWith('darwin') ? [installer, installer.replace(/\.dmg$/, '.zip')] : [installer];
  for (const name of packages) fs.copyFileSync(path.resolve('release-installers', name), path.join(source, name));
  const names = verifiedArtifacts(source, target, version, process.env.AMIBA_RELEASE_COMMIT);
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'release-manifest.json')));
  sets.push({ dir: source, names: publicArtifactNames(manifest, names), target, commit: process.env.AMIBA_RELEASE_COMMIT, unsignedMac: manifest.macSigning === 'unsigned' });
  if (manifest.buildId !== process.env.AMIBA_BUILD_ID) throw new Error('Artifact build ID mismatch');
  fs.cpSync(source, path.resolve('apps/desktop/dist', target), { recursive: true });
}
// All three local sets have passed provenance and hash checks before remote changes.
const repo = process.env.AMIBA_GITHUB_REPOSITORY;
const commit = process.env.AMIBA_RELEASE_COMMIT;
const names = sets.flatMap(set => set.names);
const existing = findRelease(repo, version);
if (existing && !existing.draft) {
  checkReleaseAssets(existing, version, commit, names);
  verifyRemoteRelease(repo, version, sets);
} else {
  for (const { target } of include) {
    const result = spawnSync(process.execPath, ['scripts/release/upload.mjs', target, '--verify-download'], { stdio: 'inherit' });
    if (result.error || result.status !== 0) throw new Error(`Release upload failed for ${target}`);
  }
}
const url = publishRelease({ repo, version, commit, names, unsignedMac: sets.some(set => set.unsignedMac) });
console.log(`Published Amiba ${version}: ${url}`);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Amiba ${version}\n\n[Download release](${url})\n`);
