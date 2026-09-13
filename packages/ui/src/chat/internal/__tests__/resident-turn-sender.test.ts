import { createResidentInputTransaction } from "../resident-input-transaction";
import { createComposerDraftSource } from "../../composer-draft-store";
import { CommandClaimStore } from "../../composer/triggers/claim";
import { expect, it, vi } from "vitest";
import type { SessionMeta } from "@amiba/app-runtime/core";
import type { ResidentTurnRequest } from "../../composer/triggers/contracts";
import { createResidentTurnSender, waitForResidentReady, type ResidentTurnSenderDeps } from "../resident-turn-sender";

const request: ResidentTurnRequest = { sessionId: "source", text: "resolved reference and literal text", attachments: [] };
function fixture() {
  const deps: ResidentTurnSenderDeps = {
    unavailable: vi.fn(() => false), prepare: vi.fn(async () => "target"),
    read: vi.fn(async () => ({ session: { id: "target", title: "Target", agent: { profileId: "target-agent" } } as SessionMeta,
      messages: [{ role: "user" as const, content: "target history" }] })),
    workspace: vi.fn(async () => "/target"), checkpoint: vi.fn(async () => {}), markdown: vi.fn(async () => {}),
    dispatch: vi.fn(async () => ({ kind: "accepted" as const })),
  };
  return { deps, send: createResidentTurnSender(deps) };
}

it("prepares and sends the actual redirected target with its history, agent, workspace and checkpoint", async () => {
  const { deps, send } = fixture();
  expect(await send(request)).toEqual({ kind: "accepted" });
  expect(deps.read).toHaveBeenCalledWith("target");
  expect(deps.workspace).toHaveBeenCalledWith("target");
  expect(deps.checkpoint).toHaveBeenCalledWith("target", 1);
  expect(deps.markdown).toHaveBeenCalledWith("target");
  expect(deps.dispatch).toHaveBeenCalledWith(expect.objectContaining({ workspacePath: "/target", payload: expect.objectContaining({
    sessionId: "target", sessionTitle: "Target", agent: { profileId: "target-agent" },
    history: [{ role: "user", content: "target history" }, { role: "user", content: request.text }],
  }) }));
});

it("serializes preparation for both the original and redirected session before checkpoint creation", async () => {
  const { deps, send } = fixture();
  let release!: () => void;
  vi.mocked(deps.read).mockImplementation(async () => {
    await new Promise<void>(resolve => { release = resolve; });
    return { session: { id: "target" } as SessionMeta, messages: [] };
  });
  const first = send(request);
  await vi.waitFor(() => expect(deps.read).toHaveBeenCalled());
  expect((await send(request)).kind).toBe("rejected");
  expect((await send({ ...request, sessionId: "target" })).kind).toBe("rejected");
  expect(deps.checkpoint).not.toHaveBeenCalled();
  release(); await first;
  expect(deps.dispatch).toHaveBeenCalledTimes(1);
});

it("stops before dispatch when a target is opened during checkpoint preparation", async () => {
  const { deps, send } = fixture();
  vi.mocked(deps.checkpoint).mockImplementation(async () => { vi.mocked(deps.unavailable).mockImplementation(id => id === "target"); });
  expect((await send(request)).kind).toBe("rejected");
  expect(deps.markdown).not.toHaveBeenCalled();
  expect(deps.dispatch).not.toHaveBeenCalled();
});

it("distinguishes preparation failure from an unknown dispatch result and preserves explicit receipts", async () => {
  const { deps, send } = fixture();
  vi.mocked(deps.prepare).mockRejectedValueOnce(new Error("preparation failed"));
  expect(await send(request)).toEqual({ kind: "rejected", error: "preparation failed" });
  vi.mocked(deps.dispatch).mockRejectedValueOnce(new Error("connection lost"));
  expect(await send(request)).toEqual({ kind: "unconfirmed", error: "connection lost" });
  vi.mocked(deps.dispatch).mockResolvedValueOnce({ kind: "accepted", command: { kind: "error", text: "command refused" } });
  expect(await send(request)).toEqual({ kind: "accepted", command: { kind: "error", text: "command refused" } });
});

it("honors cancellation and actual one-shot child restrictions without dispatch", async () => {
  const { deps, send } = fixture();
  const controller = new AbortController(); controller.abort();
  expect((await send({ ...request, signal: controller.signal })).kind).toBe("rejected");
  expect(deps.prepare).not.toHaveBeenCalled();
  vi.mocked(deps.read).mockResolvedValueOnce({ session: { id: "target", subagentAddress: { mode: "one-shot" } } as SessionMeta, messages: [] });
  expect((await send(request)).kind).toBe("rejected");
  expect(deps.checkpoint).not.toHaveBeenCalled();
  expect(deps.dispatch).not.toHaveBeenCalled();
});


