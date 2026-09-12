import { describe, expect, it, vi } from "vitest";
import type { ConversationInputActions } from "@amiba/extension-sdk";
import { createInputActionsProvider } from "./input-actions-provider.js";
import { createInputTriggerBridge } from "./input-trigger-bridge.js";

function fixture() {
  const bridge = createInputTriggerBridge({
    scopeOf: () => ({ on: () => () => {} }) as never,
    subscribeSessions: () => () => {}, inputTriggers: () => undefined, commandUi: () => undefined,
  });
  const provider = createInputActionsProvider(bridge);
  const owners = new Map<string, { sessionId: string; session: object; ctx: object }>();
  const actions = (sessionId: string) => {
    let owner = owners.get(sessionId);
    if (!owner) {
      owner = { sessionId, session: { getSnapshot: () => ({ queue: [] }), subscribe: () => () => {} },
        ctx: { effect: (effect: () => () => void) => effect() } };
      owners.set(sessionId, owner);
    }
    return provider.resolve(owner as never).props!.inputActions as ConversationInputActions;
  };
  const bind = (sessionId: string) => {
    let draft = "initial";
    const edit = vi.fn((text: string) => { draft = text; return true; });
    const off = bridge.bindEditor(sessionId, {
      beginCommand: () => false, insertReference: () => false, consumeToken: () => false, insertText: () => false,
      readInputDraft: () => ({ draft, draftRev: 0, occurrences: [], phase: "plain" }), editInputDraft: edit,
    });
    return { edit, off, read: () => draft };
  };
  return { bridge, provider, actions, bind };
}

describe("official input action provider", () => {
  it("retains stable actions and targets only their session's current editor", () => {
    const { actions, bind } = fixture();
    const first = bind("a"), other = bind("b"), action = actions("a");
    expect(actions("a")).toBe(action);
    action.setDraft("first edit");
    expect(first.read()).toBe("first edit");
    expect(other.read()).toBe("initial");
    const replacement = bind("a");
    first.off();
    action.setDraft("replacement edit");
    expect(replacement.read()).toBe("replacement edit");
    expect(first.read()).toBe("first edit");
    replacement.off();
    expect(() => action.setDraft("unmounted")).toThrow("not mounted");
    expect(other.read()).toBe("initial");
  });

  it("does not invoke edits for unchanged drafts and exposes unavailable image admission", () => {
    const { actions, bind } = fixture();
    const editor = bind("a"), action = actions("a");
    action.setDraft("initial");
    expect(editor.edit).not.toHaveBeenCalled();
    editor.edit.mockReturnValue(false);
    expect(() => action.setDraft("rejected")).toThrow("cannot accept");
    expect(action.addImages([])).toBe(false);
  });

  it("routes submission to the live native binding without promising completion", () => {
    const { actions, bridge } = fixture();
    const submit = vi.fn(() => true);
    const off = bridge.bindSubmit!("a", submit);
    expect(actions("a").submit()).toBeUndefined();
    expect(submit).toHaveBeenCalledTimes(1);
    actions("b").submit();
    off();
    actions("a").submit();
    expect(submit).toHaveBeenCalledTimes(1);
  });
});


it("uses the materializing session before ID lookup and releases owner subscriptions on teardown", () => {
  const { bridge, provider, bind } = fixture();
  bind("assembling");
  bridge.bindImages!("assembling", {
    getImages: () => [], canAdd: () => true, addImages: () => {}, removeImage: () => {},
  });
  const source = bridge.inputStateSource("assembling");
  const observed: unknown[] = [];
  const off = source.subscribe(() => observed.push(source.getSnapshot()));
  expect(source.getSnapshot()).toBeUndefined();
  function owner(preview: string) {
    const listeners = new Set<() => void>();
    let queue = [{ id: preview, messageId: preview, placement: "queued", content: [], preview, text: preview }];
    const cleanups: (() => void)[] = [];
    const binding = { sessionId: "assembling", session: {
      getSnapshot: () => ({ queue }), subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    }, ctx: { effect(effect: () => () => void) { const cleanup = effect(); cleanups.push(cleanup); return cleanup; } } };
    return { binding, listeners, cleanups, queue: () => queue, update() { queue = []; for (const fn of listeners) fn(); } };
  }
  const first = owner("first"), next = owner("replacement");
  const firstActions = provider.resolve(first.binding as never).props!.inputActions;
  expect(source.getSnapshot()!.queue).toBe(first.queue());
  expect(first.listeners.size).toBe(1);
  expect(provider.resolve(first.binding as never).props!.inputActions).toBe(firstActions);
  expect(first.cleanups).toHaveLength(1);
  const start = observed.length;
  provider.resolve(next.binding as never);
  expect(observed.slice(start)).not.toContain(undefined);
  first.cleanups[0]();
  expect(first.listeners.size).toBe(0);
  expect(source.getSnapshot()!.queue).toBe(next.queue());
  next.update();
  expect(source.getSnapshot()!.queue).toBe(next.queue());
  provider.dispose();
  expect(next.listeners.size).toBe(0);
  expect(source.getSnapshot()).toBeUndefined();
  off();
});
