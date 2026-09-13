import { withSendingAttachments } from "../attachment-ownership";
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createComposerDraftSource } from "../../composer-draft-store";
import { legacyDraftDocument } from "../../composer-draft-document";
import { pickSendText } from "../pickSendText"

// --- Stub the platform + i18n the hook reaches for at import/runtime. The
// queue hook only touches storage (persist effects) and useT (kept stable);
// neither matters for the text-selection assertion. ---
const attachmentFiles = { remove: vi.fn(async () => {}) };
const storage = {
  get: vi.fn(async () => ({})),
  set: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
  watch: vi.fn(() => () => {}),
}
vi.mock("@amiba/app-runtime/platform", () => ({
  getPlatform: () => ({ storage, agentAttachments: attachmentFiles }),
}))
vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (k: string) => k }),
}))

import {
  usePendingQueue,
  type RunChatTurnArgs,
  type UsePendingQueueArgs,
} from "../usePendingQueue"

/** Spy typed with the real runner signature so `.mock.calls[0][0]` narrows
 *  to `RunChatTurnArgs` (not the param-less `() => Promise<void>` default). */
const makeRunChatTurn = () =>
  vi.fn<(args: RunChatTurnArgs) => Promise<void>>(async () => {})

/** Minimal args so the hook mounts; `runChatTurn` is the spy we assert on. */
function makeArgs(
  overrides: Partial<UsePendingQueueArgs> = {},
): UsePendingQueueArgs {
  const runChatTurn = makeRunChatTurn()
  return {
    sessions: {
      ready: true,
      activeId: "s1",
      ensureActive: async () => "s1",
    } as unknown as UsePendingQueueArgs["sessions"],
    client: { abort: vi.fn() } as unknown as UsePendingQueueArgs["client"],
    input: "@[skill:translate] hi",
    setInput: vi.fn(),
    attachments: [],
    setAttachments: vi.fn(),
    setAttachmentError: vi.fn(),
    attachmentUploading: false,
    setPendingSourceApp: vi.fn(),
    busy: false,
    markCurrentAssistantStopped: vi.fn(),
    rejectPendingTurn: vi.fn(),
    runChatTurn,
    ...overrides,
  }
}

describe("usePendingQueue.send — dispatches the mention-expanded text", () => {
  beforeEach(() => vi.clearAllMocks())

  it("preserves the draft and queue while read-only and resumes normal sending after switching back", async () => {
    const args = makeArgs();
    const { result, rerender } = renderHook(({ readOnly }) => usePendingQueue({ ...args, readOnly }), { initialProps: { readOnly: true } });
    await act(async () => { result.current.setQueue([{ queueId: "queued", text: "Later", attachments: [] }]); });
    await act(async () => {
      await result.current.send("New text");
      result.current.sendNow("queued");
      result.current.drainHead();
      result.current.stop();
    });
    expect(args.runChatTurn).not.toHaveBeenCalled();
    expect(args.client.abort).not.toHaveBeenCalled();
    expect(args.setInput).not.toHaveBeenCalled();
    expect(args.setAttachments).not.toHaveBeenCalled();
    expect(result.current.queue).toEqual([{ queueId: "queued", text: "Later", attachments: [] }]);
    rerender({ readOnly: false });
    await act(async () => { result.current.sendNow("queued"); });
    expect(args.runChatTurn).toHaveBeenCalledWith({ text: "Later", attachments: [] });
  });

  it("dispatches the passed (expanded) textArg, NOT the raw input", async () => {
    const runChatTurn = makeRunChatTurn()
    const { result } = renderHook(() =>
      usePendingQueue(makeArgs({ runChatTurn })),
    )

    // The Composer passes the expanded text (raw `@[skill:translate]` token
    // has been turned into agent-facing text). The raw `input` still holds
    // the un-expanded token — the bug was dispatching THAT instead.
    await act(async () => {
      await result.current.send("(skill: translate) hi")
    })

    expect(runChatTurn).toHaveBeenCalledTimes(1)
    expect(runChatTurn.mock.calls[0][0]).toMatchObject({
      text: "(skill: translate) hi",
    })
    // Regression guard: the raw mention token must never reach the engine.
    expect(runChatTurn.mock.calls[0][0].text).not.toContain("@[")
  })

  it("queues the passed (expanded) textArg when busy", async () => {
    const runChatTurn = makeRunChatTurn()
    const { result } = renderHook(() =>
      usePendingQueue(makeArgs({ busy: true, runChatTurn })),
    )

    await act(async () => {
      await result.current.send("(skill: translate) hi")
    })

    // Busy → enqueued, not dispatched. The queued item must carry the
    // expanded text.
    expect(runChatTurn).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.queue).toHaveLength(1))
    expect(result.current.queue[0].text).toBe("(skill: translate) hi")
    expect(result.current.queue[0].text).not.toContain("@[")
  })

  it("falls back to raw input when no override is passed", async () => {
    const runChatTurn = makeRunChatTurn()
    const { result } = renderHook(() =>
      usePendingQueue(makeArgs({ input: "plain message", runChatTurn })),
    )

    await act(async () => {
      await result.current.send()
    })

    expect(runChatTurn.mock.calls[0][0]).toMatchObject({ text: "plain message" })
  })
})

