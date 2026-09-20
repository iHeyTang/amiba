import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { packageCommand, applyRuntimePatch, applyManagedRuntimePatches, runtimePatchTargets, pruneRuntime, stopChildProcess } from './process-tools.mjs';
test('Windows package managers are invoked through Node without shell splitting', () => {
  const node = 'C:\\Program Files\\nodejs\\node.exe';
  const pnpm = 'C:\\Users\\Test User\\pnpm.cjs';
  assert.deepEqual(packageCommand('pnpm', ['--dir', 'C:\\My Project', 'build'], { platform: 'win32', node, pnpm }), [node, [pnpm, '--dir', 'C:\\My Project', 'build']]);
  assert.deepEqual(packageCommand('npm.cmd', ['install'], { platform: 'win32', node }), [node, ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js', 'install']]);
});
test('patches apply outside a Git checkout, verify reuse, and reject drift', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amiba patch '));
  try {
    fs.writeFileSync(path.join(dir, 'value.txt'), 'before\n');
    const patch = path.join(dir, 'fix.patch');
    fs.writeFileSync(patch, 'diff --git a/value.txt b/value.txt\n--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-before\n+after\n');
    applyRuntimePatch(dir, patch);
    assert.equal(fs.readFileSync(path.join(dir, 'value.txt'), 'utf8'), 'after\n');
    applyRuntimePatch(dir, patch);
    fs.writeFileSync(path.join(dir, 'value.txt'), 'drift\n');
    assert.throws(() => applyRuntimePatch(dir, patch));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('shutdown may be repeated after a child exits by signal', { timeout: 1000 }, async () => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore'});
  try {
    await once(child, 'spawn');
    await stopChildProcess(child);
    assert.ok(child.exitCode !== null || child.signalCode !== null);
    await stopChildProcess(child);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
});

test('managed installs apply workspace and host-only patches and reject version drift', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amiba-host-patches-'));
  try {
    const app = path.join(root, 'app');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      pnpm: { patchedDependencies: { 'shared@1.0.0': 'fix.patch' } },
      amiba: { runtimePatches: { 'host-only@1.0.0': 'fix.patch' } },
    }));
    fs.writeFileSync(path.join(root, 'fix.patch'), '--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-before\n+after\n');
    for (const name of ['shared', 'host-only']) {
      const directory = path.join(app, 'node_modules', name);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
      fs.writeFileSync(path.join(directory, 'value.txt'), 'before\n');
    }
    applyManagedRuntimePatches(app, root);
    applyManagedRuntimePatches(app, root);
    for (const name of ['shared', 'host-only']) assert.equal(fs.readFileSync(path.join(app, 'node_modules', name, 'value.txt'), 'utf8'), 'after\n');
    fs.writeFileSync(path.join(app, 'node_modules/host-only/package.json'), JSON.stringify({ version: '2.0.0' }));
    assert.throws(() => applyManagedRuntimePatches(app, root), /Patch version mismatch/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('embedded primitives are patched through the shipped frontend while other missing targets fail', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amiba-embedded-patch-'));
  try {
    const app = path.join(root, 'app');
    const directory = path.join(app, 'node_modules/@deepseek-ai/dsh-web-frontend');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version: '0.1.1-rc.2' }));
    fs.writeFileSync(path.join(directory, 'value.txt'), 'before\n');
    fs.writeFileSync(path.join(root, 'frontend.patch'), '--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-before\n+after\n');
    const manifest = {
      pnpm: { patchedDependencies: { '@deepseek-ai/dsh-client-ui-primitives@0.1.1-rc.2': 'development.patch' } },
      amiba: { runtimePatches: { '@deepseek-ai/dsh-web-frontend@0.1.1-rc.2': 'frontend.patch' } },
    };
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
    applyManagedRuntimePatches(app, root);
    applyManagedRuntimePatches(app, root);
    assert.equal(fs.readFileSync(path.join(directory, 'value.txt'), 'utf8'), 'after\n');
    manifest.amiba.runtimePatches = {};
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
    assert.throws(() => applyManagedRuntimePatches(app, root), /ENOENT/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('patch targets come from file headers only, never from added content', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amiba patch targets '));
  try {
    const app = path.join(root, 'app');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      pnpm: { patchedDependencies: { 'shared@1.0.0': 'fix.patch' } },
      amiba: { runtimePatches: { '@scope/host-only@1.0.0': 'host.patch', 'removed@1.0.0': 'gone.patch' } },
    }));
    fs.writeFileSync(path.join(root, 'fix.patch'), [
      '--- a/lib/client.js',
      '+++ b/lib/client.js',
      '@@ -1 +1 @@',
      '-before',
      '+++ b/not-a-header.js',
      '',
      '--- a/lib/types/client/index.d.ts',
      '+++ b/lib/types/client/index.d.ts',
      '@@ -1 +1 @@',
      '-before',
      '+after',
      '',
      '--- a/lib/dropped.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-gone',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(root, 'host.patch'), '--- a/lib/index.js\n+++ b/lib/index.js\n@@ -1 +1 @@\n-before\n+after\n');
    fs.writeFileSync(path.join(root, 'gone.patch'), '');
    assert.deepEqual([...runtimePatchTargets(app, root)].sort(), [
      path.join(app, 'node_modules/@scope/host-only/lib/index.js'),
      path.join(app, 'node_modules/shared/lib/client.js'),
      path.join(app, 'node_modules/shared/lib/types/client/index.d.ts'),
    ]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('pruning a patched tree with its targets protected keeps it reusable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amiba-runtime-reuse-'));
  try {
    const app = path.join(root, 'app');
    const pkg = path.join(app, 'node_modules/@scope/pkg');
    fs.mkdirSync(path.join(pkg, 'lib/types'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@scope/pkg', version: '1.0.0' }));
    fs.writeFileSync(path.join(pkg, 'lib/types/index.d.ts'), 'before\n');
    fs.writeFileSync(path.join(pkg, 'lib/client.js'), 'x\n');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      pnpm: { patchedDependencies: { '@scope/pkg@1.0.0': 'fix.patch' } },
    }));
    fs.writeFileSync(path.join(root, 'fix.patch'), '--- a/lib/types/index.d.ts\n+++ b/lib/types/index.d.ts\n@@ -1 +1 @@\n-before\n+after\n');

    applyManagedRuntimePatches(app, root);
    const withoutProtection = fs.mkdtempSync(path.join(os.tmpdir(), 'amiba-runtime-reuse-bare-'));
    fs.cpSync(app, path.join(withoutProtection, 'app'), { recursive: true });
    try {
      // The bug this guards: pruning the patched declaration leaves the reused
      // tree unverifiable, so the NEXT preparation cannot accept it.
      assert.equal(await pruneRuntime(path.join(withoutProtection, 'app')), 1);
      assert.throws(() => applyManagedRuntimePatches(path.join(withoutProtection, 'app'), root), /Cannot apply or verify runtime patch/);
    } finally { fs.rmSync(withoutProtection, { recursive: true, force: true }); }

    assert.equal(await pruneRuntime(app, runtimePatchTargets(app, root)), 0);
    assert.equal(fs.readFileSync(path.join(pkg, 'lib/types/index.d.ts'), 'utf8'), 'after\n');
    applyManagedRuntimePatches(app, root);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('pruning keeps patch targets and still drops maps, declarations and onnxruntime-web', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amiba-runtime-prune-'));
  try {
    const files = [
      'app/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js',
      // Patched declaration: must survive, or the next reused tree cannot be
      // verified by reverse-applying its patch.
      'app/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/types/client/index.d.ts',
      'app/node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts',
      'app/node_modules/@deepseek-ai/dsh-session/lib/index.js.map',
      'app/node_modules/onnxruntime-web/dist/ort.webgl.js',
      'app/node_modules/plain/lib/keep.js',
    ];
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), 'x');
    }
    const protect = new Set([
      path.join(root, 'app/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/types/client/index.d.ts'),
      // Protection is total: a target inside a whole pruned directory survives,
      // rather than being removed with its parent.
      path.join(root, 'app/node_modules/onnxruntime-web/dist/ort.webgl.js'),
    ]);
    const removed = await pruneRuntime(root, protect);
    assert.equal(removed, 2);
    for (const kept of [files[0], files[1], files[5], files[4]]) {
      assert.ok(fs.existsSync(path.join(root, kept)), `${kept} must survive`);
    }
    for (const gone of ['app/node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts', 'app/node_modules/@deepseek-ai/dsh-session/lib/index.js.map']) {
      assert.ok(!fs.existsSync(path.join(root, gone)), `${gone} must be pruned`);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
