import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionIndex } from '../session-index-state.ts';
const flush = () => new Promise(resolve => setImmediate(resolve));
const row = (sessionId, more = {}) => ({ sessionId, updatedAt: 1, running: false, blank: false, ...more });
function harness() {
  let items = [row('a')];
  let list = async () => ({ items });
  let calls = 0;
  const streams = [];
  const client = {
    listSessions(signal) { calls++; return list(signal); },
    async *events(signal, onOpen) {
      const queue = []; let wake;
      const notify = () => { wake?.(); wake = undefined; };
      const stream = { signal, push(payload) { queue.push({ payload }); notify(); }, drop() { queue.push(null); notify(); } };
      streams.push(stream);
      signal.addEventListener('abort', notify, { once: true });
      try {
        onOpen();
        while (!signal.aborted) {
          if (!queue.length) await new Promise(resolve => { wake = resolve; });
          if (signal.aborted) return;
          const event = queue.shift();
          if (!event) throw new Error('disconnected');
          yield event;
        }
      } finally { signal.removeEventListener('abort', notify); }
    },
  };
  const index = new SessionIndex(async () => client);
  return { index, streams, get calls() { return calls; }, set items(value) { items = value; }, set list(value) { list = value; } };
}

test('updates running, activity, title and parent incrementally; unchanged reconciliation is silent', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(); const snapshots = []; const events = [];
  h.index.onChange(rows => snapshots.push(rows)); h.index.onEvent(event => events.push(event));
  try {
    h.index.start(); await flush();
    assert.equal(h.calls, 1);
    h.streams[0].push({ type: 'session/added', summary: row('child', { blank: true, parentSessionId: 'a' }) });
    h.streams[0].push({ type: 'session/activity', sessionId: 'child', updatedAt: 2 });
    h.streams[0].push({ type: 'session/status', sessionId: 'child', running: true });
    h.streams[0].push({ type: 'session/projection', sessionId: 'child', key: 'sessionListMetadata', value: { blank: false, lastPromptAt: 2 }, seq: 1 });
    h.streams[0].push({ type: 'session/projection', sessionId: 'child', key: 'title', value: 'Background', seq: 2 });
    h.streams[0].push({ type: 'approval/requested', sessionId: 'child', approvalId: 'wait' });
    await flush();
    assert.equal(h.index.running('child'), true); assert.equal(h.index.parent('child'), 'a');
    assert.equal(h.index.getSnapshot()[0].blank, false); assert.equal(h.index.getSnapshot()[0].title, 'Background');
    assert.equal(events.at(-1).payload.type, 'approval/requested');
    t.mock.timers.tick(29_000); await flush(); assert.equal(h.calls, 1);
    h.items = h.index.getSnapshot().map(item => ({ ...item, projections: { values: { title: item.title } } }));
    const count = snapshots.length;
    t.mock.timers.tick(1_000); await flush();
    assert.equal(h.calls, 2); assert.equal(snapshots.length, count);
  } finally { h.index.dispose(); }
});

test('replays deltas received during a slow snapshot and never publishes after disposal', async () => {
  const h = harness(); let resolve;
  h.list = () => new Promise(r => { resolve = r; });
  const snapshots = []; h.index.onChange(rows => snapshots.push(rows));
  try {
    h.index.start(); await flush();
    h.streams[0].push({ type: 'session/status', sessionId: 'a', running: true });
    h.streams[0].push({ type: 'session/activity', sessionId: 'a', updatedAt: 3 }); await flush();
    resolve({ items: [row('a')] }); await flush();
    assert.equal(h.index.running('a'), true); assert.equal(h.index.getSnapshot()[0].updatedAt, 3);
    const before = snapshots.length;
    h.index.dispose();
    h.streams[0].push({ type: 'session/status', sessionId: 'a', running: false }); await flush();
    assert.equal(snapshots.length, before);
  } finally { h.index.dispose(); }
});

test('reconnect and unknown IDs resnapshot; unloading is not durable deletion', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  try {
    h.index.start(); await flush();
    h.streams[0].push({ type: 'session/removed', sessionId: 'a' }); await flush();
    t.mock.timers.tick(50); await flush();
    assert.equal(h.index.getSnapshot().length, 1);
    h.items = [row('a'), row('background', { running: true, parentSessionId: 'a' })];
    h.streams[0].push({ type: 'session/status', sessionId: 'background', running: true }); await flush();
    t.mock.timers.tick(50); await flush(); assert.equal(h.index.running('background'), true);
    h.streams[0].drop(); await flush();
    h.items = [row('background', { running: false, updatedAt: 10 })];
    t.mock.timers.tick(2_000); await flush();
    assert.equal(h.streams.length, 2); assert.equal(h.index.running('background'), false);
    assert.deepEqual(h.index.getSnapshot().map(x => x.sessionId), ['background']);
  } finally { h.index.dispose(); }
});

test('failed snapshots retain state and retry even while the event stream stays healthy', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  try {
    h.index.start(); await flush();
    h.list = async () => { throw new Error('unavailable'); };
    t.mock.timers.tick(30_000); await flush();
    assert.equal(h.index.getSnapshot()[0].sessionId, 'a');
    h.list = async () => ({ items: [] });
    t.mock.timers.tick(2_000); await flush();
    assert.deepEqual(h.index.getSnapshot(), []);
  } finally { h.index.dispose(); }
});


test('buffers restored sessions until the initial complete snapshot, preventing false new activity', async () => {
  const h = harness(); let resolve;
  h.list = () => new Promise(r => { resolve = r; });
  const snapshots = []; h.index.onChange(rows => snapshots.push(rows));
  try {
    h.index.start(); await flush();
    h.streams[0].push({ type: 'session/added', summary: row('older', { updatedAt: 1 }) });
    h.streams[0].push({ type: 'session/added', summary: row('newer', { updatedAt: 2 }) });
    h.streams[0].push({ type: 'session/status', sessionId: 'newer', running: true });
    await flush();
    assert.deepEqual(snapshots, []);
    resolve({ items: [row('older'), row('newer', { updatedAt: 2 })] }); await flush();
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].length, 2);
    assert.equal(h.index.running('newer'), true);
  } finally { h.index.dispose(); }
});
