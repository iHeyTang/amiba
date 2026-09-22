import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveManagedDshPaths, ensureManagedDshProfile } from '@amiba/app-runtime/dsh-runtime';
import { prepareSafeProfile, countUserStartupPlugins } from '../plugin-startup-profile.ts';
const runtime = path.resolve(import.meta.dirname, '../../../../../packages/app-runtime/resources/dsh-runtime');
test('real composer excludes disabled plugins; recovery skips broken user overlays and never imports user code', { skip: !existsSync(path.join(runtime, 'runtime-manifest.json')) }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'amiba-safe-profile-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = resolveManagedDshPaths(directory, runtime);
  await ensureManagedDshProfile(paths);
  const safe = await prepareSafeProfile(paths);
  assert.equal(await countUserStartupPlugins(paths, safe.name), 0);
  const fixture = path.join(directory, 'fixture');
  await mkdir(fixture);
  const manifest = { name: 'dsh-plugin-startup-fixture', version: '1.0.0', type: 'module', main: 'index.js', dsh: { bundle: { patch: 'cordis.yml' } } };
  await writeFile(path.join(fixture, 'package.json'), JSON.stringify(manifest));
  await writeFile(path.join(fixture, 'index.js'), 'throw new Error("USER CODE MUST NOT EXECUTE")');
  await writeFile(path.join(fixture, 'cordis.yml'), '- insert:\n    - id: startup-fixture\n      name: dsh-plugin-startup-fixture\n');
  const { readFile } = await import('node:fs/promises');
  const normal = JSON.parse(await readFile(paths.profileManifest, 'utf8'));
  normal.dsh.profile.bundles.push(manifest.name);
  normal.dependencies[manifest.name] = `link:${fixture}`;
  await writeFile(paths.profileManifest, JSON.stringify(normal));
  await mkdir(path.join(paths.profileDir, 'node_modules'), { recursive: true });
  await symlink(fixture, path.join(paths.profileDir, 'node_modules', manifest.name), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(await countUserStartupPlugins(paths, safe.name), 1);
  await writeFile(paths.profilePatch, '- id: startup-fixture\n  disabled: true\n');
  assert.equal(await countUserStartupPlugins(paths, safe.name), 0);
  await writeFile(path.join(paths.home, 'cordis.patch.yml'), '[broken: [');
  await assert.rejects(countUserStartupPlugins(paths, safe.name));
  // --help runs the trusted boot/CLI preparation and exits, without importing
  // the crashing user module or even parsing the malformed global patch.
  const { stdout } = await promisify(execFile)(paths.node, [safe.launcher, '--help'], {
    env: { ...process.env, DSH_HOME: paths.home, DSH_AGENTS_HOME: paths.agentsHome }, timeout: 30000,
  });
  assert.match(stdout, /Usage|Options|help/i);
});