describe("pickSendText", () => {
  it("prefers the override and trims it", () => {
    expect(pickSendText("  expanded  ", "raw")).toBe("expanded")
  })
  it("falls back to raw input (trimmed) when override is undefined", () => {
    expect(pickSendText(undefined, "  raw  ")).toBe("raw")
  })
  it("treats an empty-string override as an intentional empty payload", () => {
    // `expandMentions("")` could legitimately return "" — an override of ""
    // must win over stale raw input rather than silently dispatching it.
    expect(pickSendText("", "raw")).toBe("")
  })
})


describe("queued draft identity", () => {
  const token = "@[dsh.reference:files|id|Label|clip]";
  const mixedDraft = () => {
    const source = createComposerDraftSource();
    source.setParts([{kind:"text",text:token+" "}, ...legacyDraftDocument(token).parts]);
    return source;
  };
  it("retains literal/reference nodes separately from the resolved payload through queue persistence and edit", async () => {
    const draftSource = mixedDraft();
    const document = draftSource.getDocument();
    const args = makeArgs({busy:true, input:document.text, draftSource, setInput:draftSource.set});
    const {result, rerender} = renderHook((props:UsePendingQueueArgs) => usePendingQueue(props), {initialProps:args});
    await act(async () => { await result.current.send("resolved model text"); });
    const queued = result.current.queue[0];
    expect(queued.text).toBe("resolved model text");
    expect(queued.draft).toEqual(document);
    expect(draftSource.getSnapshot()).toBe("");
    await waitFor(() => expect(storage.set).toHaveBeenCalledWith({"pendingQueue:s1":[queued]}));
    // Simulate the JSON persistence boundary before restoring the row.
    act(() => result.current.setQueue(JSON.parse(JSON.stringify([queued]))));
    rerender({...args,input:""});
    act(() => result.current.edit(queued.queueId));
    expect(draftSource.getDocument()).toEqual(document);
    expect(result.current.queue).toHaveLength(1);
    expect(result.current.paused).toBe(true);
  });
  it("passes the resolved edited payload and its original nodes to the runner", async () => {
    const draftSource = mixedDraft();
    const document = draftSource.getDocument();
    const args=makeArgs({input:document.text,draftSource,setInput:draftSource.set});
    const {result}=renderHook(()=>usePendingQueue(args));
    act(()=>result.current.setEditingQueueId("edit"));
    await act(async()=>{await result.current.send("new resolved payload");});
    expect(args.runChatTurn).toHaveBeenCalledWith({text:"new resolved payload",attachments:[],draft:document});
    expect(draftSource.getSnapshot()).toBe("");
  });
  it("routes the editing row's Send now through Composer without clearing or preempting early", async () => {
    const submitComposer=vi.fn(()=>false);
    const args=makeArgs({busy:true,submitComposer});
    const {result}=renderHook(()=>usePendingQueue(args));
    act(()=>{result.current.setEditingQueueId("edit");result.current.setQueue([{queueId:"edit",text:"old",attachments:[]}]);});
    act(()=>result.current.sendNow("edit"));
    expect(submitComposer).toHaveBeenCalledOnce();
    expect(args.runChatTurn).not.toHaveBeenCalled();
    expect(args.client.abort).not.toHaveBeenCalled();
    expect(args.setInput).not.toHaveBeenCalled();
    expect(result.current.queue).toHaveLength(1);
    expect(result.current.editingQueueId).toBe("edit");
  });
  it("carries the original draft on both direct send and automatic queue drain for failure recovery", async () => {
    const draftSource=mixedDraft(),document=draftSource.getDocument();
    const args=makeArgs({draftSource,input:document.text,setInput:draftSource.set});
    const {result}=renderHook(()=>usePendingQueue(args));
    await act(async()=>{await result.current.send("resolved");});
    expect(args.runChatTurn).toHaveBeenLastCalledWith({text:"resolved",attachments:[],draft:document});
    act(()=>result.current.setQueue([{queueId:"later",text:"queued resolved",attachments:[],draft:document}]));
    await act(async()=>{result.current.drainHead();});
    expect(args.runChatTurn).toHaveBeenLastCalledWith({text:"queued resolved",attachments:[],draft:document});
  });
});

