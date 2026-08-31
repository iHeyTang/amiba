import { describe, expect, it, vi } from "vitest";

import type { SnapshotFrame, SubmitPayload } from "../protocol/index.js";
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
