import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sandbox = await fs.mkdtemp(path.join(tmpdir(), 'amiba-cli-package-'));
const run = (command, args, cwd = root, env = process.env) => {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 240_000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  return result.stdout;
};
try {
  run('pnpm', ['--dir', 'apps/cli', 'pack', '--pack-destination', sandbox]);
  const archive = (await fs.readdir(sandbox)).find(file => file.endsWith('.tgz'));
  assert(archive);
  await fs.writeFile(path.join(sandbox, 'package.json'), '{"private":true}');
  run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', path.join(sandbox, archive)], sandbox);
  const cli = path.join(sandbox, 'node_modules/@amiba/cli/dist/cli.js');
  const manifest = JSON.parse(await fs.readFile(path.join(sandbox, 'node_modules/@amiba/cli/package.json'), 'utf8'));
  assert(!manifest.dependencies['@amiba/app-runtime']);
  assert.match(run(process.execPath, [cli, 'plugin', 'dev', '--help'], sandbox), /--no-connect/);
  const output = run(process.execPath, ['apps/desktop/scripts/smoke-plugin-desktop.mjs', '--native'], root, { ...process.env, AMIBA_SMOKE_CLI: cli });
  console.log(output.trim());
  console.log('Public CLI tarball installs independently and drives desktop plugin HMR without the private workspace package — passed.');
} finally { await fs.rm(sandbox, { recursive: true, force: true }); }
