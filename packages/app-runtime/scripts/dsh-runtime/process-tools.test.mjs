import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { packageCommand, applyRuntimePatch } from './process-tools.mjs';
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
