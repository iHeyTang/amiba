import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runnerTargets } from './ci-plan.mjs';
import { verifiedArtifacts } from './artifacts.mjs';
const { include } = JSON.parse(process.env.BUILD_MATRIX);
const version = JSON.parse(fs.readFileSync('apps/desktop/package.json')).version;
for (const { target } of include) {
  if (!runnerTargets.some(row => row.target === target)) throw new Error('Invalid target');
  const source = path.resolve('release-downloads', `amiba-${target}`);
  verifiedArtifacts(source, target, version);
  fs.cpSync(source, path.resolve('apps/desktop/dist', target), { recursive: true });
}
// Validate the full set before creating or modifying a release. A single job
// uploads serially so multiple architecture jobs cannot race to create the tag.
for (const { target } of include) {
  const result = spawnSync(process.execPath, ['scripts/release/upload.mjs', target], { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`Release upload failed for ${target}`);
}
