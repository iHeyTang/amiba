import { expect, it, vi } from "vitest";
import type { SubmitReceipt } from "@amiba/app-runtime/protocol";
import { createComposerDraftSource } from "../../composer-draft-store";
import { CommandClaimStore } from "../../composer/triggers/claim";
import type { ComposerTriggerController, CommandClaim, ComposerDraftImageRegistration } from "../../composer/triggers/contracts";
import { createResidentInputTransaction, type ResidentInputTransactionDeps } from "../resident-input-transaction";

function fixture() {
  const source = createComposerDraftSource(); source.setDisplayText("original");
  const claims = new CommandClaimStore(), release = vi.fn();
  const serialize = vi.fn(async (_source: string, ref: string) => `<resolved:${ref}>`);
  const adjudicate = vi.fn(async () => undefined);
  const deps: ResidentInputTransactionDeps = {
    source, claims, sessionId: "target", available: () => true,
    controller: () => ({ serializeReference: serialize, adjudicate } as unknown as ComposerTriggerController), providers: () => [],
    images: () => [], prepare: vi.fn(async () => ({ attachments: [], release })), consume: vi.fn(),
    send: vi.fn(async request => { request.onDispatch?.(request.sessionId); return { kind: "accepted" as const }; }),
    submitClaim: vi.fn(async () => ({ kind: "success" as const })), changed: vi.fn(),
  };
  const transaction = createResidentInputTransaction(deps);
  source.subscribe(() => transaction.draftChanged());
  const settled = () => vi.waitFor(() => expect(transaction.getSnapshot().pending).toBe(false));
  return { source, claims, deps, transaction, serialize, adjudicate, settled, release };
}

it("expands real reference parts and preserves literal token-shaped text through standard submission", async () => {
  const f = fixture();
  const literal = "literal @[dsh.reference:unknown|id|label|clip] ";
  f.source.setParts([{ kind: "text", text: literal }, { kind: "mention", raw: "@[dsh.reference:fixture|id|label|clip]",
    mention: { type: "dsh.reference", display: "label", payload: { source: "fixture", ref: "id", clipboardText: "clip" } } }]);
  expect(f.transaction.submit()).toBe(true);
  expect(f.transaction.submit()).toBe(false);
  await f.settled();
  expect(f.serialize).toHaveBeenCalledTimes(1);
  expect(f.source.getHistoryVersion()).toBe(1);
  expect(f.deps.send).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "target", text: literal + "<resolved:id>" }));
  expect(f.source.getSnapshot()).toBe("");
  expect(f.release).toHaveBeenCalledTimes(1);
});

it("adjudicates first and executes the retained command claim on the next submit", async () => {
  const f = fixture();
  const claim = { token: "/fixture ", submit: async () => ({ kind: "success" }) } as CommandClaim;
  f.deps.controller = () => ({ adjudicate: async () => ({ claim }) } as unknown as ComposerTriggerController);
  f.source.setDisplayText("/fixture exact args");
  f.transaction.submit(); await f.settled();
  expect(f.claims.getInputStatus().phase).toBe("claimed");
  expect(f.deps.send).not.toHaveBeenCalled();
  expect(f.deps.submitClaim).not.toHaveBeenCalled();
  expect(f.source.getHistoryVersion()).toBe(0);
  f.transaction.submit(); await f.settled();
  expect(f.deps.submitClaim).toHaveBeenCalledWith(claim, "exact args", []);
  expect(f.source.getSnapshot()).toBe("");
  expect(f.claims.getInputStatus().phase).toBe("plain");
  expect(f.source.getHistoryVersion()).toBe(1);
});

it("keeps a newer draft after Host acceptance and consumes only the captured images", async () => {
  const f = fixture();
  const image = { image: { id: "captured" }, release: vi.fn() } as unknown as ComposerDraftImageRegistration;
  f.deps.images = () => [image];
  let finish!: (receipt: SubmitReceipt) => void;
  f.deps.send = vi.fn<ResidentInputTransactionDeps["send"]>(request => { request.onDispatch?.(request.sessionId); return new Promise<SubmitReceipt>(resolve => { finish = resolve; }); });
  f.transaction.submit();
  await vi.waitFor(() => expect(f.deps.send).toHaveBeenCalled());
  f.source.setDisplayText("new draft");
  finish({ kind: "accepted" }); await f.settled();
  expect(f.source.getSnapshot()).toBe("new draft");
  expect(f.source.getHistoryVersion()).toBe(0);
  expect(f.deps.consume).toHaveBeenCalledWith([image]);
});

