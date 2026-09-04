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
    const engine = new DshChatEngineClient({
      client,
      attachments: {
        put: vi.fn(),
        remove: vi.fn(),
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
    await eventually(() => expect(prompt).toHaveBeenCalledOnce());
    expect(readForPrompt).toHaveBeenCalledWith(
      "att_0123456789abcdef0123456789abcdef",
    );
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
});