it("reports the authoritative target at dispatch and does not announce rejected preparation", async () => {
  const { deps, send } = fixture();
  const onDispatch = vi.fn();
  vi.mocked(deps.dispatch).mockImplementation(async () => {
    expect(onDispatch).toHaveBeenCalledWith("target");
    return { kind: "accepted" };
  });
  await send({ ...request, onDispatch });
  expect(onDispatch).toHaveBeenCalledOnce();
  onDispatch.mockClear();
  vi.mocked(deps.prepare).mockRejectedValueOnce(new Error("owner unavailable"));
  expect((await send({ ...request, onDispatch })).kind).toBe("rejected");
  expect(onDispatch).not.toHaveBeenCalled();
});


it("exposes both preparation locks for standard queue admission and releases them on rejection", async () => {
  const { deps, send } = fixture();
  let finishPrepare!: (target: string) => void;
  let rejectRead!: (error: Error) => void;
  vi.mocked(deps.prepare).mockImplementationOnce(() => new Promise(resolve => { finishPrepare = resolve; }));
  vi.mocked(deps.read).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRead = reject; }));
  const sending = send(request);
  expect(send.isBusy("source")).toBe(true);
  expect(send.isBusy("target")).toBe(false);
  expect(send.isBusy("unrelated")).toBe(false);
  finishPrepare("target");
  await vi.waitFor(() => expect(deps.read).toHaveBeenCalledOnce());
  expect(send.isBusy("source")).toBe(true);
  expect(send.isBusy("target")).toBe(true);
  rejectRead(new Error("history unavailable"));
  expect((await sending).kind).toBe("rejected");
  expect(send.isBusy("source")).toBe(false);
  expect(send.isBusy("target")).toBe(false);
});


it.each(["source", "target"])("standard input for %s queues while the actual sender holds redirected preparation", async sessionId => {
  const { deps, send } = fixture();
  let rejectRead!: (error: Error) => void;
  vi.mocked(deps.read).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRead = reject; }));
  const preparing = send(request);
  await vi.waitFor(() => expect(deps.read).toHaveBeenCalledOnce());
  const source = createComposerDraftSource(); source.setDisplayText("next input");
  const enqueue = vi.fn(async () => ({ queueId: "admitted" }));
  const transaction = createResidentInputTransaction({
    sessionId, source, claims: new CommandClaimStore(), available: () => true,
    controller: () => undefined, providers: () => [], images: () => [],
    prepare: async () => ({ attachments: [], release() {} }),
    consume() {}, changed() {}, busy: () => send.isBusy(sessionId), send, enqueue,
    submitClaim: async () => ({ kind: "success" }),
  });
  transaction.submit();
  await vi.waitFor(() => expect(transaction.getSnapshot().pending).toBe(false));
  expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ sessionId, text: "next input" }), []);
  expect(source.getSnapshot()).toBe("");
  expect(transaction.getSnapshot().notice).toBeNull();
  expect(deps.dispatch).not.toHaveBeenCalled();
  rejectRead(new Error("preparation cancelled")); await preparing;
});


it.each(["idle", "stop", "foreground"])("waits for a rotated destination and handles %s without leaking subscriptions", async outcome => {
  const { deps, send } = fixture();
  let busy = true, unavailable = false;
  const listeners = new Set<() => void>();
  const controller = new AbortController();
  deps.waitUntilReady = (id, signal) => {
    expect(id).toBe("target");
    return waitForResidentReady({ unavailable: () => unavailable, busy: () => busy,
      watch: changed => { listeners.add(changed); return () => { listeners.delete(changed); }; },
    }, signal);
  };
  const sending = send({ ...request, signal: controller.signal });
  await vi.waitFor(() => expect(listeners.size).toBe(1));
  expect(deps.read).not.toHaveBeenCalled();
  if (outcome === "stop") controller.abort();
  else {
    if (outcome === "idle") busy = false; else unavailable = true;
    for (const changed of [...listeners]) changed();
  }
  expect((await sending).kind).toBe(outcome === "idle" ? "accepted" : "rejected");
  expect(deps.dispatch).toHaveBeenCalledTimes(outcome === "idle" ? 1 : 0);
  expect(listeners.size).toBe(0);
  expect(send.isBusy("source")).toBe(false);
});
