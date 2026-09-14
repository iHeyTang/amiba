import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerDocumentFileIpc } from '../document-file-ipc.ts';
import { readDocumentFile } from '../document-file-reader.ts';
const sender = id => Object.assign(new EventEmitter(), { id, isDestroyed: () => false });
const args = (id = 'read') => ({ id, sessionId: 's', path: 'doc', request: { kind: 'text' } });
function harness(resolve, read) {
  const handlers = new Map();
  registerDocumentFileIpc({ handle: (name, handler) => handlers.set(name, handler) }, resolve, read);
  return { start: (from, value = args()) => handlers.get('files:read-document')({ sender: from }, value), cancel: (from, id = 'read') => handlers.get('files:cancel-document')({ sender: from }, id) };
}
test('IPC returns real file pages and structured errors without changing preview reads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'amiba-document-ipc-'));
  try {
    await writeFile(join(dir, 'doc'), 'first\nsecond\n');
    const h = harness(async (sessionId, path) => { assert.equal(sessionId, 's'); return { path: join(dir, path) }; }, readDocumentFile);
    const from = sender(1);
    const result = await h.start(from, { ...args(), request: { kind: 'text', limit: 1 } });
    assert.equal(result.ok, true); assert.equal(result.value.text, 'first'); assert.equal(result.value.eof, false);
    assert.equal(from.listenerCount('destroyed'), 0); assert.equal(from.listenerCount('did-start-navigation'), 0);
    const missing = await h.start(from, { ...args(), path: 'missing' });
    assert.equal(missing.ok, false); assert.equal(missing.error.code, 'workspace-file/not-found');
    const invalid = await h.start(from, { ...args(), request: { kind: 'text', offset: 0 } });
    assert.equal(invalid.error.code, 'gateway/bad-request');
    const binary = await h.start(from, { ...args(), request: { kind: 'all' } });
    assert.equal(Buffer.from(binary.value.data, 'base64').toString(), 'first\nsecond\n');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('malformed and unauthorized requests never reach the reader', async () => {
  let resolved = 0, reads = 0;
  const h = harness(async () => { resolved++; throw new Error("The requested file is outside this conversation's workspace."); }, async () => { reads++; });
  const from = sender(1);
  for (const value of [null, {}, { ...args(), request: { kind: 'wrong' } }, { ...args(), sessionId: '' }]) assert.equal((await h.start(from, value)).error.code, 'gateway/bad-request');
  assert.equal(resolved, 0);
  const denied = await h.start(from);
  assert.equal(denied.error.code, 'workspace-file/outside-workspace'); assert.deepEqual(denied.error.details, { path: 'doc' }); assert.equal(reads, 0);
});
test('cancellation belongs to the sender, survives pending authorization and cleans listeners', async () => {
  let authorize, reads = 0;
  const h = harness(() => new Promise(resolve => { authorize = resolve; }), async () => { reads++; });
  const a = sender(1), b = sender(2);
  const pending = h.start(a);
  assert.equal((await h.start(a)).error.code, 'gateway/bad-request');
  h.cancel(b);
  assert.equal(a.listenerCount('destroyed'), 1);
  h.cancel(a); authorize({ path: '/authorized' });
  assert.equal((await pending).error.name, 'AbortError'); assert.equal(reads, 0); assert.equal(a.listenerCount('destroyed'), 0);
});
test('navigation and destruction abort active reads while in-place and subframe navigation do not', async () => {
  const active = [];
  const h = harness(async () => ({ path: '/authorized' }), (_file, _request, signal) => new Promise((resolve, reject) => {
    active.push(signal); signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const a = sender(1);
  const pending = h.start(a); await Promise.resolve();
  h.cancel(sender(2));
  assert.equal(active[0].aborted, false);
  a.emit('did-start-navigation', {}, 'about:blank', true, true);
  a.emit('did-start-navigation', {}, 'about:blank', false, false);
  assert.equal(active[0].aborted, false);
  a.emit('did-start-navigation', {}, 'about:blank', false, true);
  assert.equal((await pending).error.code, 'ABORT_ERR');
  const next = h.start(a); await Promise.resolve();
  a.emit('destroyed'); assert.equal((await next).error.code, 'ABORT_ERR');
  assert.equal(a.listenerCount('did-start-navigation'), 0);
});
test('related reads use the canonical base directory and authorize the dependency again', async () => {
  const paths = [];
  const h = harness(async (sessionId, path) => {
    assert.equal(sessionId, 's'); paths.push(path);
    return { path: paths.length === 1 ? '/workspace/canonical/base.html' : path };
  }, async (file, request) => { assert.equal(file.path, '/workspace/asset.js'); assert.deepEqual(request, { kind: 'all' }); return { data: 'eA==' }; });
  assert.equal((await h.start(sender(1), { ...args(), request: { kind: 'all', relativePath: '../asset.js' } })).ok, true);
  assert.deepEqual(paths, ['doc', '/workspace/asset.js']);
  let reads = 0;
  const denied = harness(async (_session, path) => {
    if (path === 'doc') return { path: '/workspace/base.html' };
    throw new Error("The requested file is outside this conversation's workspace.");
  }, async () => { reads++; });
  assert.equal((await denied.start(sender(2), { ...args(), request: { kind: 'all', relativePath: '../secret' } })).error.code, 'workspace-file/outside-workspace');
  assert.equal(reads, 0);
});
test('malformed related paths fail before authorization and cancellation stops a second authorization', async () => {
  let calls = 0, finish;
  const h = harness(async () => {
    calls++;
    if (calls === 1) return { path: '/workspace/base.html' };
    return new Promise(resolve => { finish = resolve; });
  }, async () => { assert.fail('cancelled dependency must not be read'); });
  const from = sender(1);
  for (const relativePath of ['', '/x', '\\x', 'C:\\x', 'file:x', '\0', null, 2]) {
    assert.equal((await h.start(from, { ...args(), request: { kind: 'all', relativePath } })).error.code, 'gateway/bad-request');
  }
  assert.equal(calls, 0);
  const pending = h.start(from, { ...args(), request: { kind: 'all', relativePath: 'asset.js' } });
  await Promise.resolve(); await Promise.resolve();
  h.cancel(from); finish({ path: '/workspace/asset.js' });
  assert.equal((await pending).error.code, 'ABORT_ERR');
});
