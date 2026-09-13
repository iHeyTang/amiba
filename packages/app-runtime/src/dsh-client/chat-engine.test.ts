import { describe, expect, it, vi } from "vitest";

import type {
  SnapshotFrame,
  StreamEvent,
  SubmitPayload,
} from "../protocol/index.js";
import { DshChatEngineClient } from "./chat-engine.js";
import type { DshApiClient, DshMuxEnvelope } from "./index.js";

async function eventually(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
  assertion();
}

function payload(overrides: Partial<SubmitPayload> = {}): SubmitPayload {
  return {
    sessionId: "session-1",
    assistantUiId: "assistant-1",
    history: [{ role: "user", content: "/status" }],
    ...overrides,
  };
}

describe("DshChatEngineClient", () => {
  it("sends a cold child prompt after mux readiness without waiting for a child subscription", async () => {
    const order: string[] = [];
    const address = { parentSessionId: "parent", childSessionId: "session-1", mode: "continuable" as const };
    const subagentPrompt = vi.fn(async () => { order.push("prompt"); return { messageId: "child-message" }; });
    const createSession = vi.fn();
    const selectModel = vi.fn();
    const resolveSession = vi.fn();
    const prompt = vi.fn();
    const client = { createSession, selectModel, prompt, subagentPrompt,
      async openEvents() {
        order.push("ready");
        return (async function* () { order.push("read"); yield TURN_END; })();
      },
    } as unknown as DshApiClient;
    const engine = new DshChatEngineClient({ client, resolveSession, resolveSubagent: () => address });
    const events: string[] = [];
    engine.onStreamEvent((_id, event) => events.push(event.kind));
    engine.submit(payload({ modelSelection: { provider: "unused", model: "unused" } }));
    await eventually(() => expect(events).toContain("done"));
    expect(order).toEqual(["ready", "prompt", "read"]);
    expect(subagentPrompt).toHaveBeenCalledWith(address, [{ type: "text", text: "/status" }], expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(createSession).not.toHaveBeenCalled();
    expect(selectModel).not.toHaveBeenCalled();
    expect(resolveSession).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
  });

  it("surfaces unavailable-parent errors and closes the mux without waiting for any child frame", async () => {
    const next = vi.fn();
    const close = vi.fn(async () => ({ done: true, value: undefined }));
    const client = {
      openEvents: async () => ({ next, return: close }),
      subagentPrompt: async () => { throw new Error("parent unavailable"); },
    } as unknown as DshApiClient;
    const engine = new DshChatEngineClient({ client, resolveSubagent: () => ({ parentSessionId: "parent", childSessionId: "session-1", mode: "continuable" }) });
    const events: StreamEvent[] = [];
    engine.onStreamEvent((_id, event) => events.push(event));
    engine.submit(payload());
    await eventually(() => expect(events).toContainEqual(expect.objectContaining({ kind: "error", message: "parent unavailable" })));
    expect(close).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects one-shot sending before workspace resolution or stream creation", async () => {
    const resolveSession = vi.fn();
    const openEvents = vi.fn();
    const createSession = vi.fn();
    const engine = new DshChatEngineClient({ client: { openEvents, createSession } as unknown as DshApiClient, resolveSession,
      resolveSubagent: () => ({ parentSessionId: "parent", childSessionId: "session-1", mode: "one-shot" }),
    });
    const events: StreamEvent[] = [];
    engine.onStreamEvent((_id, event) => events.push(event));
    engine.submit(payload());
    await eventually(() => expect(events).toContainEqual(expect.objectContaining({ kind: "error", message: "One-shot subagent conversations are read-only" })));
    expect(resolveSession).not.toHaveBeenCalled();
    expect(openEvents).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("stops a continuable child through its retained parent without resuming either Agent", () => {
    const cancel = vi.fn();
    const subagentInterrupt = vi.fn(async () => ({ accepted: true as const }));
    const client = { cancel, subagentInterrupt } as unknown as DshApiClient;
    const address = { parentSessionId: "cold-parent", childSessionId: "child", mode: "continuable" as const };
    const engine = new DshChatEngineClient({ client, resolveSubagent: () => address });
    engine.abort("child");
    expect(subagentInterrupt).toHaveBeenCalledWith(address);
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each(["one-shot", "mismatched"])("does not fall back to root cancellation for a %s child address", (kind) => {
    const cancel = vi.fn();
    const subagentInterrupt = vi.fn();
    const client = { cancel, subagentInterrupt } as unknown as DshApiClient;
    const engine = new DshChatEngineClient({ client, resolveSubagent: () => ({
      parentSessionId: "parent", childSessionId: kind === "mismatched" ? "other" : "child",
      mode: kind === "one-shot" ? "one-shot" : "continuable",
    }) });
    engine.abort("child");
    expect(subagentInterrupt).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("keeps ordinary cancellation for sessions without a catalog address", () => {
    const cancel = vi.fn(async () => ({ accepted: true as const }));
    const subagentInterrupt = vi.fn();
    const engine = new DshChatEngineClient({ client: { cancel, subagentInterrupt } as unknown as DshApiClient, resolveSubagent: () => undefined });
    engine.abort("root");
    expect(cancel).toHaveBeenCalledWith("root");
    expect(subagentInterrupt).not.toHaveBeenCalled();
  });

  it("runs slash commands directly through DSH without an Electron engine", async () => {
    const subscribed: DshMuxEnvelope = {
      rpcId: "subscription",
      payload: { type: "session/subscribed", sessionId: "session-1", lastSeq: 0 },
    };
    const createSession = vi.fn(async () => ({ sessionId: "session-1" }));
    const prompt = vi.fn(async () => ({
      command: { kind: "success" as const, text: "runtime healthy" },
    }));
    const client = {
      createSession,
      prompt,
      selectModel: vi.fn(),
      cancel: vi.fn(async () => ({ accepted: true as const })),
      respondApproval: vi.fn(),
      respondToQuestions: vi.fn(),
      async *events() {
        yield subscribed;
      },
    } as unknown as DshApiClient;
    const engine = new DshChatEngineClient({ client });
    const events: string[] = [];
    engine.onStreamEvent((_sessionId, event) => {
      events.push(event.kind);
    });

    engine.submit(payload());
    await eventually(() => expect(events).toEqual(["begin", "chunk", "done"]));
    expect(createSession).toHaveBeenCalledWith(
      { sessionId: "session-1" },
      expect.any(AbortSignal),
    );
    expect(prompt).toHaveBeenCalledWith(
      "session-1",
      [{ type: "text", text: "/status" }],
      expect.objectContaining({ mode: "queue" }),
    );
  });

  it("resolves native images through the opaque attachment plugin API", async () => {
    const createSession = vi.fn(async () => ({ sessionId: "session-1" }));
    const prompt = vi.fn(async () => ({
      command: { kind: "success" as const, text: "seen" },
    }));
    const client = {
      createSession,
      prompt,
      selectModel: vi.fn(),
      cancel: vi.fn(async () => ({ accepted: true as const })),
      respondApproval: vi.fn(),
      respondToQuestions: vi.fn(),
      async *events() {
        yield {
          rpcId: "subscription",
          payload: {
            type: "session/subscribed" as const,
            sessionId: "session-1",
            lastSeq: 0,
          },
        };
      },
    } as unknown as DshApiClient;
    const readForPrompt = vi.fn(async () => ({
      attachmentId: "att_0123456789abcdef0123456789abcdef",
      name: "screen.png",
      mime: "image/png",
      size: 3,
      kind: "image" as const,
      dataBase64: "AQID",
    }));
    let retained!: () => void;
    const retainForSession = vi.fn(() => new Promise<void>(resolve => { retained = resolve; }));
    const engine = new DshChatEngineClient({
      client,
      attachments: {
        put: vi.fn(),
        remove: vi.fn(),
        retainForSession,
        readForPrompt,
      },
    });

    engine.submit(
      payload({
        history: [{ role: "user", content: "what is this?" }],
        attachments: [
          {
            attachmentId: "att_0123456789abcdef0123456789abcdef",
            name: "screen.png",
            mime: "image/png",
            size: 3,
            kind: "image",
          },
        ],
      }),
    );
    await eventually(() => expect(retainForSession).toHaveBeenCalledOnce());
    expect(readForPrompt).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
    retained();
    await eventually(() => expect(prompt).toHaveBeenCalledOnce());
    expect(readForPrompt).toHaveBeenCalledWith(
      "att_0123456789abcdef0123456789abcdef",
    );
    expect(retainForSession).toHaveBeenCalledWith("att_0123456789abcdef0123456789abcdef", "session-1");
    expect(retainForSession.mock.invocationCallOrder[0]).toBeLessThan(readForPrompt.mock.invocationCallOrder[0]);
    const promptCall = prompt.mock.calls[0] as unknown as [string, unknown];
    expect(promptCall[1]).toEqual([
      { type: "text", text: "what is this?" },
      {
        type: "image",
        mediaType: "image/png",
        data: "AQID",
        name: "screen.png",
      },
    ]);
  });

  it("carries DSH-pending ask-user questions into absent snapshots", async () => {
    // DSH replays unanswered question/requested frames as a baseline on
    // every events.mux connect; the watcher the first subscribe() starts
    // must fold that into the ledger so a session with no run state (the
    // post-reload case) still snapshots its blocking question.
    const questionEnvelope = {
      rpcId: "rpc-q1",
      payload: {
        type: "question/requested",
        sessionId: "session-1",
        questions: [{ id: "q1", question: "which one?" }],
      },
    } as unknown as DshMuxEnvelope;
    const client = {
      async *events() {
        yield questionEnvelope;
        // Hold the connection open like a real mux socket would.
        await new Promise(() => {});
      },
    } as unknown as DshApiClient;
    const engine = new DshChatEngineClient({ client });
    const snapshots: SnapshotFrame[] = [];
    const streamed: string[] = [];
    engine.onSnapshot((frame) => snapshots.push(frame));
    engine.onStreamEvent((_sessionId, event) => streamed.push(event.kind));

    engine.subscribe("session-1");
    await eventually(() => expect(streamed).toContain("questionRequest"));

    engine.requestSnapshot("session-1");
    const last = snapshots.at(-1);
    expect(last?.kind).toBe("absent");
    expect(
      (last as Extract<SnapshotFrame, { kind: "absent" }>).pendingQuestions,
    ).toHaveLength(1);
    engine.dispose();
  });
});

/** One `session/event` mux frame for `session-1`. */
function sessionFrame(
  type: string,
  data: Record<string, unknown>,
  seq = 1,
): DshMuxEnvelope {
  return {
    rpcId: "rpc",
    payload: {
      type: "session/event",
      sessionId: "session-1",
      event: { type, seq, time: seq * 10, data },
    },
  } as unknown as DshMuxEnvelope;
}

const RELAYED_MESSAGE = sessionFrame(
  "user/message",
  {
    id: "m1",
    source: { kind: "plugin", plugin: "amiba-steward", form: "relay" },
    content: [{ type: "text", text: "去查一下构建为什么挂了" }],
  },
  1,
);
const TURN_START = sessionFrame("turn/start", { turn: 1 }, 2);
const CHUNK = sessionFrame(
  "assistant/chunk",
  { chunk: { type: "text-delta", index: 0, text: "on it" } },
  3,
);
const TURN_END = sessionFrame("turn/end", { reason: { kind: "completed" } }, 4);

/**
 * A client whose `events()` replays `script` to EVERY consumer and then holds
 * the connection open — the shape of a real mux socket, where the watcher and
 * a local `run()` each hold their own subscription to the same broadcast.
 */
function scriptedClient(script: DshMuxEnvelope[]): DshApiClient {
  return {
    createSession: vi.fn(async () => ({ sessionId: "session-1" })),
    prompt: vi.fn(async () => ({})),
    selectModel: vi.fn(),
    cancel: vi.fn(async () => ({ accepted: true as const })),
    respondApproval: vi.fn(),
    respondToQuestions: vi.fn(),
    async *events() {
      for (const envelope of script) yield envelope;
      await new Promise(() => {});
    },
  } as unknown as DshApiClient;
}

describe("DshChatEngineClient host-started turns", () => {
  it("streams a turn nobody in this window submitted", async () => {
    const engine = new DshChatEngineClient({
      client: scriptedClient([RELAYED_MESSAGE, TURN_START, CHUNK, TURN_END]),
    });
    const events: StreamEvent[] = [];
    engine.onStreamEvent((sessionId, event) => {
      if (sessionId === "session-1") events.push(event);
    });

    // No submit at all: opening the conversation is the only local action.
    engine.subscribe("session-1");
    await eventually(() =>
      expect(events.map((event) => event.kind)).toEqual([
        "userMessage",
        "begin",
        "turn",
        "chunk",
        "done",
      ]),
    );
    expect(events[0]).toMatchObject({
      kind: "userMessage",
      uiId: "dsh:m1",
      content: "去查一下构建为什么挂了",
      origin: { kind: "plugin", plugin: "amiba-steward" },
    });
    // The assistant bubble the surface opens on `begin` is the one the
    // chunks and the terminal event belong to.
    expect(events[1]).toMatchObject({ kind: "begin" });
    engine.dispose();
  });

  it("snapshots a passive run so a tab switch recovers the stream", async () => {
    // No terminal frame: the host turn is still in flight when the snapshot
    // is requested, exactly as it would be on a switch back.
    const engine = new DshChatEngineClient({
      client: scriptedClient([TURN_START, CHUNK]),
    });
    const snapshots: SnapshotFrame[] = [];
    engine.onSnapshot((frame) => snapshots.push(frame));
    const events: StreamEvent[] = [];
    engine.onStreamEvent((_sessionId, event) => events.push(event));

    engine.subscribe("session-1");
    await eventually(() =>
      expect(events.map((event) => event.kind)).toContain("chunk"),
    );

    engine.requestSnapshot("session-1");
    const last = snapshots.at(-1);
    expect(last?.kind).toBe("live");
    const live = last as Extract<SnapshotFrame, { kind: "live" }>;
    expect(live.state.assistantText).toBe("on it");
    expect(live.state.runtimeTurn).toBe(1);
    expect(events.find(event => event.kind === "turn")).toMatchObject({ runtimeTurn: 1 });
    expect(live.state.assistantUiId).toBe(
      (events.find((event) => event.kind === "begin") as
        | Extract<StreamEvent, { kind: "begin" }>
        | undefined)?.assistantUiId,
    );
    engine.dispose();
  });

  it("stays out of a session a local run owns, so nothing arrives twice", async () => {
    const subscribed = {
      rpcId: "subscription",
      payload: {
        type: "session/subscribed",
        sessionId: "session-1",
        lastSeq: 0,
      },
    } as unknown as DshMuxEnvelope;
    const engine = new DshChatEngineClient({
      client: scriptedClient([subscribed, TURN_START, CHUNK, TURN_END]),
    });
    const events: StreamEvent[] = [];
    engine.onStreamEvent((sessionId, event) => {
      if (sessionId === "session-1") events.push(event);
    });

    // The watcher is running (subscribe) AND a local turn is in flight; the
    // controller `submit` sets synchronously is what the watcher defers to.
    engine.subscribe("session-1");
    engine.submit(payload({ history: [{ role: "user", content: "go" }] }));
    await eventually(() =>
      expect(events.map((event) => event.kind)).toContain("done"),
    );
    // Let any lagging watcher frames land before asserting there are none.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events.map((event) => event.kind)).toEqual([
      "begin",
      "turn",
      "chunk",
      "done",
    ]);
    engine.dispose();
  });

  it("settles the host bubble when the user takes the session back", async () => {
    // The host turn never reaches its own terminal frame before the person
    // submits: without an explicit settle its bubble would spin forever,
    // because the local state replaces the passive one and every remaining
    // frame is then dropped.
    const engine = new DshChatEngineClient({
      // No terminal frame: the host turn is still in flight when the person
      // submits, which is the whole point.
      client: scriptedClient([TURN_START, CHUNK]),
    });
    const events: StreamEvent[] = [];
    engine.onStreamEvent((sessionId, event) => {
      if (sessionId === "session-1") events.push(event);
    });

    engine.subscribe("session-1");
    await eventually(() =>
      expect(events.map((event) => event.kind)).toEqual([
        "begin",
        "turn",
        "chunk",
      ]),
    );
    const hostBubble = (
      events[0] as Extract<StreamEvent, { kind: "begin" }>
    ).assistantUiId;

    engine.submit(payload({ history: [{ role: "user", content: "actually…" }] }));

    // The host run is settled BEFORE the local turn begins, and names its
    // own bubble — the surface has already primed for the local one, so an
    // unnamed abort would seal the wrong message.
    expect(events.map((event) => event.kind)).toEqual([
      "begin",
      "turn",
      "chunk",
      "aborted",
      "begin",
    ]);
    expect(events[3]).toEqual({ kind: "aborted", assistantUiId: hostBubble });
    expect(
      (events[4] as Extract<StreamEvent, { kind: "begin" }>).assistantUiId,
    ).toBe("assistant-1");

    // Whatever the host turn emits from here belongs to a run this window no
    // longer follows: the local run owns the session.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      events.filter((event) => event.kind === "aborted"),
    ).toHaveLength(1);
    engine.dispose();
  });
});

it("retains separate reasoning segments in a live snapshot around a tool call",async()=>{
 const engine=new DshChatEngineClient({client:scriptedClient([TURN_START,
 sessionFrame("assistant/chunk",{chunk:{type:"reasoning-delta",index:0,text:"before"}},3),
 sessionFrame("tool/call",{callId:"c",name:"bash",arguments:"{}"},4),
 sessionFrame("assistant/chunk",{chunk:{type:"reasoning-delta",index:0,text:"after"}},5)])});
 const events:StreamEvent[]=[];const snapshots:SnapshotFrame[]=[];
 engine.onStreamEvent((_,event)=>events.push(event));engine.onSnapshot(frame=>snapshots.push(frame));engine.subscribe("session-1");
 await eventually(()=>expect(events.filter(event=>event.kind==="reasoning")).toHaveLength(2));
 engine.requestSnapshot("session-1");
 const live=snapshots.at(-1) as Extract<SnapshotFrame,{kind:"live"}>;
 expect(live.state.timeline.map(item=>item.kind)).toEqual(["reasoning","tool","reasoning"]);
 engine.dispose();
});


describe("compaction event delivery", () => {
  it.each(["running", "completed", "failed"])("restores %s compaction from a passive snapshot", async (status) => {
    const script = [TURN_START, sessionFrame("compaction/start", { compactionId: "compact-1" }, 3)];
    if (status !== "running") {
      script.push(sessionFrame("compaction/summary", { compactionId: "compact-1", summary: [{ type: "text", text: "checkpoint" }] }, 4));
      script.push(sessionFrame("compaction/end", { compactionId: "compact-1", ...(status === "failed" ? { error: "timeout" } : {}) }, 5));
    }
    const engine = new DshChatEngineClient({ client: scriptedClient(script) });
    const events: StreamEvent[] = [];
    const snapshots: SnapshotFrame[] = [];
    engine.onStreamEvent((_id, event) => events.push(event));
    engine.onSnapshot(frame => snapshots.push(frame));
    engine.subscribe("session-1");
    await eventually(() => expect(events.filter(event => event.kind === "compaction")).toHaveLength(status === "running" ? 1 : 3));
    engine.requestSnapshot("session-1");
    const snapshot = snapshots.at(-1) as Extract<SnapshotFrame, { kind: "live" }>;
    expect(snapshot.kind).toBe("live");
    expect(snapshot.state.error).toBeNull();
    expect(snapshot.state.timeline).toMatchObject([{ kind: "compaction", compaction: { compactionId: "compact-1", status } }]);
    engine.dispose();
  });

  it("delivers compaction only once while the local run and watcher both subscribe", async () => {
    const script = [
      { rpcId: "sub", payload: { type: "session/subscribed", sessionId: "session-1", lastSeq: 0 } } as DshMuxEnvelope,
      TURN_START,
      sessionFrame("compaction/start", { compactionId: "c" }, 3),
      sessionFrame("compaction/end", { compactionId: "c" }, 4),
      sessionFrame("turn/end", { reason: { kind: "completed" } }, 5),
    ];
    const engine = new DshChatEngineClient({ client: scriptedClient(script) });
    const events: StreamEvent[] = [];
    engine.onStreamEvent((_id, event) => events.push(event));
    engine.subscribe("session-1");
    engine.submit(payload({ history: [{ role: "user", content: "continue" }] }));
    await eventually(() => expect(events.some(event => event.kind === "done")).toBe(true));
    expect(events.filter(event => event.kind === "compaction")).toHaveLength(2);
    engine.dispose();
  });
});


it("keeps finalized text provenance in passive snapshots without mutating an earlier snapshot", async () => {
  const final=sessionFrame("assistant/message",{turn:1,step:2,message:{content:[{type:"text",text:"report.txt"}]}},4);
  (final.payload as any).event.surfaceOp="append";
  const engine=new DshChatEngineClient({client:scriptedClient([
    TURN_START,
    sessionFrame("assistant/chunk",{turn:1,step:2,chunk:{type:"text-delta",index:0,text:"report.txt"}},3),
    final,
  ])});
  const snapshots:SnapshotFrame[]=[];
  engine.onSnapshot(frame=>snapshots.push(frame));
  engine.onStreamEvent((id,event)=>{if(event.kind==="chunk"||event.kind==="assistantTextSource")engine.requestSnapshot(id);});
  engine.subscribe("session-1");
  await eventually(()=>expect(snapshots.filter(s=>s.kind==="live")).toHaveLength(2));
  const live=snapshots.filter(s=>s.kind==="live") as Extract<SnapshotFrame,{kind:"live"}>[];
  expect(live[0].state.timeline[0]).toMatchObject({text:"report.txt",sourceRanges:[{start:0,end:10,runtimeStep:2}]});
  expect((live[0].state.timeline[0] as any).sourceRanges[0]).not.toHaveProperty("runtimeSeq");
  expect(live[1].state.timeline[0]).toMatchObject({text:"report.txt",sourceRanges:[{start:0,end:10,runtimeStep:2,runtimeSeq:4}]});
  engine.dispose();
});

describe("official running baseline", () => {
  function source(initial: boolean) {
    let running=initial;
    const listeners=new Set<()=>void>();
    return {getSnapshot:()=>({running}),subscribe:vi.fn((listener:()=>void)=>{listeners.add(listener);return()=>listeners.delete(listener);}),
      set(value:boolean){running=value;for(const listener of listeners)listener();},listeners};
  }
  const quietClient = () => ({async *events(signal:AbortSignal){await new Promise<void>(resolve=>{if(signal.aborted)resolve();else signal.addEventListener("abort",()=>resolve(),{once:true});});}} as unknown as DshApiClient);
  it("restores Host activity without synthesizing a turn or assistant bubble and follows its idle edge", () => {
    const activity=source(true), frames:SnapshotFrame[]=[],events:StreamEvent[]=[];
    const engine=new DshChatEngineClient({client:quietClient(),sessionActivity:()=>activity});
    engine.onSnapshot(frame=>frames.push(frame));engine.onStreamEvent((_id,event)=>events.push(event));
    engine.subscribe("restored");
    expect(frames.at(-1)).toEqual({type:"snapshot",sessionId:"restored",kind:"absent",hostRunning:true});
    const count=frames.length;activity.set(true);expect(frames).toHaveLength(count);
    activity.set(false);
    expect(frames.at(-1)).toEqual({type:"snapshot",sessionId:"restored",kind:"absent",hostRunning:false});
    expect(events).toEqual([]);
    engine.dispose();expect(activity.listeners.size).toBe(0);
  });
  it("isolates sessions, replaces sources, and ignores stale notifications after clear or dispose", () => {
    const one=source(true),two=source(false),replacement=source(false),frames:SnapshotFrame[]=[];
    let first=one;
    const engine=new DshChatEngineClient({client:Object.assign(quietClient(),{cancel:vi.fn(async()=>{})}),sessionActivity:id=>id==="one"?first:two});
    engine.onSnapshot(frame=>frames.push(frame));engine.subscribe("one");engine.subscribe("two");engine.subscribe("one");
    expect(one.subscribe).toHaveBeenCalledOnce();
    first=replacement;engine.requestSnapshot("one");
    expect(one.listeners.size).toBe(0);
    const count=frames.length;one.set(false);expect(frames).toHaveLength(count);
    two.set(true);expect(frames.at(-1)).toMatchObject({sessionId:"two",hostRunning:true});
    engine.clear("one");expect(replacement.listeners.size).toBe(0);
    engine.dispose();expect(two.listeners.size).toBe(0);expect(replacement.listeners.size).toBe(0);
    const finalCount=frames.length;two.set(false);engine.subscribe("two");expect(frames).toHaveLength(finalCount);
  });
  it("does not let a delayed idle baseline override a locally pending submission", () => {
    const activity=source(true),frames:SnapshotFrame[]=[];
    const client=Object.assign(quietClient(),{createSession:async()=>({sessionId:"session-1"}),openEvents:()=>new Promise(()=>{})});
    const engine=new DshChatEngineClient({client,sessionActivity:()=>activity});
    engine.onSnapshot(frame=>frames.push(frame));engine.subscribe("session-1");engine.submit(payload());
    activity.set(false);
    expect(frames.at(-1)).toMatchObject({kind:"live",state:{streaming:true}});
    expect(frames.at(-1)?.hostRunning).toBeUndefined();
    engine.dispose();
  });
});
