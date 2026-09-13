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
