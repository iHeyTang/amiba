import { expect, it, vi } from "vitest";
import type { SubmitReceipt } from "@amiba/app-runtime/protocol";
import { createPendingQueueSource, type PendingChatTurn } from "../pending-queue-store";
import { createResidentQueueDrainer, type ResidentQueueDrainerDeps } from "../resident-queue-drainer";
import { deleteUnretainedAttachments } from "../attachment-ownership";
import { legacyDraftDocument } from "../../composer-draft-document";

const removeFile = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@amiba/app-runtime/platform", () => ({ getPlatform: () => ({ agentAttachments: { remove: removeFile } }) }));
const row = (queueId: string): PendingChatTurn => ({ queueId, text: queueId, attachments: [] });
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function fixture(items = [row("first"), row("second")]) {
  const values: Record<string, unknown> = { "pendingQueue:target": items };
  const queue = createPendingQueueSource({
    get: async () => ({ ...values }), set: async patch => { Object.assign(values, patch); },
    remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
    watch: () => () => {},
  }, "target");
  await queue.ready();
  let active = false, busy = false;
  const watchers = new Set<() => void>();
  const deps: ResidentQueueDrainerDeps = {
    queue: () => queue, offscreen: () => !active, busy: () => busy,
    watchReadiness: (_id, changed) => { watchers.add(changed); return () => { watchers.delete(changed); }; },
    resolve: vi.fn(async () => "resolved"),
    send: vi.fn<ResidentQueueDrainerDeps["send"]>(async request => { request.onDispatch?.(request.sessionId); return { kind: "accepted" }; }),
    drainNative: vi.fn(),
    retainedAttachments: () => [],
  };
  const worker = createResidentQueueDrainer(deps);
  return { queue, deps, worker, watchers,
    activate() { active = true; worker.enteredForeground("target"); },
    busy(value: boolean) { busy = value; for (const fn of [...watchers]) fn(); },
  };
}

it("does not drain a restored queue until a real completion and waits for actual idle before one FIFO send", async () => {
  const f = await fixture(); await tick();
  expect(f.deps.send).not.toHaveBeenCalled();
  f.busy(true); f.worker.completed("target"); f.worker.completed("target");
  await tick(); expect(f.deps.send).not.toHaveBeenCalled(); expect(f.watchers.size).toBe(1);
  f.busy(false); await tick();
  expect(f.deps.send).toHaveBeenCalledTimes(1);
  expect(f.queue.getSnapshot().map(item => item.queueId)).toEqual(["second"]);
  f.worker.completed("target"); await tick();
  expect(vi.mocked(f.deps.send).mock.calls.map(([request]) => request.text)).toEqual(["first", "second"]);
  expect(f.queue.getSnapshot()).toEqual([]); expect(f.watchers.size).toBe(0);
  expect(f.deps.resolve).not.toHaveBeenCalled();
});

it("Stop parks the queue and changing the pause flag alone does not send anything", async () => {
  const f = await fixture(); f.worker.interrupted("target"); f.worker.completed("target"); await tick();
  expect(f.deps.send).not.toHaveBeenCalled(); expect(f.queue.getSnapshot()).toHaveLength(2);
  f.queue.setPaused(false); await tick(); expect(f.deps.send).not.toHaveBeenCalled();
  f.worker.completed("target"); await tick(); expect(f.deps.send).toHaveBeenCalledTimes(1);
});

it.each(["pause", "remove", "replace", "foreground"] as const)("%s during reference preparation cancels the old row without dispatching or restoring stale data", async action => {
  const original = { ...row("first"), draft: legacyDraftDocument("@[dsh.reference:fixture|id|Label|clip] literal"), needsResolution: true };
  const f = await fixture([original, row("second")]);
  let finish!: (text: string) => void;
  vi.mocked(f.deps.resolve).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  f.worker.completed("target"); await vi.waitFor(() => expect(f.deps.resolve).toHaveBeenCalledOnce());
  expect(f.deps.resolve).toHaveBeenCalledWith("target", original.draft, expect.any(AbortSignal));
  if (action === "pause") f.worker.interrupted("target");
  if (action === "remove") f.queue.update(rows => rows.slice(1));
  if (action === "replace") f.queue.update(rows => [{ ...rows[0], text: "edited" }, ...rows.slice(1)]);
  if (action === "foreground") f.activate();
  finish("late resolved text"); await tick();
  expect(f.deps.send).not.toHaveBeenCalled();
  expect(f.queue.getNotice()).toBeNull();
  expect(f.queue.getSnapshot()[0].text).toBe(action === "remove" ? "second" : action === "replace" ? "edited" : "first");
});

