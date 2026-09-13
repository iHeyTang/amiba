import { expect, it, vi } from "vitest";
import type { SessionMeta } from "@amiba/app-runtime/core";
import type { ResidentTurnRequest } from "../../composer/triggers/contracts";
import { createResidentTurnSender, type ResidentTurnSenderDeps } from "../resident-turn-sender";

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
