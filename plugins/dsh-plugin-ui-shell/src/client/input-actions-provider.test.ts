import { describe, expect, it, vi } from "vitest";
import type { ConversationInputActions } from "@amiba/extension-sdk";
import { createInputActionsProvider } from "./input-actions-provider.js";
import { createComposerDraftSource } from "../../../../packages/ui/src/chat/composer-draft-store";
import { composerDraftDisplayText } from "../../../../packages/ui/src/chat/composer-draft-document";
import { createInputTriggerBridge, type InputTriggerBridgeDeps } from "./input-trigger-bridge.js";
import { sessionPendingQueue } from "@amiba/ui/composer-runtime";

function fixture(residentDraft?: InputTriggerBridgeDeps["residentDraft"], pendingQueue?: InputTriggerBridgeDeps["pendingQueue"]) {
  const bridge = createInputTriggerBridge({
    residentDraft,
    pendingQueue,
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
  it("uses the existing native queue after hydration when local turn preparation is busy", async () => {
    let finish!: (values: Record<string, unknown>) => void;
    const storage = {
      get: vi.fn(() => new Promise<Record<string, unknown>>(resolve => { finish = resolve; })),
      set: vi.fn(async (_values: Record<string, unknown>) => {}), remove: vi.fn(async (_keys: string | string[]) => {}), watch: () => () => {},
    };
    const source = createComposerDraftSource();
    const queue = sessionPendingQueue(storage, "a");
    queue.setPaused(true);
    const { bridge, actions } = fixture(() => source, () => queue);
    const action = actions("a");
    const send = vi.fn(async () => ({ kind: "accepted" as const }));
    bridge.bindResidentTurnSender!(send, () => true);
    action.setDraft("new queued input"); action.submit(); action.submit();
    await vi.waitFor(() => expect(storage.get).toHaveBeenCalled());
    expect(source.getSnapshot()).toBe("new queued input");
    expect(queue.isPaused()).toBe(true);
    finish({ "pendingQueue:a": [{ queueId: "older", text: "older input", attachments: [] }] });
    await vi.waitFor(() => expect(bridge.inputSubmissionSource!("a").getSnapshot().pending).toBe(false));
    await queue.flush();
    expect(queue.getSnapshot()).toHaveLength(2);
    expect(queue.getSnapshot()[1]).toMatchObject({ text: "new queued input", draft: { text: "new queued input" }, attachments: [] });
    expect(source.getSnapshot()).toBe("");
    expect(send).not.toHaveBeenCalled();
    expect(queue.isPaused()).toBe(false);
  });
  it("a rejected resident preparation keeps Stop, and only an actual explicit dispatch resumes that session", async () => {
    const storage = { get: async () => ({}), set: async () => {}, remove: async () => {}, watch: () => () => {} };
    const source = createComposerDraftSource();
    const a = sessionPendingQueue(storage, "a"), b = sessionPendingQueue(storage, "b");
    a.setPaused(true); b.setPaused(true);
    const { bridge, actions } = fixture(() => source, id => sessionPendingQueue(storage, id));
    const action = actions("a");
    const send = vi.fn<Parameters<NonNullable<typeof bridge.bindResidentTurnSender>>[0]>(async () => ({ kind: "rejected", error: "Workspace missing" }));
    bridge.bindResidentTurnSender!(send);
    action.setDraft("explicit retry"); action.submit();
    await vi.waitFor(() => expect(bridge.inputSubmissionSource!("a").getSnapshot().pending).toBe(false));
    expect(a.isPaused()).toBe(true);
    expect(source.getSnapshot()).toBe("explicit retry");
    send.mockImplementation(async request => { request.onDispatch?.(); return { kind: "accepted" }; });
    action.submit();
    await vi.waitFor(() => expect(bridge.inputSubmissionSource!("a").getSnapshot().pending).toBe(false));
    expect(a.isPaused()).toBe(false);
    expect(b.isPaused()).toBe(true);
  });
  it("submits a resident draft through standard actions and retains edits made after dispatch", async () => {
    const source = createComposerDraftSource();
    const { bridge, actions } = fixture(() => source);
    const action = actions("a");
    let finish!: (value: import("@amiba/app-runtime/protocol").SubmitReceipt) => void;
    const send = vi.fn<Parameters<NonNullable<typeof bridge.bindResidentTurnSender>>[0]>(request => {
      request.onDispatch?.();
      return new Promise(resolve => { finish = resolve; });
    });
    bridge.bindResidentTurnSender!(send);
    action.setDraft("background message");
    action.submit(); action.submit();
    expect(bridge.inputStateSource("a").getSnapshot()?.phase).toBe("adjudicating");
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0]).toMatchObject({ sessionId: "a", text: "background message" });
    expect(bridge.inputStateSource("a").getSnapshot()?.phase).toBe("submitting");
    action.setDraft("new text");
    finish({ kind: "accepted" });
    await vi.waitFor(() => expect(bridge.inputSubmissionSource!("a").getSnapshot().pending).toBe(false));
    expect(bridge.inputStateSource("a").getSnapshot()).toMatchObject({ draft: "new text", phase: "plain" });
  });
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


it("edits the addressed resident document offscreen and never bypasses a mounted editor's refusal", () => {
  const sources=new Map<string,ReturnType<typeof createComposerDraftSource>>();
  let watches=0;
  const sourceFor=(id:string)=>{
    let source=sources.get(id);
    if(!source){source=createComposerDraftSource();sources.set(id,source);}
    return source;
  };
  const {actions,bind,provider,bridge}=fixture(id=>{
    const source=sourceFor(id);
    return {readInputDraft:source.readInputDraft,setDisplayText:source.setDisplayText,subscribe(listener){watches++;const off=source.subscribe(listener);return()=>{watches--;off();};}};
  });
  const source=sourceFor("a");
  source.set("@[dsh.reference:files|id|Label|clip]");
  const action=actions("a"),other=bind("b");
  action.setDraft("@Label literal @[dsh.reference:missing|id|literal|clip]");
  expect(composerDraftDisplayText(source.getDocument())).toBe("@Label literal @[dsh.reference:missing|id|literal|clip]");
  expect(source.getDocument().parts.filter(part=>part.kind==="mention")).toHaveLength(1);
  expect(other.read()).toBe("initial");
  expect(bridge.inputDraftFor("a")).toBeUndefined();
  expect(bridge.inputDraftSource("a").getSnapshot()?.draft).toBe(composerDraftDisplayText(source.getDocument()));
  const mounted=bind("a");mounted.edit.mockReturnValue(false);
  const before=source.getDocument();
  expect(()=>action.setDraft("not admitted")).toThrow("cannot accept");
  expect(source.getDocument()).toBe(before);
  mounted.off();action.setDraft("@Edited literal @[dsh.reference:missing|id|literal|clip]");
  expect(source.getDocument().parts).toEqual([{kind:"text",text:"@Edited literal @[dsh.reference:missing|id|literal|clip]"}]);
  expect(bridge.editInputDraft("unowned","not admitted")).toBe(false);
  expect(sources.has("unowned")).toBe(false);
  provider.dispose();expect(watches).toBe(0);
  expect(()=>action.setDraft("after disposal")).toThrow("cannot accept");
  other.off();
});

it("honors the actual offscreen one-shot session's read-only address", () => {
  const source=createComposerDraftSource();
  const {provider}=fixture(()=>source);
  let mode:"one-shot"|"continuable"="one-shot";
  const owner={sessionId:"child",session:{getSnapshot:()=>({queue:[],subagent:{address:{mode}}}),subscribe:()=>()=>{}},
    ctx:{effect:(effect:()=>()=>void)=>effect()}};
  const action=provider.resolve(owner as never).props!.inputActions as ConversationInputActions;
  expect(()=>action.setDraft("readonly")).toThrow("cannot accept");
  expect(source.getSnapshot()).toBe("");
  mode="continuable";action.setDraft("allowed");
  expect(source.getSnapshot()).toBe("allowed");
  provider.dispose();
});

it("provides non-null standard input before mount, follows native changes, and rejects stale offscreen writes", () => {
  const source = createComposerDraftSource();
  const { provider, bridge, bind } = fixture(() => source);
  const queue: never[] = [];
  const contribution = provider.resolve({ sessionId: "a", session: {
    getSnapshot: () => ({ queue }), subscribe: () => () => {},
  }, ctx: { effect: (effect: () => () => void) => effect() } } as never);
  expect(provider.hooks).toEqual(["input"]);
  const input = contribution.hooks!.input;
  const read = () => input.getSnapshot() as ReturnType<typeof source.readInputDraft> & { imageIds: unknown[]; queue: unknown[] };
  expect(read()).toMatchObject({ draft: "", phase: "plain", imageIds: [], occurrences: [] });
  expect(read().queue).toBe(queue);
  const observed: unknown[] = [];
  const off = input.subscribe(() => observed.push(read()));
  const initial = read();
  source.setDisplayText("resident");
  expect(read().draft).toBe("resident");
  expect(read().draftRev).toBeGreaterThan(initial.draftRev);
  expect(bridge.setInputDraft("a", "stale", initial.draftRev)).toBe(false);
  expect(bridge.setInputDraft("a", "accepted", read().draftRev)).toBe(true);
  const beforeMount = read();
  const editor = bind("a");
  expect(read().draft).toBe("initial");
  expect(read().draftRev).toBeGreaterThan(beforeMount.draftRev);
  const mounted = read();
  editor.off();
  expect(read().draft).toBe("accepted");
  expect(read().draftRev).toBeGreaterThan(mounted.draftRev);
  expect(bridge.setInputDraft("a", "stale mounted", mounted.draftRev)).toBe(false);
  expect(observed.length).toBeGreaterThan(3);
  off(); provider.dispose();
});

it("keeps the replacement owner's resident watch and releases stale owner watches exactly once", () => {
  const source=createComposerDraftSource();
  let watches=0;
  const {provider}=fixture(()=>({readInputDraft:source.readInputDraft,setDisplayText:source.setDisplayText,subscribe(listener){watches++;const off=source.subscribe(listener);return()=>{watches--;off();};}}));
  const owner=()=>({sessionId:"same",session:{getSnapshot:()=>({queue:[]}),subscribe:()=>()=>{}},ctx:{effect:(effect:()=>()=>void)=>effect()}});
  const first=owner(),second=owner();
  const actions=provider.resolve(first as never).props!.inputActions as ConversationInputActions;
  expect(watches).toBe(1);
  expect(provider.resolve(second as never).props!.inputActions).toBe(actions);
  expect(watches).toBe(1);
  actions.setDraft("replacement resident draft");
  expect(source.getSnapshot()).toBe("replacement resident draft");
  provider.dispose();provider.dispose();expect(watches).toBe(0);
});