it.each(["rejected", "unconfirmed"] as const)("restores a %s dispatch before newer records, keeps bytes held, and does not retry on another completion", async kind => {
  removeFile.mockClear();
  const attachment = { uiId: "ui", name: "queued.png", mime: "image/png", size: 3, kind: "image" as const, attachmentId: "host-file" };
  const first = { ...row("first"), attachments: [attachment] };
  const f = await fixture([first]);
  let finish!: (receipt: SubmitReceipt) => void;
  vi.mocked(f.deps.send).mockImplementation(request => { request.onDispatch?.(request.sessionId); return new Promise(resolve => { finish = resolve; }); });
  f.worker.completed("target"); await vi.waitFor(() => expect(f.deps.send).toHaveBeenCalledOnce());
  expect(f.queue.getSnapshot()).toEqual([]);
  deleteUnretainedAttachments([attachment], []); expect(removeFile).not.toHaveBeenCalled();
  f.queue.update(rows => [...rows, row("newer")]);
  f.worker.completed("target"); // Even a terminal notification cannot turn a failed receipt into acceptance.
  finish({ kind, error: "transport refused or lost" }); await tick();
  expect(f.queue.getSnapshot().map(item => item.queueId)).toEqual(["first", "newer"]);
  expect(f.queue.isPaused()).toBe(true);
  expect(f.queue.getNotice()).toContain(kind === "unconfirmed" ? "Check the conversation" : "transport refused");
  f.worker.completed("target"); await tick(); expect(f.deps.send).toHaveBeenCalledOnce();
  deleteUnretainedAttachments([attachment], f.queue.getSnapshot().flatMap(item => item.attachments));
  expect(removeFile).not.toHaveBeenCalled();
  f.queue.update([]); deleteUnretainedAttachments([attachment], []); expect(removeFile).toHaveBeenCalledOnce();
});

it("a turn completing before its acceptance promise settles advances once after that receipt", async () => {
  const f = await fixture();
  let finish!: (receipt: SubmitReceipt) => void;
  vi.mocked(f.deps.send).mockImplementationOnce(request => { request.onDispatch?.(request.sessionId); return new Promise(resolve => { finish = resolve; }); });
  f.worker.completed("target"); await vi.waitFor(() => expect(f.deps.send).toHaveBeenCalledOnce());
  f.worker.completed("target"); f.worker.completed("target");
  finish({ kind: "accepted" }); await tick();
  expect(f.deps.send).toHaveBeenCalledTimes(2); expect(f.queue.getSnapshot()).toEqual([]);
});

it("returns subsequent draining to the native queue after an admitted background turn is opened", async () => {
  const f = await fixture(); f.worker.completed("target"); await tick();
  f.activate(); f.worker.completed("target"); f.worker.completed("target");
  expect(f.deps.send).toHaveBeenCalledOnce(); expect(f.deps.drainNative).toHaveBeenCalledOnce();
  expect(f.deps.drainNative).toHaveBeenCalledWith("target");
  expect(f.queue.getSnapshot()).toEqual([row("second")]);
});

it("a preparation error keeps the original row and publishes a paused notice; explicit resume clears it", async () => {
  const f = await fixture([{ ...row("first"), draft: legacyDraftDocument("ref"), needsResolution: true }]);
  vi.mocked(f.deps.resolve).mockRejectedValue(new Error("Reference plugin unloaded"));
  f.worker.completed("target"); await tick();
  expect(f.queue.getSnapshot()).toHaveLength(1); expect(f.queue.isPaused()).toBe(true);
  expect(f.queue.getNotice()).toBe("Reference plugin unloaded"); expect(f.deps.send).not.toHaveBeenCalled();
  f.queue.setPaused(false); expect(f.queue.getNotice()).toBeNull();
});

it("native preemption owns its replacement completion even when the old receipt arrives late", async () => {
  const f = await fixture();
  let finish!: (receipt: SubmitReceipt) => void;
  vi.mocked(f.deps.send).mockImplementationOnce(request => { request.onDispatch?.(request.sessionId); return new Promise(resolve => { finish = resolve; }); });
  f.worker.completed("target"); await vi.waitFor(() => expect(f.deps.send).toHaveBeenCalledOnce());
  f.activate(); f.worker.displaced("target"); f.worker.completed("target");
  finish({ kind: "accepted" }); await tick();
  expect(f.deps.drainNative).not.toHaveBeenCalled(); expect(f.deps.send).toHaveBeenCalledOnce();
  expect(f.queue.getSnapshot()).toEqual([row("second")]);
});

