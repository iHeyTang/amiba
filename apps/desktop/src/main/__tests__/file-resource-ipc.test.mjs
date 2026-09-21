import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerFileResourceIpc } from '../file-resource-ipc.ts';

test('workspace rebinding waits for current readiness and suppresses stale generations', async () => {
  const handlers = new Map(), listeners = new Set(), opened = [], sent = [];
  let root = '/first';
  registerFileResourceIpc({ handle: (name, fn) => handlers.set(name, fn) }, () => root,
    (root, candidate, changed, signal) => new Promise((resolve, reject) => opened.push({ root, candidate, changed, signal, resolve, reject })),
    changed => { listeners.add(changed); return () => listeners.delete(changed); });
  const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send: (...args) => sent.push(args) });
  const change = sessionId => { for (const listener of listeners) listener({ sessionId }); };
  let ready = false;
  const initial = handlers.get('files:observe-resource')({ sender }, { id: 'watch', sessionId: 's', path: 'a' }).then(() => { ready = true; });
  assert.equal(opened[0].root, '/first');
  root = '/second'; change('unrelated');
  assert.equal(opened.length, 1);
  change('s');
  assert.equal(opened[0].signal.aborted, true);
  assert.equal(opened[1].root, '/second');
  opened[0].reject(new Error('superseded setup'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(ready, false);
  opened[1].resolve(async () => {});
  await initial;
  let before = sent.length;
  opened[0].changed();
  assert.equal(sent.length, before);
  opened[1].changed();
  assert.equal(sent.length, before + 1);
  root = '/invalid'; change('s');
  opened[2].reject(new Error('missing workspace'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(listeners.size, 1);
  root = '/recovered'; change('s');
  assert.equal(opened[2].signal.aborted, true);
  opened[3].resolve(async () => {});
  before = sent.length;
  opened[2].changed();
  assert.equal(sent.length, before);
  opened[3].changed();
  assert.equal(sent.length, before + 1);
  handlers.get('files:unobserve-resource')({ sender }, 'watch');
  assert.equal(opened[3].signal.aborted, true);
  assert.equal(listeners.size, 0);
});

test('observation ownership handles navigation during setup and ignores other windows cancellation', async () => {
  const handlers = new Map();
  const opened = [];
  registerFileResourceIpc({ handle: (name, fn) => handlers.set(name, fn) }, () => '/workspace',
    (_root, _path, changed, signal) => new Promise((resolve, reject) => opened.push({ changed, signal, resolve, reject })));
  const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send() {} });
  const other = Object.assign(new EventEmitter(), { id: 2, isDestroyed: () => false, send() {} });
  const start = (owner, id) => handlers.get('files:observe-resource')({ sender: owner }, { id, sessionId: 's', path: 'a' });
  const stop = (owner, id) => handlers.get('files:unobserve-resource')({ sender: owner }, id);
  const first = start(sender, 'old');
  // Observe the rejection immediately, as preload does for detached requests.
  const rejected = assert.rejects(first, /old setup failed/);
  sender.emit('did-start-navigation', {}, 'new', false, true);
  assert.equal(opened[0].signal.aborted, true);
  const second = start(sender, 'new');
  opened[0].reject(new Error('old setup failed'));
  await rejected;
  opened[1].resolve(async () => {});
  await second;
  stop(other, 'new');
  assert.equal(opened[1].signal.aborted, false);
  sender.emit('did-start-navigation', {}, '#hash', true, true);
  assert.equal(opened[1].signal.aborted, false);
  stop(sender, 'new');
  assert.equal(opened[1].signal.aborted, true);
  assert.equal(sender.listenerCount('destroyed'), 0);
  assert.equal(sender.listenerCount('did-start-navigation'), 0);
  const third = start(sender, 'destroy');
  sender.emit('destroyed');
  assert.equal(opened[2].signal.aborted, true);
  opened[2].resolve(async () => {});
  await third;
  assert.equal(sender.listenerCount('did-start-navigation'), 0);
});

test('legacy previews observe only requested files and release pending work on unwatch', async () => {
  const handlers = new Map(), opened = [], sent = [];
  registerFileResourceIpc({ handle: (name, fn) => handlers.set(name, fn) }, () => '/workspace',
    (root, candidate, changed, signal) => new Promise(resolve => opened.push({ root, candidate, changed, signal, resolve })));
  const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send: (...args) => sent.push(args) });
  const watching = handlers.get('files:watch')({ sender }, { subscriptionId: 'view', sessionId: 's', paths: ['a', 'b', 'a'] });
  assert.deepEqual(opened.map(x => x.candidate), ['a', 'b']);
  opened[0].changed('unlink', '/workspace/a');
  assert.deepEqual(sent.pop(), ['files:changed', { subscriptionId: 'view', sessionId: 's', event: 'unlink', path: '/workspace/a' }]);
  handlers.get('files:unwatch')({ sender }, 'view');
  assert.ok(opened.every(x => x.signal.aborted));
  const before = sent.length;
  opened[1].changed('add', '/workspace/b');
  assert.equal(sent.length, before);
  opened.forEach(x => x.resolve(async () => {}));
  await watching;
  assert.equal(sender.listenerCount('destroyed'), 0);
});

test('a cancelled setup failure cannot remove a replacement subscription with the same id', async () => {
  const handlers = new Map(), opened = [];
  registerFileResourceIpc({ handle: (name, fn) => handlers.set(name, fn) }, () => '/workspace',
    (_root, _path, _changed, signal) => new Promise((resolve, reject) => opened.push({ signal, resolve, reject })));
  const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send() {} });
  const start = id => handlers.get('files:observe-resource')({ sender }, { id, sessionId: 's', path: 'a' });
  const stop = id => handlers.get('files:unobserve-resource')({ sender }, id);
  const retained = start('retained'); opened[0].resolve(async () => {}); await retained;
  const old = start('reused'); const rejected = assert.rejects(old, /cancelled discovery/);
  stop('reused');
  const replacement = start('reused'); opened[2].resolve(async () => {}); await replacement;
  opened[1].reject(new Error('cancelled discovery')); await rejected;
  stop('retained');
  assert.equal(opened[2].signal.aborted, false);
  stop('reused');
  assert.equal(opened[2].signal.aborted, true);
});
