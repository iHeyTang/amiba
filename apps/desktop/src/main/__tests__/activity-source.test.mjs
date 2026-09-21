import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivitySource } from '../dsh-state/activity.ts';

const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  let notify;
  let event;
  const streams = [];
  const source = new ActivitySource(async () => ({
    events(signal, _onOpen, address) {
      let next;
      const queue = [];
      const stream = { address, signal, push(payload) { queue.push({ payload }); next?.(); next = undefined; } };
      streams.push(stream);
      signal.addEventListener('abort', () => { next?.(); next = undefined; }, { once: true });
      return (async function* () {
        while (!signal.aborted) {
          if (!queue.length) await new Promise(resolve => { next = resolve; });
          while (queue.length && !signal.aborted) yield queue.shift();
        }
      })();
    },
  }), { onChange(callback) { notify = callback; return () => {}; }, onEvent(callback) { event = callback; return () => {}; } });
  return { source, streams, sessions: rows => notify(rows), event: payload => event({ rpcId: "request", payload }) };
}
const row = (sessionId, running = false, updatedAt = 1) => ({ sessionId, running, updatedAt, blank: false, title: sessionId });

test('idle startup uses the index without reading history; a running turn starts the journal', async () => {
  const { source, streams, sessions } = harness();
  try {
    sessions([row('old')]);
    await flush();
    assert.equal(streams.length, 0);
    assert.equal(source.getSnapshot().phase, 'idle');
    assert.equal(source.getSnapshot().title, 'old');
    sessions([row('old', true)]); await flush();
    assert.deepEqual(streams[0].address, { kind: 'session', sessionId: 'old' });
    streams[0].push({ type: 'session/event', event: { type: 'turn/start', data: {} } }); await flush();
    assert.equal(source.getSnapshot().phase, 'thinking');
    // The index may stop running before the final event arrives.
    sessions([row('old')]);
    assert.equal(streams[0].signal.aborted, false);
    streams[0].push({ type: 'session/event', event: { type: 'turn/end', data: { reason: { kind: 'error' } } } }); await flush();
    assert.equal(source.getSnapshot().phase, 'failed');
    sessions([{ ...row('old'), title: 'renamed' }]);
    assert.equal(source.getSnapshot().title, 'renamed');
  } finally { source.dispose(); }
  assert.ok(streams.every(x => x.signal.aborted));
});

test('switches running sessions without following a new idle history or accepting stale events', async () => {
  const { source, streams, sessions } = harness();
  try {
    sessions([row('a', true)]); await flush();
    const first = streams[0];
    sessions([row('b', true, 2)]); await flush();
    assert.equal(first.signal.aborted, true);
    first.push({ type: 'session/event', event: { type: 'turn/start', data: {} } }); await flush();
    assert.equal(source.getSnapshot().sessionId, 'b');
    const second = streams[1];
    sessions([row('old-idle', false, 0)]); await flush();
    assert.equal(second.signal.aborted, true);
    assert.equal(streams.length, 2);
    assert.equal(source.getSnapshot().phase, 'idle');
  } finally { source.dispose(); }
});

test('a short turn completed between polls still receives its terminal state', async () => {
  const { source, streams, sessions } = harness();
  try {
    sessions([row('previous', false, 1)]); await flush();
    assert.equal(streams.length, 0);
    sessions([row('previous', false, 1)]); await flush();
    assert.equal(streams.length, 0);
    sessions([row('short-turn', false, 2)]); await flush();
    assert.equal(streams[0].address.sessionId, 'short-turn');
    streams[0].push({ type: 'session/event', event: { type: 'turn/end', data: {} } }); await flush();
    assert.equal(source.getSnapshot().phase, 'completed');
  } finally { source.dispose(); }
});

 test('shared global channel retains approval and question waits without its own socket', async () => {
  const { source, streams, sessions, event } = harness();
  try {
    sessions([row('a', true)]); await flush();
    assert.equal(streams.length, 1);
    event({ type: 'approval/requested', sessionId: 'a', approvalId: 'approval' });
    assert.equal(source.getSnapshot().phase, 'waiting');
    event({ type: 'question/requested', sessionId: 'a' });
    event({ type: 'approval/resolved', sessionId: 'a', approvalId: 'approval' });
    assert.equal(source.getSnapshot().phase, 'waiting');
    event({ type: 'question/resolved', sessionId: 'a', questionRpcId: 'request' });
    assert.equal(source.getSnapshot().phase, 'idle');
  } finally { source.dispose(); }
});
