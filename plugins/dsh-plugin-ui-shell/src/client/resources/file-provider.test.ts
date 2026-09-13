import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFileResourceProvider } from './file-provider.js'

afterEach(() => vi.useRealTimers());
const address = 'dsh-resource://file/session/s%201/dir/../a.txt';
const value = { absolutePath: '/workspace/a.txt', version: 'v1', bytes: 4 };

describe('native file resource reconciliation', () => {
  it('waits for observer readiness and queues invalidations during an in-flight read', async () => {
    vi.useFakeTimers();
    let ready!: () => void;
    let changed!: () => void;
    let complete!: (result: typeof value) => void;
    const dispose = vi.fn();
    const observe = vi.fn((_session, _path, callback) => {
      changed = callback;
      return { ready: new Promise<void>(resolve => { ready = resolve; }), dispose };
    });
    const stat = vi.fn().mockImplementationOnce(() => new Promise<typeof value>(resolve => { complete = resolve; }))
      .mockResolvedValue({ ...value, version: 'v2' });
    const controller = new AbortController();
    const frames: unknown[] = [];
    const job = (async () => {
      for await (const frame of createFileResourceProvider({ stat, observe }, 60000).open(address, controller)) frames.push(frame);
    })();
    try {
      expect(observe).toHaveBeenCalledWith('s 1', 'dir/../a.txt', expect.any(Function));
      expect(stat).not.toHaveBeenCalled();
      ready();
      await vi.advanceTimersByTimeAsync(0);
      changed();
      complete(value);
      await vi.advanceTimersByTimeAsync(0);
      expect(frames).toEqual([{ ok: true, value }, { ok: true, value: { ...value, version: 'v2' } }]);
      stat.mockResolvedValue({ ...value, version: 'v3' });
      changed();
      await vi.advanceTimersByTimeAsync(0);
      expect(frames.at(-1)).toEqual({ ok: true, value: { ...value, version: 'v3' } });
    } finally { controller.abort(); await job; }
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers absent files, updates metadata, suppresses duplicate frames and stops on abort', async () => {
    vi.useFakeTimers();
    const stat = vi.fn().mockRejectedValue(new Error('ENOENT: missing'));
    const controller = new AbortController();
    const frames: unknown[] = [];
    const job = (async () => {
      for await (const frame of createFileResourceProvider({ stat }).open(address, controller)) frames.push(frame);
    })();
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(stat).toHaveBeenCalledWith('s 1', 'dir/../a.txt');
      expect(frames).toHaveLength(1);
      stat.mockResolvedValue(value);
      await vi.advanceTimersByTimeAsync(1000);
      expect(frames.at(-1)).toEqual({ ok: true, value });
      await vi.advanceTimersByTimeAsync(2000);
      expect(frames).toHaveLength(2);
      stat.mockResolvedValue({ ...value, version: 'v2', bytes: 9 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(frames.at(-1)).toEqual({ ok: true, value: { ...value, version: 'v2', bytes: 9 } });
      stat.mockRejectedValue(new Error('ENOENT: missing'));
      await vi.advanceTimersByTimeAsync(1000);
      expect(frames.at(-1)).toMatchObject({ ok: false, error: { code: 'workspace-file/not-found' } });
      stat.mockResolvedValue(value);
      await vi.advanceTimersByTimeAsync(1000);
      expect(frames.at(-1)).toEqual({ ok: true, value });
    } finally { controller.abort(); await job; }
    const calls = stat.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(stat).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('discards in-flight IPC results after cancellation', async () => {
    let resolve!: (result: typeof value) => void;
    const stat = vi.fn(() => new Promise<typeof value>(r => { resolve = r; }));
    const controller = new AbortController();
    const iterator = createFileResourceProvider({ stat }).open(address, controller)[Symbol.asyncIterator]();
    const pending = iterator.next();
    controller.abort();
    resolve(value);
    expect(await pending).toEqual({ done: true, value: undefined });
    expect(stat).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported and unscoped addresses before any backend call', async () => {
    const stat = vi.fn();
    for (const [input, code] of [
      ['file:///secret', 'workspace-file/unsupported-address'],
      ['dsh-resource://file/absolute/etc/hosts', 'workspace-file/unknown-workspace'],
    ]) {
      const result = [];
      for await (const frame of createFileResourceProvider({ stat }).open(input!, new AbortController())) result.push(frame);
      expect(result).toEqual([expect.objectContaining({ ok: false, error: expect.objectContaining({ code }) })]);
    }
    expect(stat).not.toHaveBeenCalled();
  });
});
