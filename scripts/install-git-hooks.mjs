import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.githooks');
const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
const hooks = path.join(common, 'amiba-hooks');
let existing = '';
try { existing = execFileSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).trim(); } catch {}
if (existing && existing !== hooks && existing !== source) throw new Error(`Existing hooks path must be reviewed before changing: ${existing}`);
fs.mkdirSync(hooks, { recursive: true });
for (const name of ['pre-commit', 'pre-push']) {
  fs.copyFileSync(path.join(source, name), path.join(hooks, name));
  fs.chmodSync(path.join(hooks, name), 0o755);
}
execFileSync('git', ['config', '--local', 'core.hooksPath', hooks]);
console.log(`Enabled PR-only guards for this clone and its worktrees: ${hooks}`);