it("Send now interrupts the authoritative session even when a reload has no local busy state", async () => {
  const args=makeArgs({busy:false});
  const {result}=renderHook(()=>usePendingQueue(args));
  act(()=>result.current.setQueue([{queueId:"restored",text:"restored payload",attachments:[]}]));
  await act(async()=>{result.current.sendNow("restored");});
  expect(args.client.abort).toHaveBeenCalledWith("s1");
  expect(args.markCurrentAssistantStopped).not.toHaveBeenCalled();
  expect(args.rejectPendingTurn).not.toHaveBeenCalled();
  expect(args.runChatTurn).toHaveBeenCalledWith({text:"restored payload",attachments:[]});
  expect(result.current.queue).toHaveLength(0);
});

describe("stashed drafts resolve before leaving the queue", () => {
  function setup(resolveQueuedDraft: NonNullable<UsePendingQueueArgs["resolveQueuedDraft"]>) {
    const draftSource = createComposerDraftSource();
    const reference = legacyDraftDocument("@[dsh.reference:files|id|Label|clip]");
    draftSource.setParts([{kind:"text", text:"literal @[dsh.reference:files|fake|Fake|clip] "}, ...reference.parts]);
    const document = draftSource.getDocument();
    const args = makeArgs({input:document.text, draftSource, setInput:draftSource.set, resolveQueuedDraft});
    const hook = renderHook((props:UsePendingQueueArgs) => usePendingQueue(props), {initialProps:args});
    act(() => hook.result.current.setQueue([{queueId:"original",text:"already resolved",attachments:[]}]));
    act(() => hook.result.current.edit("original"));
    const stashed = hook.result.current.queue[1];
    act(() => { hook.result.current.setEditingQueueId(null); hook.result.current.setQueue([JSON.parse(JSON.stringify(stashed))]); });
    return {...hook,args,document,stashed};
  }
  it.each(["sendNow", "drainHead"] as const)("%s resolves persisted original nodes once and leaves the current editor alone", async action => {
    let finish!: (text:string)=>void;
    const resolve = vi.fn((_draft, _signal) => new Promise<string>(r=>{finish=r;}));
    const {result,args,document,stashed}=setup(resolve);
    vi.mocked(args.setAttachments).mockClear();
    await act(async()=>{
      if(action==="sendNow") result.current.sendNow(stashed.queueId); else result.current.drainHead();
      if(action==="sendNow") result.current.sendNow(stashed.queueId); else result.current.drainHead();
    });
    expect(stashed.needsResolution).toBe(true);
    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve.mock.calls[0][0]).toEqual(document);
    expect(args.runChatTurn).not.toHaveBeenCalled();
    expect(args.client.abort).not.toHaveBeenCalled();
    expect(result.current.queue).toHaveLength(1);
    await act(async()=>{finish("literal token and resolved reference");});
    expect(args.runChatTurn).toHaveBeenCalledWith({text:"literal token and resolved reference",draft:document,attachments:[]});
    expect(args.setAttachments).not.toHaveBeenCalled();
    expect(result.current.queue).toHaveLength(0);
  });
  it("retains a failed draft, pauses draining, and permits a later retry", async()=>{
    const resolve=vi.fn().mockRejectedValueOnce(new Error("Reference source unavailable")).mockResolvedValueOnce("recovered");
    const {result,args,stashed}=setup(resolve);
    await act(async()=>{result.current.sendNow(stashed.queueId);});
    expect(args.setAttachmentError).toHaveBeenCalledWith("Reference source unavailable");
    expect(args.runChatTurn).not.toHaveBeenCalled();
    expect(args.client.abort).not.toHaveBeenCalled();
    expect(result.current.queue).toHaveLength(1);
    expect(result.current.paused).toBe(true);
    await act(async()=>{result.current.sendNow(stashed.queueId);});
    expect(args.runChatTurn).toHaveBeenCalledOnce();
    expect(result.current.queue).toHaveLength(0);
  });
  it.each(["stop", "remove", "switch", "unmount"] as const)("%s prevents a late codec from dispatching", async action=>{
    let finish!: (text:string)=>void;
    const resolve=vi.fn((_draft,_signal)=>new Promise<string>(r=>{finish=r;}));
    const {result,args,stashed,rerender,unmount}=setup(resolve);
    act(()=>result.current.sendNow(stashed.queueId));
    act(()=>{
      if(action==="stop") result.current.stop();
      if(action==="remove") result.current.remove(stashed.queueId);
      if(action==="switch") rerender({...args,sessions:{...args.sessions,activeId:"s2"}});
      if(action==="unmount") unmount();
    });
    expect(resolve.mock.calls[0][1].aborted).toBe(true);
    await act(async()=>{finish("late");});
    expect(args.runChatTurn).not.toHaveBeenCalled();
  });
});

