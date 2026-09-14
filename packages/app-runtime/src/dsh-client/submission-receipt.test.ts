import { expect, it, vi } from "vitest";
import { type DshApiClient, DshRpcError, type DshMuxEnvelope } from "./index";
import { DshChatEngineClient } from "./chat-engine";
import type { SnapshotFrame, StreamEvent, SubmitPayload } from "../protocol";

const payload: SubmitPayload = { sessionId: "session", assistantUiId: "assistant", history: [{ role: "user", content: "hello" }] };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const reply = deferred<{ accepted: true; command?: { kind: "success" | "error"; text?: string } }>();
  const prompt = vi.fn(() => reply.promise);
  const close = vi.fn(async () => ({ done: true as const, value: undefined }));
  const client = {
    listSessions: vi.fn(async () => ({ items: [] })),
    createSession: vi.fn(async () => ({ sessionId: "session" })), prompt,
    cancel: vi.fn(async () => ({ accepted: true })),
    events(signal: AbortSignal) {
      let first = true;
      return { [Symbol.asyncIterator]() { return {
        next() {
          if (first) { first = false; return Promise.resolve({ done: false, value: {
            payload: { type: "session/subscribed", sessionId: "session", lastSeq: 0 },
          } as DshMuxEnvelope }); }
          return new Promise<IteratorResult<DshMuxEnvelope>>(resolve => {
            const stop = () => resolve({ done: true, value: undefined });
            if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
          });
        }, return: close,
      }; } };
    },
  };
  const engine = new DshChatEngineClient({ client: client as unknown as DshApiClient });
  const events: StreamEvent[] = [], snapshots: SnapshotFrame[] = [];
  engine.onStreamEvent((_id, event) => events.push(event));
  engine.onSnapshot(frame => snapshots.push(frame));
  return { engine, client, reply, prompt, close, events, snapshots };
}

it("confirms only the prompt receipt, independently of begin, streaming completion and later abort", async () => {
  const { engine, prompt, reply, events, snapshots } = fixture();
  let settled = false;
  const receipt = engine.submitWithReceipt(payload).then(value => { settled = true; return value; });
  expect(events).toContainEqual({ kind: "begin", assistantUiId: "assistant" });
  await tick();
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(settled).toBe(false);
  reply.resolve({ accepted: true });
  expect(await receipt).toEqual({ kind: "accepted" });
  engine.requestSnapshot("session");
  expect(snapshots.at(-1)?.kind).toBe("live");
  engine.abort("session");
  expect(await receipt).toEqual({ kind: "accepted" });
  engine.dispose();
});

it("returns duplicate refusal to its caller without terminating the existing local stream", async () => {
  const { engine, reply, prompt, events, snapshots } = fixture();
  const first = engine.submitWithReceipt(payload);
  await tick();
  expect(await engine.submitWithReceipt({ ...payload, assistantUiId: "other" })).toMatchObject({ kind: "rejected" });
  expect(events.map(event => event.kind)).toEqual(["begin"]);
  engine.requestSnapshot("session");
  expect(snapshots.at(-1)).toMatchObject({ kind: "live", state: { assistantUiId: "assistant" } });
  expect(prompt).toHaveBeenCalledTimes(1);
  reply.resolve({ accepted: true });
  expect(await first).toEqual({ kind: "accepted" });
  engine.dispose();
});

it.each([
  [new DshRpcError({ code: "agent-busy", message: "Host refused admission" }), "rejected"],
  [new Error("HTTP connection lost"), "unconfirmed"],
] as const)("preserves explicit RPC refusal versus an uncertain transport outcome", async (error, kind) => {
  const { engine, reply, close } = fixture();
  const receipt = engine.submitWithReceipt(payload);
  await tick();
  reply.reject(error);
  expect(await receipt).toEqual({ kind, error: error.message });
  await tick();
  expect(close).toHaveBeenCalledTimes(1);
  engine.dispose();
});

it("settles disposal during an outstanding prompt as unconfirmed, even if the transport never settles", async () => {
  const { engine, prompt } = fixture();
  const receipt = engine.submitWithReceipt(payload);
  await tick();
  expect(prompt).toHaveBeenCalledTimes(1);
  engine.dispose();
  expect(await receipt).toMatchObject({ kind: "unconfirmed" });
  expect(await engine.submitWithReceipt(payload)).toMatchObject({ kind: "rejected" });
  engine.submit(payload);
  expect(prompt).toHaveBeenCalledTimes(1);
});

