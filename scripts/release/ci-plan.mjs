import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
export const runnerTargets = [
  { target: 'win32-x64', runner: 'windows-2022', arch: 'x64' },
  { target: 'darwin-x64', runner: 'macos-15-intel', arch: 'x64' },
  { target: 'darwin-arm64', runner: 'macos-15', arch: 'arm64' },
];
export function ciPlan({ ref = '', inputs = {}, version }) {
  const tagged = ref.startsWith('refs/tags/');
  if (tagged && ref !== `refs/tags/v${version}`) throw new Error('Release tag must match apps/desktop/package.json version');
  const mode = tagged ? 'release' : inputs.mode || 'test';
  if (!['test', 'release'].includes(mode)) throw new Error('Invalid build mode');
  const target = inputs.target || 'all';
  const include = runnerTargets.filter(row => target === 'all' || row.target === target);
  if (!include.length) throw new Error('Invalid build target');
  const publish = tagged || inputs.publish_draft === true || inputs.publish_draft === 'true';
  if (publish && mode !== 'release') throw new Error('Test packages cannot be published as release updates');
  return { matrix: { include }, mode, publish };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH));
  const version = JSON.parse(fs.readFileSync('apps/desktop/package.json')).version;
  const plan = ciPlan({ ref: process.env.GITHUB_REF, inputs: event.inputs, version });
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(plan.matrix)}\nmode=${plan.mode}\npublish=${plan.publish}\n`);
}