it("successive drains before a render consume distinct queued turns", async()=>{
  const args=makeArgs();
  const {result}=renderHook(()=>usePendingQueue(args));
  act(()=>result.current.setQueue([{queueId:"a",text:"first",attachments:[]},{queueId:"b",text:"second",attachments:[]}]));
  await act(async()=>{result.current.drainHead();result.current.drainHead();});
  expect(vi.mocked(args.runChatTurn).mock.calls.map(([item])=>item.text)).toEqual(["first","second"]);
});

it("keeps an unresolved queue draft when its codec produces no sendable content", async()=>{
  const draft=legacyDraftDocument("@[dsh.reference:files|id|Label|clip]");
  const args=makeArgs({resolveQueuedDraft:async()=>"   "});
  const {result}=renderHook(()=>usePendingQueue(args));
  act(()=>result.current.setQueue([{queueId:"empty",text:draft.text,draft,needsResolution:true,attachments:[]}]));
  await act(async()=>{result.current.sendNow("empty");});
  expect(args.runChatTurn).not.toHaveBeenCalled();
  expect(args.client.abort).not.toHaveBeenCalled();
  expect(result.current.queue).toHaveLength(1);
  expect(args.setAttachmentError).toHaveBeenCalledWith("Queued draft resolved to empty content");
});


