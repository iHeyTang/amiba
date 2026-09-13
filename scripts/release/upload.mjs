import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifiedArtifacts, metadataName } from './artifacts.mjs';
import { preflightRelease } from './release-policy.mjs';
import { productVersion } from './version.mjs';
import { releaseSettings } from './config.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = process.argv[2] || `${process.platform}-${process.arch}`;
const { repo, channel } = releaseSettings(process.env, target);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'apps/desktop/package.json')));
const tag = `v${pkg.version}`;
productVersion();
const dir = path.join(root, 'apps/desktop/dist', target);
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'release-manifest.json')));
const releaseCommit = manifest.sourceCommit;
const metadata = metadataName(target);
const names = verifiedArtifacts(dir, target, pkg.version, process.env.AMIBA_RELEASE_COMMIT).filter(name => name !== metadata);
const run = (args, capture = false) => {
  const result = spawnSync('gh', args, { cwd: root, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`gh command failed: ${result.stderr || result.status}`);
  return result.stdout;
};
// Reuse drafts only. Published versions are immutable; never overwrite live installers.
const existing = preflightRelease(repo, pkg.version, releaseCommit);
if (!existing) run(['release', 'create', tag, '--repo', repo, '--draft', '--target', releaseCommit, '--title', tag, '--notes', `Amiba ${pkg.version}\n\nSource: ${releaseCommit}\nBuild: ${manifest.buildId}`]);
run(['release', 'upload', tag, '--repo', repo, ...names.map(name => path.join(dir, name)), path.join(dir, metadata), '--clobber']);
if (process.argv.includes('--verify-download')) {
  const verificationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amiba-release-verify-'));
  try {
    run(['release', 'download', tag, '--repo', repo, '--dir', verificationDir, ...[...names, metadata].flatMap(name => ['--pattern', name])]);
    fs.copyFileSync(path.join(dir, 'release-manifest.json'), path.join(verificationDir, 'release-manifest.json'));
    verifiedArtifacts(verificationDir, target, pkg.version);
    console.log(`Verified GitHub download: ${target} installers, blockmaps and update metadata match the build manifest`);
  } finally { fs.rmSync(verificationDir, {recursive: true, force: true}); }
}
console.log(`Uploaded ${target} to draft ${repo} ${tag}. Publish only after all three targets and CDN sync are verified.`);
