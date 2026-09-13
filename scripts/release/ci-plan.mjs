import fs from 'node:fs';
import { productVersion, parseVersion } from './version.mjs';
import { preflightRelease } from './release-policy.mjs';
import { pathToFileURL } from 'node:url';
export const runnerTargets = [
  { target: 'win32-x64', runner: 'windows-2022', arch: 'x64' },
  { target: 'darwin-x64', runner: 'macos-15-intel', arch: 'x64' },
  { target: 'darwin-arm64', runner: 'macos-15', arch: 'arm64' },
];
export function installerName(version, target) {
  parseVersion(version);
  if (!runnerTargets.some(row => row.target === target)) throw new Error('Invalid installer target');
  const [platform, arch] = target.split('-');
  return `Amiba-${version}-${platform === 'darwin' ? 'mac' : 'win'}-${arch}.${platform === 'darwin' ? 'dmg' : 'exe'}`;
}
export function ciPlan({ ref = '', inputs = {}, version }) {
  if (ref !== 'refs/heads/main') throw new Error('Desktop CI only runs on main');
  parseVersion(version);
  const mode = inputs.mode || 'test';
  if (!['test', 'release', 'verify'].includes(mode)) throw new Error('Invalid build mode');
  const target = inputs.target || 'all';
  if (mode === 'verify' && !/^[0-9]+$/.test(inputs.run_id || '')) throw new Error('Verify mode requires an artifact run ID');
  const include = runnerTargets.filter(row => target === 'all' || row.target === target).map(row => ({ ...row, installer: installerName(version, row.target), packagePrefix: installerName(version, row.target).replace(/\.(dmg|exe)$/, '') }));
  if (!include.length) throw new Error('Invalid build target');
  const publish = inputs.publish_draft === true || inputs.publish_draft === 'true';
  if (publish && mode !== 'release') throw new Error('Test packages cannot be published as release updates');
  if (publish && target !== 'all') throw new Error('Release drafts require all three platforms');
  return { matrix: { include }, mode, publish };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH));
  const version = productVersion();
  const plan = ciPlan({ ref: process.env.GITHUB_REF, inputs: event.inputs, version });
  if (plan.mode === 'release') preflightRelease(process.env.GITHUB_REPOSITORY, version, process.env.GITHUB_SHA);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nmatrix=${JSON.stringify(plan.matrix)}\nmode=${plan.mode}\npublish=${plan.publish}\n`);
}
