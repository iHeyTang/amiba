import { expect, it, vi } from "vitest";
import type { StorageAdapter, StorageChangeMap } from "@amiba/app-runtime/platform";
import { createPendingQueueSource, sessionPendingQueue, type PendingChatTurn } from "../pending-queue-store";

const row = (queueId: string): PendingChatTurn => ({ queueId, text: queueId, attachments: [] });
function storageFixture() {
  const values: Record<string, unknown> = {};
  const watchers = new Set<(changes: StorageChangeMap) => void>();
  const storage: StorageAdapter = {
    get: vi.fn(async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, values[key]]))),
    set: vi.fn(async patch => { Object.assign(values, patch); }),
    remove: vi.fn(async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; }),
    watch: (_keys, listener) => { watchers.add(listener); return () => { watchers.delete(listener); }; },
  };
  return { storage, values, publish: (changes: StorageChangeMap) => { for (const listener of watchers) listener(changes); } };
}

it("merges an optimistic append with older persisted rows without running the updater twice", async () => {
  const { storage, values } = storageFixture();
  let finish!: (value: Record<string, unknown>) => void;
  vi.mocked(storage.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const source = createPendingQueueSource(storage, "a");
  const append = vi.fn(previous => [...previous, row("new")]);
  source.update(append);
  expect(source.getSnapshot()).toEqual([row("new")]);
  expect(storage.set).not.toHaveBeenCalled();
  finish({ "pendingQueue:a": [row("saved")] });
  await source.flush();
  expect(append).toHaveBeenCalledTimes(1);
  expect(source.getSnapshot()).toEqual([row("saved"), row("new")]);
  expect(values["pendingQueue:a"]).toEqual(source.getSnapshot());
});

it("applies optimistic removals without deleting unseen persisted items", async () => {
  const { storage } = storageFixture();
  let finish!: (value: Record<string, unknown>) => void;
  vi.mocked(storage.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const source = createPendingQueueSource(storage, "a");
  source.update(previous => [...previous, row("temporary")]);
  source.update(previous => previous.filter(item => item.queueId !== "temporary"));
  finish({ "pendingQueue:a": [row("saved")] });
  await source.flush();
  expect(source.getSnapshot()).toEqual([row("saved")]);
});

it("serializes writes and exposes persistence failures without losing the in-memory queue", async () => {
  const { storage } = storageFixture();
  const source = createPendingQueueSource(storage, "a"); await source.ready();
  let finish!: () => void;
  vi.mocked(storage.set).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  source.update([row("first")]); source.update(previous => [...previous, row("second")]);
  await vi.waitFor(() => expect(storage.set).toHaveBeenCalledTimes(1));
  finish(); await source.flush();
  expect(storage.set).toHaveBeenNthCalledWith(2, { "pendingQueue:a": [row("first"), row("second")] });
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    vi.mocked(storage.set).mockRejectedValueOnce(new Error("disk full"));
    source.update(previous => [...previous, row("kept")]);
    await expect(source.flush()).rejects.toThrow("disk full");
    expect(source.getSnapshot().at(-1)?.queueId).toBe("kept");
  } finally { warning.mockRestore(); }
});

it("shares a source per session and keeps subscriptions addressed to their own storage key", async () => {
  const { storage, publish } = storageFixture();
  const a = sessionPendingQueue(storage, "a"), b = sessionPendingQueue(storage, "b");
  expect(sessionPendingQueue(storage, "a")).toBe(a);
  const changed = vi.fn(); const offA = a.subscribe(changed), offB = b.subscribe(() => {});
  await Promise.all([a.ready(), b.ready()]);
  a.update([row("a")]); await a.flush();
  expect(b.getSnapshot()).toEqual([]);
  publish({ "pendingQueue:b": { newValue: [row("external")] } });
  expect(a.getSnapshot()).toEqual([row("a")]);
  expect(b.getSnapshot()).toEqual([row("external")]);
  expect(changed).toHaveBeenCalledTimes(1);
  offA(); offB();
});

it("does not overwrite a newer storage notification with a delayed initial read", async () => {
  const { storage, publish } = storageFixture();
  let finish!: (value: Record<string, unknown>) => void;
  vi.mocked(storage.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const source = createPendingQueueSource(storage, "a"); const off = source.subscribe(() => {});
  publish({ "pendingQueue:a": { newValue: [row("newer")] } });
  finish({ "pendingQueue:a": [row("older")] }); await source.ready();
  expect(source.getSnapshot()).toEqual([row("newer")]);
  expect(storage.set).not.toHaveBeenCalled();
  off();
});

it("persists an admitted item and notifies other views even when one observer throws", async () => {
  const { storage, values } = storageFixture();
  const source = createPendingQueueSource(storage, "a");
  await source.ready();
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const offBroken = source.subscribe(() => { throw new Error("broken view"); });
  const observed = vi.fn();
  const offHealthy = source.subscribe(observed);
  try {
    await source.ready();
    expect(() => source.update([row("admitted")])).not.toThrow();
    await source.flush();
    expect(values["pendingQueue:a"]).toEqual([row("admitted")]);
    expect(observed).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith("[pending-queue] observer failed", expect.any(Error));
  } finally { offBroken(); offHealthy(); warning.mockRestore(); }
});

it("keeps an admitted queue when a subscription refresh overlaps its own pending write", async () => {
  const { storage, values } = storageFixture();
  const source = createPendingQueueSource(storage, "a");
  await source.ready();
  let finishWrite!: () => void;
  let finishRead: ((value: Record<string, unknown>) => void) | undefined;
  vi.mocked(storage.set).mockImplementationOnce(patch => new Promise(resolve => {
    finishWrite = () => { Object.assign(values, patch); resolve(); };
  }));
  source.update([row("admitted")]);
  await vi.waitFor(() => expect(storage.set).toHaveBeenCalledOnce());
  vi.mocked(storage.get).mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
  const off = source.subscribe(() => {});
  finishWrite();
  await new Promise(resolve => setTimeout(resolve, 0));
  finishRead?.({ "pendingQueue:a": [] });
  await source.flush();
  expect(source.getSnapshot()).toEqual([row("admitted")]);
  off();
});

it("publishes an admitted row only after storage succeeds, retaining concurrent native edits", async () => {
  const { storage, values } = storageFixture();
  const source = createPendingQueueSource(storage, "a");
  await source.ready();
  let finish!: () => void;
  vi.mocked(storage.set).mockImplementationOnce(patch => new Promise(resolve => { finish = () => { Object.assign(values, patch); resolve(); }; }));
  const pending = source.appendPersisted(row("official"));
  await vi.waitFor(() => expect(storage.set).toHaveBeenCalledTimes(1));
  expect(source.getSnapshot()).toEqual([]);
  source.update(previous => [...previous, row("native")]);
  finish();
  await pending;
  await source.flush();
  expect(source.getSnapshot()).toEqual([row("native"), row("official")]);
  expect(values["pendingQueue:a"]).toEqual(source.getSnapshot());
});

it("does not publish a failed admission or block a later retry", async () => {
  const { storage, values } = storageFixture();
  const source = createPendingQueueSource(storage, "a");
  vi.mocked(storage.set).mockRejectedValueOnce(new Error("disk full"));
  await expect(source.appendPersisted(row("failed"))).rejects.toThrow("disk full");
  expect(source.getSnapshot()).toEqual([]);
  await source.appendPersisted(row("retry"));
  expect(source.getSnapshot()).toEqual([row("retry")]);
  expect(values["pendingQueue:a"]).toEqual(source.getSnapshot());
});

it("serializes concurrent admissions without losing either row", async () => {
  const { storage, values } = storageFixture();
  const source = createPendingQueueSource(storage, "a");
  await Promise.all([source.appendPersisted(row("one")), source.appendPersisted(row("two"))]);
  expect(source.getSnapshot()).toEqual([row("one"), row("two")]);
  expect(values["pendingQueue:a"]).toEqual(source.getSnapshot());
});

it("preserves Stop pressed while a resume admission is being saved", async () => {
  const { storage } = storageFixture();
  const source = createPendingQueueSource(storage, "a");
  source.setPaused(true);
  let finish!: () => void;
  vi.mocked(storage.set).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = source.appendPersisted(row("official"), { resume: true });
  await vi.waitFor(() => expect(storage.set).toHaveBeenCalled());
  source.setPaused(true); // Another explicit Stop, even though already paused.
  finish(); await pending;
  expect(source.isPaused()).toBe(true);
  await source.appendPersisted(row("later"), { resume: true });
  expect(source.isPaused()).toBe(false);
});