it("teardown releases an idle watcher and cannot wake a cancelled preparation", async () => {
  const f = await fixture(); f.busy(true); f.worker.completed("target"); await tick();
  expect(f.watchers.size).toBe(1);
  f.worker.setEnabled(false); await tick(); expect(f.watchers.size).toBe(0);
  f.busy(false); f.worker.completed("target"); await tick();
  expect(f.deps.send).not.toHaveBeenCalled(); expect(f.queue.getSnapshot()).toHaveLength(2);
});

it.each([false, true])("cleans a removed prepared image only when no native draft owns it (retained=%s)", async retained => {
  removeFile.mockClear();
  const attachment = { uiId: "ui", name: "removed.png", mime: "image/png", size: 3, kind: "image" as const, attachmentId: "cancelled-file" };
  const f = await fixture([{ ...row("first"), attachments: [attachment] }]);
  f.deps.retainedAttachments = () => retained ? [attachment] : [];
  f.busy(true); f.worker.completed("target"); await tick();
  deleteUnretainedAttachments([attachment], []);
  expect(removeFile).not.toHaveBeenCalled();
  f.queue.update([]); await tick();
  expect(f.deps.send).not.toHaveBeenCalled(); expect(removeFile).toHaveBeenCalledTimes(retained ? 0 : 1);
});


async function redirectedFixture() {
  const f = await fixture();
  const other = createPendingQueueSource({
    get: async () => ({}), set: async () => {}, remove: async () => {}, watch: () => () => {},
  }, "rotated");
  await other.ready();
  f.deps.queue = id => id === "target" ? f.queue : other;
  return { ...f, other };
}

it("uses the prepared target completion to continue the source queue and ignores the old source completion", async () => {
  const f = await redirectedFixture();
  vi.mocked(f.deps.send).mockImplementation(async request => {
    request.onDispatch?.("rotated"); return { kind: "accepted" };
  });
  f.worker.completed("target"); await tick();
  expect(f.deps.send).toHaveBeenCalledTimes(1);
  f.worker.completed("target"); await tick();
  expect(f.deps.send).toHaveBeenCalledTimes(1);
  f.worker.completed("rotated"); await tick();
  expect(vi.mocked(f.deps.send).mock.calls.map(([request]) => [request.sessionId, request.text]))
    .toEqual([["target", "first"], ["target", "second"]]);
});

it.each(["interrupted", "displaced"] as const)("%s at the prepared target parks the original queue even before the receipt", async event => {
  const f = await redirectedFixture();
  let finish!: (receipt: SubmitReceipt) => void;
  vi.mocked(f.deps.send).mockImplementation(request => {
    request.onDispatch?.("rotated"); return new Promise(resolve => { finish = resolve; });
  });
  f.worker.completed("target"); await tick();
  f.worker[event]("rotated");
  finish({ kind: "accepted" }); await tick();
  f.worker.completed("rotated"); await tick();
  expect(f.queue.isPaused()).toBe(true);
  expect(f.queue.getSnapshot().map(row => row.queueId)).toEqual(["second"]);
  expect(f.deps.send).toHaveBeenCalledTimes(1);
});

it("settles a redirected completion received before its receipt exactly once", async () => {
  const f = await redirectedFixture();
  let finish!: (receipt: SubmitReceipt) => void;
  vi.mocked(f.deps.send).mockImplementationOnce(request => {
    request.onDispatch?.("rotated"); return new Promise(resolve => { finish = resolve; });
  });
  f.worker.completed("target"); await tick();
  f.worker.completed("rotated");
  expect(f.deps.send).toHaveBeenCalledTimes(1);
  finish({ kind: "accepted" }); await tick();
  expect(f.deps.send).toHaveBeenCalledTimes(2);
  expect(f.queue.getSnapshot()).toEqual([]);
});


it("keeps a redirected Stop authoritative after completion but before receipt settlement", async () => {
  const f = await redirectedFixture();
  let finish!: (receipt: SubmitReceipt) => void;
  vi.mocked(f.deps.send).mockImplementationOnce(request => {
    request.onDispatch?.("rotated"); return new Promise(resolve => { finish = resolve; });
  });
  f.worker.completed("target"); await tick();
  f.worker.completed("rotated");
  f.worker.interrupted("rotated");
  finish({ kind: "accepted" }); await tick();
  expect(f.queue.isPaused()).toBe(true);
  expect(f.other.isPaused()).toBe(true);
  expect(f.deps.send).toHaveBeenCalledTimes(1);
});