describe("queue attachment ownership", () => {
  const image = (attachmentId:string,uiId=attachmentId) => ({attachmentId,uiId,name:uiId+".png",kind:"image" as const,mime:"image/png",size:3});
  beforeEach(()=>attachmentFiles.remove.mockClear());
  it("cancel edit releases only newly added files, retaining the queued original", async()=>{
    const original=image("shared"), extra=image("new");
    const args=makeArgs({input:"",attachments:[{...original,uiId:"mirror"},extra]});
    const {result}=renderHook(()=>usePendingQueue(args));
    act(()=>{result.current.setQueue([{queueId:"a",text:"queued",attachments:[original]}]);result.current.setEditingQueueId("a");});
    await act(async()=>{result.current.cancelEdit();});
    expect(attachmentFiles.remove.mock.calls).toEqual([["new"]]);
    expect(result.current.queue[0].attachments).toEqual([original]);
    expect(args.setAttachments).toHaveBeenCalledWith([]);
  });
  it("removing one row retains files still owned by another row or the composer", async()=>{
    const shared=image("shared"), composer=image("composer"), gone=image("gone");
    const args=makeArgs({attachments:[composer]});
    const {result}=renderHook(()=>usePendingQueue(args));
    act(()=>result.current.setQueue([{queueId:"a",text:"a",attachments:[shared,composer,gone]},{queueId:"b",text:"b",attachments:[{...shared,uiId:"copy"}]}]));
    await act(async()=>{result.current.remove("a");});
    expect(attachmentFiles.remove.mock.calls).toEqual([["gone"]]);
    await act(async()=>{result.current.remove("b");});
    expect(attachmentFiles.remove.mock.calls).toEqual([["gone"],["shared"]]);
  });
  it("deleting the edited row releases shared row/composer copies only once", async()=>{
    const original=image("shared");
    const args=makeArgs({attachments:[{...original,uiId:"copy"}]});
    const {result}=renderHook(()=>usePendingQueue(args));
    act(()=>{result.current.setQueue([{queueId:"a",text:"a",attachments:[original]}]);result.current.setEditingQueueId("a");});
    await act(async()=>{result.current.remove("a");});
    expect(attachmentFiles.remove.mock.calls).toEqual([["shared"]]);
    expect(args.setAttachments).toHaveBeenCalledWith([]);
  });
});


it("committing edited attachments releases the discarded original without deleting the send payload",async()=>{
  attachmentFiles.remove.mockClear();
  const image=(id:string)=>({attachmentId:id,uiId:id,name:id+".png",mime:"image/png",size:3,kind:"image" as const});
  const args=makeArgs({attachments:[image("kept"),image("new")]});
  const {result}=renderHook(()=>usePendingQueue(args));
  act(()=>{result.current.setQueue([{queueId:"edit",text:"old",attachments:[image("kept"),image("removed")]}]);result.current.setEditingQueueId("edit");});
  await act(async()=>{await result.current.send("edited");});
  expect(attachmentFiles.remove.mock.calls).toEqual([["removed"]]);
  expect(args.runChatTurn).toHaveBeenCalledWith({text:"edited",attachments:[image("kept"),image("new")]});
});


it("deleting a duplicate queue row preserves files held by the dispatched turn",async()=>{
  attachmentFiles.remove.mockClear();
  const shared={attachmentId:"held",uiId:"held",name:"held.png",mime:"image/png",size:3,kind:"image" as const};
  let finish!:()=>void;
  let active!:Promise<void>;
  const args=makeArgs({input:"",runChatTurn:turn=>{
    active=withSendingAttachments(turn.attachments,()=>new Promise<void>(resolve=>{finish=resolve;}));
    return active;
  }});
  const {result}=renderHook(()=>usePendingQueue(args));
  act(()=>result.current.setQueue([{queueId:"send",text:"send",attachments:[shared]},{queueId:"duplicate",text:"later",attachments:[{...shared,uiId:"copy"}]}]));
  act(()=>result.current.sendNow("send"));
  await act(async()=>{result.current.remove("duplicate");});
  expect(result.current.queue).toHaveLength(0);
  expect(attachmentFiles.remove).not.toHaveBeenCalled();
  await act(async()=>{finish();await active;});
  expect(attachmentFiles.remove).not.toHaveBeenCalled();
});
