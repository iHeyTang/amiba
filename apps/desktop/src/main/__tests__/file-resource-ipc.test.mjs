import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerFileResourceIpc } from '../file-resource-ipc.ts';

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
