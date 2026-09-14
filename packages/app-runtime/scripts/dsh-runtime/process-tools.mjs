import { realpathSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

export function packageCommand(command, args, options = {}) {
  const platform = options.platform ?? process.platform;
  const node = options.node ?? process.execPath;
  const pnpm = options.pnpm ?? process.env.npm_execpath;
  if (command === 'pnpm') {
    if (!pnpm || !/pnpm\.(c?js)$/.test(pnpm)) throw new Error('Run runtime preparation using pnpm runtime:prepare');
    return [node, [pnpm, ...args]];
  }
  if (command === 'npm.cmd' && platform === 'win32') {
    return [node, [path.win32.join(path.win32.dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js'), ...args]];
  }
  return [command, args];
}

export function applyRuntimePatch(packageDir, patchFile) {
  // Git is available on every supported build host. Use a directory outside the
  // checkout so repository-relative prefix filtering cannot skip ignored files.
  const args = ['-c', 'core.autocrlf=false', 'apply', '--unsafe-paths', `--directory=${realpathSync(packageDir)}`, '-p1'];
  const invoke = extra => spawnSync('git', [...args, ...extra, path.resolve(patchFile)], { cwd: os.tmpdir(), encoding: 'utf8' });
  const check = invoke(['--check']);
  if (check.error) throw check.error;
  if (check.status === 0) {
    const applied = invoke([]);
    if (applied.error || applied.status !== 0) throw new Error(`Cannot apply runtime patch: ${applied.error?.message || applied.stderr}`);
  } else {
    const reverse = invoke(['--check', '--reverse']);
    if (reverse.error || reverse.status !== 0) throw new Error(`Cannot apply or verify runtime patch: ${check.stderr}`);
  }
}

/** npm ignores pnpm patches; host-only dependencies also need reviewed fixes. */
export function applyManagedRuntimePatches(appDir, workspaceDir) {
  const manifest = JSON.parse(readFileSync(path.join(workspaceDir, 'package.json'), 'utf8'));
  const patches = { ...manifest.pnpm?.patchedDependencies, ...manifest.amiba?.runtimePatches };
  for (const [specifier, patchFile] of Object.entries(patches)) {
    const split = specifier.lastIndexOf('@');
    const directory = path.join(appDir, 'node_modules', specifier.slice(0, split));
    const installed = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
    if (installed.version !== specifier.slice(split + 1)) throw new Error(`Patch version mismatch for ${specifier}`);
    applyRuntimePatch(directory, path.resolve(workspaceDir, patchFile));
  }
}

/** Idempotent shutdown: signal-terminated children have null exitCode. */
export async function stopChildProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const force = setTimeout(() => child.kill('SIGKILL'), 5_000);
    child.once('exit', () => { clearTimeout(force); resolve(); });
    child.kill('SIGTERM');
  });
}