it("aborts changed input during backend preparation before the actual dispatch boundary", async () => {
  const f = fixture();
  f.deps.send = vi.fn<ResidentInputTransactionDeps["send"]>(request => new Promise<SubmitReceipt>(resolve => {
    request.signal!.addEventListener("abort", () => resolve({ kind: "rejected", error: "Preparation canceled" }), { once: true });
  }));
  f.transaction.submit();
  await vi.waitFor(() => expect(f.deps.send).toHaveBeenCalled());
  f.source.setDisplayText("replacement"); await f.settled();
  expect(f.source.getSnapshot()).toBe("replacement");
  expect(f.deps.consume).not.toHaveBeenCalled();
  expect(f.release).toHaveBeenCalledTimes(1);
});

it("retains input on rejected or unconfirmed receipts and reports why", async () => {
  const f = fixture();
  f.deps.send = vi.fn(async () => ({ kind: "unconfirmed" as const, error: "Connection lost" }));
  f.transaction.submit(); await f.settled();
  expect(f.source.getSnapshot()).toBe("original");
  expect(f.transaction.getSnapshot().notice).toContain("Check the conversation before retrying");
  expect(f.deps.consume).not.toHaveBeenCalled();
  f.deps.send = vi.fn(async () => ({ kind: "rejected" as const, error: "Workspace unavailable" }));
  f.transaction.submit(); await f.settled();
  expect(f.source.getSnapshot()).toBe("original");
  expect(f.transaction.getSnapshot().notice).toBe("Workspace unavailable");
  expect(f.source.getHistoryVersion()).toBe(0);
});

it("does not submit after native ownership returns during reference resolution", async () => {
  const f = fixture();
  let resolve!: (value: string) => void;
  f.serialize.mockImplementation(() => new Promise(done => { resolve = done; }));
  f.source.set("@[dsh.reference:fixture|id|label|clip]");
  f.transaction.submit();
  await vi.waitFor(() => expect(f.serialize).toHaveBeenCalled());
  f.deps.available = () => false; f.transaction.cancel(); resolve("resolved");
  await f.settled();
  expect(f.deps.send).not.toHaveBeenCalled();
  expect(f.source.getSnapshot()).not.toBe("");
});

it("keeps a failed command claim and its draft for an explicit retry", async () => {
  const f = fixture();
  const claim = { token: "/fixture ", submit: async () => ({ kind: "success" }) } as CommandClaim;
  f.source.setDisplayText("/fixture retry args"); f.claims.begin(claim);
  vi.mocked(f.deps.submitClaim).mockResolvedValueOnce({ kind: "error", text: "Command rejected" });
  f.transaction.submit(); await f.settled();
  expect(f.source.getSnapshot()).toBe("/fixture retry args");
  expect(f.claims.get()).toBe(claim);
  expect(f.transaction.getSnapshot().notice).toBe("Command rejected");
  expect(f.source.getHistoryVersion()).toBe(0);
  expect(f.deps.consume).not.toHaveBeenCalled();
  f.transaction.submit(); await f.settled();
  expect(f.source.getSnapshot()).toBe("");
  expect(f.deps.submitClaim).toHaveBeenCalledTimes(2);
});

it("queues an already-resolved busy-session input with its original document instead of dispatching a model turn", async () => {
  const f = fixture();
  const document = f.source.getDocument();
  f.deps.busy = () => true;
  f.deps.enqueue = vi.fn(async request => { request.onDispatch?.(request.sessionId); return { queueId: "queued" }; });
  f.transaction.submit(); await f.settled();
  expect(f.deps.enqueue).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "target", text: "original", draft: document }), []);
  expect(f.deps.send).not.toHaveBeenCalled();
  expect(f.source.getSnapshot()).toBe("");
});

it("keeps the input when queue preparation fails and runs claims directly while the model is busy", async () => {
  const f = fixture();
  f.deps.busy = () => true;
  f.deps.enqueue = vi.fn(async () => { throw new Error("Queue storage unavailable"); });
  f.transaction.submit(); await f.settled();
  expect(f.source.getSnapshot()).toBe("original");
  expect(f.deps.consume).not.toHaveBeenCalled();
  const claim = { token: "/fixture ", submit: async () => ({ kind: "success" }) } as CommandClaim;
  f.source.setDisplayText("/fixture direct"); f.claims.begin(claim);
  f.transaction.submit(); await f.settled();
  expect(f.deps.enqueue).toHaveBeenCalledTimes(1);
  expect(f.deps.submitClaim).toHaveBeenCalledWith(claim, "direct", []);
  expect(f.source.getSnapshot()).toBe("");
});
