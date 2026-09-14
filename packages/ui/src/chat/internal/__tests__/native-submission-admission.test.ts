import { expect, it, vi } from "vitest";
import { nativeSubmissionAdmission } from "../native-submission-admission";
import type { SubmitPayload, SubmitReceipt } from "@amiba/app-runtime/protocol";
const payload = { sessionId: "a" } as SubmitPayload;

it("protects queued work while admission is pending and accepts only the actual receipt", async () => {
  let resolve!: (receipt: SubmitReceipt) => void;
  const client = { submit: vi.fn(), submitWithReceipt: vi.fn(() => new Promise<SubmitReceipt>(done => { resolve = done; })) };
  const callbacks = { accepted: vi.fn(), failed: vi.fn() };
  const ticket = nativeSubmissionAdmission(client, payload, callbacks);
  ticket.start();
  expect(ticket.protectsQueue).toBe(true);
  expect(callbacks.accepted).not.toHaveBeenCalled();
  resolve({ kind: "accepted" });
  await vi.waitFor(() => expect(callbacks.accepted).toHaveBeenCalledOnce());
  expect(ticket.protectsQueue).toBe(false);
  expect(callbacks.failed).not.toHaveBeenCalled();
  expect(client.submit).not.toHaveBeenCalled();
});

it.each(["rejected", "unconfirmed"] as const)("keeps queue protection after %s even if a stream error arrives later", async kind => {
  const callbacks = { accepted: vi.fn(), failed: vi.fn() };
  const ticket = nativeSubmissionAdmission({ submit: vi.fn(), submitWithReceipt: async () => ({ kind, error: "failure" }) }, payload, callbacks);
  ticket.start();
  await vi.waitFor(() => expect(callbacks.failed).toHaveBeenCalledOnce());
  expect(ticket.protectsQueue).toBe(true);
  expect(ticket.notice).toContain("failure");
  expect(ticket.notice?.includes("Check the conversation")).toBe(kind === "unconfirmed");
  expect(callbacks.accepted).not.toHaveBeenCalled();
});

it("keeps legacy dispatch working without inventing acceptance", () => {
  const submit = vi.fn(), callbacks = { accepted: vi.fn(), failed: vi.fn() };
  const ticket = nativeSubmissionAdmission({ submit }, payload, callbacks);
  ticket.start();
  expect(submit).toHaveBeenCalledWith(payload);
  expect(ticket.protectsQueue).toBe(false);
  expect(callbacks.accepted).not.toHaveBeenCalled();
});

it("reports a thrown receipt transport as unconfirmed", async () => {
  const callbacks = { accepted: vi.fn(), failed: vi.fn() };
  const ticket = nativeSubmissionAdmission({ submit: vi.fn(), submitWithReceipt: async () => { throw new Error("disconnected"); } }, payload, callbacks);
  ticket.start();
  await vi.waitFor(() => expect(callbacks.failed).toHaveBeenCalledWith("disconnected Check the conversation before retrying."));
  expect(ticket.protectsQueue).toBe(true);
});
