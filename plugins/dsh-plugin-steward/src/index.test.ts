import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { AMIBA_STEWARD_REMOTE, apply } from "./index.js";
import { harness } from "./test/service-harness.js";

describe("amiba-steward host entry", () => {
  it("declares the remote contract and the preset id", () => {
    expect(AMIBA_STEWARD_REMOTE.descriptors.map((d) => d.method)).toEqual(["ensureStewardSession", "listTasks", "adopt", "closeTask"]);
  });

  it("does not seed presets, starts the service, and registers the steward tools into the steward scope", async () => {
    const { ctx, setupCtxs } = harness();
    const root = mkdtempSync(join(tmpdir(), "amiba-steward-"));
    const provided: string[] = [];
    const hostCtx = {
      ...ctx,
      effect: ctx.effect,
      provide: vi.fn((name: string) => provided.push(name)),
      reflect: { get: () => undefined, provide: vi.fn() },
    };
    await apply(hostCtx as never, { root });
    await vi.waitFor(() => expect(setupCtxs.size).toBe(1));
    const [agentCtx] = [...setupCtxs.values()];
    expect(agentCtx!.tools.register).toHaveBeenCalledTimes(5);
    expect(agentCtx!.systemPrompt.section).toHaveBeenCalled();
  });
});
