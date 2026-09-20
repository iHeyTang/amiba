import { realpathSync, readFileSync } from 'node:fs';
import fsp from 'node:fs/promises';
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

/** The reviewed patch set: pnpm's own store patches plus host-only fixes. */
function reviewedPatches(workspaceDir) {
  const manifest = JSON.parse(readFileSync(path.join(workspaceDir, 'package.json'), 'utf8'));
  return { ...manifest.pnpm?.patchedDependencies, ...manifest.amiba?.runtimePatches };
}

/** One directory per `<name>@<version>` specifier, under the app tree. */
function patchPackageDir(appDir, specifier) {
  return path.join(appDir, 'node_modules', specifier.slice(0, specifier.lastIndexOf('@')));
}

/**
 * Every file the reviewed patch set touches, as absolute paths under
 * `appDir/node_modules`.
 *
 * Pruning must keep these: a reused app tree is verified by
 * `applyRuntimePatch` reverse-checking each patch, and a reverse check cannot
 * succeed once a file the patch writes no longer exists.
 */
export function runtimePatchTargets(appDir, workspaceDir) {
  const targets = new Set();
  for (const [specifier, patchFile] of Object.entries(reviewedPatches(workspaceDir))) {
    const directory = patchPackageDir(appDir, specifier);
    const text = readFileSync(path.resolve(workspaceDir, patchFile), 'utf8');
    let expectingTarget = false;
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trimEnd();
      // Only the `+++` line that follows a `---` line is a file header; a
      // patch whose *content* adds a line reading `++ b/x` would otherwise
      // look like one.
      if (line.startsWith('--- ')) {
        expectingTarget = true;
        continue;
      }
      if (expectingTarget && line.startsWith('+++ ')) {
        const target = line.slice(4);
        const relative = /^[ab]\/(.+)$/u.exec(target);
        if (relative) targets.add(path.resolve(directory, relative[1]));
      }
      expectingTarget = false;
    }
  }
  return targets;
}

/**
 * Regexes for paths pruned from the staged runtime before it ships. The
 * runtime is shipped unpacked via electron-builder `extraResources`, so the
 * asar-level exclusions in `scripts/release/package-content.mjs` never see
 * it — this walk is the only place the release size is controlled.
 */
const RUNTIME_PRUNE_PATTERNS = [
  // Source maps — debug-only. The installed app carried ~270 MB of them.
  /\.map$/u,
  // TypeScript declarations — never executed at runtime. The installed app
  // carried ~90-135 MB across `*.d.ts` / `*.d.mts` / `*.d.cts`.
  /\.d\.(?:ts|mts|cts)$/u,
  // Browser-only onnxruntime-web bundle. The memos plugin executes on
  // onnxruntime-node in the Node runtime; `ort.webgl.js` / `ort.wasm` and
  // the rest of the web build (~130 MB) are never referenced by any
  // runtime JS (verified across the plugin + transformers packages).
  /[\\/]node_modules[\\/]onnxruntime-web(?:[\\/]|$)/u,
];

/**
 * Delete dev/cross-platform paths from a staged runtime and report how many
 * were removed.
 *
 * `protect` holds paths that must survive even when they match a pattern —
 * the files the reviewed patches touch (see `runtimePatchTargets`). Keeping
 * them costs a few kilobytes and keeps a reused app tree verifiable, which is
 * what `applyManagedRuntimePatches` does on every later preparation.
 */
export async function pruneRuntime(root, protect = new Set()) {
  let removed = 0;
  // A protected path must survive even when a *parent* directory matches a
  // pattern, so protection is total rather than per-file.
  const protectedPaths = [...protect];
  const isProtected = (candidate) =>
    protect.has(candidate) || protectedPaths.some((kept) => kept.startsWith(`${candidate}${path.sep}`));
  const queue = (await fsp.readdir(root, { withFileTypes: true })).map((entry) =>
    path.join(root, entry.name),
  );
  for (let i = 0; i < queue.length; i += 1) {
    const current = queue[i];
    const relative = path.relative(root, current).split(path.sep).join('/');
    if (RUNTIME_PRUNE_PATTERNS.some((pattern) => pattern.test(relative)) && !isProtected(current)) {
      await fsp.rm(current, { recursive: true, force: true });
      removed += 1;
      continue;
    }
    const info = await fsp.lstat(current);
    if (info.isDirectory()) {
      const children = await fsp.readdir(current, { withFileTypes: true });
      for (const child of children) queue.push(path.join(current, child.name));
    }
  }
  return removed;
}

/** npm ignores pnpm patches; host-only dependencies also need reviewed fixes. */
export function applyManagedRuntimePatches(appDir, workspaceDir) {
  const patches = reviewedPatches(workspaceDir);
  for (const [specifier, patchFile] of Object.entries(patches)) {
    const split = specifier.lastIndexOf('@');
    const directory = patchPackageDir(appDir, specifier);
    // ui-primitives is embedded in the shipped frontend, not installed as a
    // Host package. Its paired frontend patch is mandatory in that layout.
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives@0.1.1-rc.2') {
      try { readFileSync(path.join(directory, 'package.json'), 'utf8'); }
      catch (error) {
        if (error.code !== 'ENOENT' || !patches['@deepseek-ai/dsh-web-frontend@0.1.1-rc.2']) throw error;
        continue;
      }
    }
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
