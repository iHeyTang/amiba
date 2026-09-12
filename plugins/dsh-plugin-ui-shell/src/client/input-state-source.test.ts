import { describe, expect, it, vi } from "vitest";
import type { ComposerAttachment, ConversationInputState } from "@amiba/extension-sdk";
import { createInputStateSource, type InputQueueSession } from "./input-state-source.js";
import type { InputDraftSource } from "./input-trigger-bridge.js";
function store<T>(initial: T) {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    set(value: T) { current = value; for (const fn of listeners) fn(); },
    count: () => listeners.size,
  };
}
const draftValue = { draft: "native draft", draftRev: 4, occurrences: [], phase: "plain" as const };
const queued: ConversationInputState["queue"] = [{
  id: "host-message" as never, messageId: "host-message" as never, placement: "queued",
  content: [{ type: "text", text: "Host accepted" }], preview: "Host accepted", text: "Host accepted",
}];
function setup() {
  const draft = store<ReturnType<InputDraftSource["getSnapshot"]>>(draftValue);
  const image = { id: "browser-image" as ComposerAttachment["id"], kind: "image" as const, file: {} as File, previewUrl: "blob:one" };
  const images = store<readonly ComposerAttachment[] | undefined>([image]);
  const session = store({ queue: [] as ConversationInputState["queue"] });
  let current: InputQueueSession | undefined = session;
  const roster = store(0);
  const source = createInputStateSource({ draft, images, session: () => current, subscribeSessions: roster.subscribe });
  return { source, draft, images, image, session, roster, replace(next: InputQueueSession | undefined) { current = next; roster.set(roster.getSnapshot() + 1); } };
}

describe("native input state composed with the Host inbox", () => {
  it("preserves real queue identity and draft revision across image and phase changes", () => {
    const env = setup();
    const first = env.source.getSnapshot()!;
    expect(first).toEqual({ ...draftValue, imageIds: [env.image.id], queue: [] });
    expect(env.source.getSnapshot()).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.imageIds)).toBe(true);
    env.session.set({ queue: queued });
    const next = env.source.getSnapshot()!;
    expect(next.queue).toBe(queued);
    expect(next.imageIds).toBe(first.imageIds);
    expect(next.draftRev).toBe(4);
    expect(first.queue).toEqual([]);
    env.draft.set({ ...draftValue, phase: "submitting", claim: { token: "/command ", images: true } });
    expect(env.source.getSnapshot()).toMatchObject({ phase: "submitting", draftRev: 4, queue: queued });
    env.images.set([]);
    expect(env.source.getSnapshot()!.imageIds).toEqual([]);
    expect(env.source.getSnapshot()!.draft).toBe("native draft");
  });

  it("does not fabricate a complete input when any real owner is missing", () => {
    const env = setup();
    env.draft.set(undefined);
    expect(env.source.getSnapshot()).toBeUndefined();
    env.draft.set(draftValue);
    env.images.set(undefined);
    expect(env.source.getSnapshot()).toBeUndefined();
    env.images.set([]);
    env.replace(undefined);
    expect(env.source.getSnapshot()).toBeUndefined();
    env.replace(env.session);
    expect(env.source.getSnapshot()).toMatchObject({ draft: "native draft", imageIds: [], queue: [] });
  });

  it("subscribes to all owners, replaces queue bindings, and disposes idempotently", () => {
    const env = setup();
    const notify = vi.fn();
    const off = env.source.subscribe(notify);
    env.draft.set({ ...draftValue, draft: "edited" });
    env.images.set([]);
    env.session.set({ queue: queued });
    expect(notify).toHaveBeenCalledTimes(3);
    const replacement = store({ queue: queued });
    env.replace(replacement);
    expect(env.session.count()).toBe(0);
    const count = notify.mock.calls.length;
    env.session.set({ queue: [] });
    expect(notify).toHaveBeenCalledTimes(count);
    replacement.set({ queue: [] });
    expect(notify).toHaveBeenCalledTimes(count + 1);
    off(); off();
    expect(env.draft.count() + env.images.count() + env.roster.count() + replacement.count()).toBe(0);
  });

  it("ignores a stale notification even if the same queue owner is reattached", () => {
    const env = setup();
    const callbacks: Array<() => void> = [];
    const queue = { getSnapshot: () => ({ queue: queued }), subscribe: (fn: () => void) => { callbacks.push(fn); return () => {}; } };
    env.replace(queue);
    const notify = vi.fn();
    const off = env.source.subscribe(notify);
    env.replace(undefined);
    env.replace(queue);
    notify.mockClear();
    callbacks[0]();
    expect(notify).not.toHaveBeenCalled();
    callbacks[1]();
    expect(notify).toHaveBeenCalledTimes(1);
    off(); callbacks[1]();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