it("refuses before dispatch when preparation fails or is canceled, including adapters that ignore abort", async () => {
  const { client } = fixture();
  const preparation = deferred<{ cwd: string }>();
  const engine = new DshChatEngineClient({ client: client as unknown as DshApiClient, resolveSession: () => preparation.promise });
  const receipt = engine.submitWithReceipt(payload);
  engine.abort("session");
  expect(await receipt).toMatchObject({ kind: "rejected" });
  preparation.resolve({ cwd: "/late" });
  await tick();
  expect(client.createSession).not.toHaveBeenCalled();
  expect(client.prompt).not.toHaveBeenCalled();
  engine.dispose();
});

it.each(["success", "error"] as const)("preserves a Host command's %s result without confusing it with message admission", async kind => {
  const { engine, reply, events } = fixture();
  const receipt = engine.submitWithReceipt(payload);
  reply.resolve({ accepted: true, command: { kind, text: "command result" } });
  expect(await receipt).toEqual({ kind: "accepted", command: { kind, text: "command result" } });
  await tick();
  expect(events).toContainEqual({ kind: "done" });
  engine.dispose();
});

it("does not invent acceptance for an invalid response", async () => {
  const { engine, reply } = fixture();
  const receipt = engine.submitWithReceipt(payload);
  reply.resolve({} as never);
  expect(await receipt).toMatchObject({ kind: "unconfirmed" });
  engine.dispose();
});

it("keeps two child-session acknowledgements separate and requires the real delivered message ID", async () => {
  const first = deferred<{ messageId: string }>(), second = deferred<{ messageId: string }>();
  const client = {
    openEvents: async () => ({ next: () => new Promise(() => {}), return: async () => ({ done: true, value: undefined }) }),
    subagentPrompt: (address: { childSessionId: string }) => address.childSessionId === "first" ? first.promise : second.promise,
  } as unknown as DshApiClient;
  const engine = new DshChatEngineClient({ client, resolveSubagent: id => ({ parentSessionId: "parent", childSessionId: id, mode: "continuable" }) });
  const one = engine.submitWithReceipt({ ...payload, sessionId: "first" });
  let secondSettled = false;
  const two = engine.submitWithReceipt({ ...payload, sessionId: "second" }).then(value => { secondSettled = true; return value; });
  first.resolve({ messageId: "delivered-message" });
  expect(await one).toEqual({ kind: "accepted" });
  expect(secondSettled).toBe(false);
  second.resolve({ messageId: "" });
  expect(await two).toMatchObject({ kind: "unconfirmed" });
  engine.dispose();
});

it("reports one-shot rejection before any delivery operation", async () => {
  const { client } = fixture();
  const engine = new DshChatEngineClient({ client: client as unknown as DshApiClient,
    resolveSubagent: () => ({ parentSessionId: "parent", childSessionId: "session", mode: "one-shot" }),
  });
  expect(await engine.submitWithReceipt(payload)).toMatchObject({ kind: "rejected", error: "One-shot subagent conversations are read-only" });
  expect(client.createSession).not.toHaveBeenCalled();
  expect(client.prompt).not.toHaveBeenCalled();
  engine.dispose();
});

it("settles an admission failure before waiting for delayed mux cleanup", async () => {
  const { engine, reply, close } = fixture();
  close.mockImplementationOnce(() => new Promise(() => {}));
  const receipt = engine.submitWithReceipt(payload);
  await tick();
  reply.reject(new DshRpcError({ code: "agent-busy", message: "refused" }));
  expect(await receipt).toEqual({ kind: "rejected", error: "refused" });
  expect(close).toHaveBeenCalledTimes(1);
  engine.dispose();
});

it("observes cancellation from a synchronous begin listener before starting preparation", async () => {
  const { engine, client } = fixture();
  engine.onStreamEvent((id, event) => { if (event.kind === "begin") engine.abort(id); });
  expect(await engine.submitWithReceipt(payload)).toMatchObject({ kind: "rejected" });
  expect(client.createSession).not.toHaveBeenCalled();
  expect(client.prompt).not.toHaveBeenCalled();
  engine.dispose();
});
