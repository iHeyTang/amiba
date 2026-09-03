import { describe, expect, it, vi } from "vitest";

import { CONNECT_ADD_TOOL_NAME, registerConnectAddTool } from "./connect-tool.js";
import { CONNECT_WIZARD_QUESTION_ID } from "./connect-wizard-question.js";

function harness(askImpl: (req: unknown) => Promise<unknown>) {
  const registered: unknown[] = [];
  const ctx = {
    tools: { register: vi.fn((definition: unknown) => { registered.push(definition); return () => {}; }) },
    userQuestions: { ask: vi.fn(askImpl) },
    effect: (callback: () => unknown) => { callback(); return () => {}; },
  };
  const center = {
    listProviders: () => [{ id: "lark", name: "飞书", description: "", supportsOnboarding: true }],
    listConnects: vi.fn(async () => [{ id: "c1", provider: "lark", name: "飞书助手", enabled: true, pairing: false, owners: [], agentPreset: "restricted", status: { state: "ready" }, createdAt: "", updatedAt: "" }]),
  };
  registerConnectAddTool(ctx as never, center as never);
  const tool = registered[0] as { name: string; execute(args: unknown, exec: unknown): Promise<unknown> };
  return { ctx, center, tool };
}
const exec = { agent: { id: "session-1" }, signal: new AbortController().signal };

describe("amiba_connect_add", () => {
  it("registers under its wire name and blocks on ask with the agent, then returns the connect without secrets", async () => {
    const { ctx, tool } = harness(async () => ({ answers: [{ id: CONNECT_WIZARD_QUESTION_ID, selected: [], custom: "c1" }] }));
    expect(tool.name).toBe(CONNECT_ADD_TOOL_NAME);
    const result = await tool.execute({ provider: "lark", name: "飞书助手" }, exec);
    expect(ctx.userQuestions.ask).toHaveBeenCalledWith(expect.objectContaining({
      agent: exec.agent, signal: exec.signal,
      questions: [expect.objectContaining({ id: CONNECT_WIZARD_QUESTION_ID, detail: JSON.stringify({ provider: "lark", name: "飞书助手" }) })],
    }));
    expect(result).toEqual({ status: "connected", connect: { id: "c1", provider: "lark", name: "飞书助手", agentPreset: "restricted", status: "ready" } });
    expect(JSON.stringify(result)).not.toMatch(/secret|config/i);
  });
  it("rejects an unknown provider before asking", async () => {
    const { ctx, tool } = harness(async () => ({ answers: [] }));
    await expect(tool.execute({ provider: "nope" }, exec)).rejects.toThrow(/unknown_provider/);
    expect(ctx.userQuestions.ask).not.toHaveBeenCalled();
  });
  it("requires a live agent", async () => {
    const { tool } = harness(async () => ({ answers: [] }));
    await expect(tool.execute({}, { signal: exec.signal })).rejects.toThrow(/agent/);
  });
  it("maps a UI cancel to { status: cancelled }", async () => {
    const { tool } = harness(async () => { throw Object.assign(new Error("the user cancelled ask_user_question"), { code: "ASK_CANCELLED" }); });
    await expect(tool.execute({}, exec)).resolves.toEqual({ status: "cancelled" });
  });
  it("fails when the answer names a connect that does not exist", async () => {
    const { tool } = harness(async () => ({ answers: [{ id: CONNECT_WIZARD_QUESTION_ID, selected: [], custom: "ghost" }] }));
    await expect(tool.execute({}, exec)).rejects.toThrow(/connect_not_found/);
  });
});
