import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  copy: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@amiba/app-runtime/platform", () => ({
  getPlatform: () => ({
    agentPresets: {
      list: mocks.list,
      copy: mocks.copy,
      remove: mocks.remove,
    },
    agentSettings: { update: mocks.update },
  }),
}));

import {
  createAgentPreset,
  deleteAgentPreset,
  renameAgentPreset,
} from "../agent-presets";

describe("DSH agent preset mutations", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.copy.mockResolvedValue({ agentPreset: "writer" });
    mocks.remove.mockResolvedValue(undefined);
    mocks.update.mockResolvedValue({});
  });

  it("creates by copying the current default and passes a display name", async () => {
    mocks.list.mockResolvedValue({
      presets: [{ id: "standard", isDefault: true }],
    });

    await expect(
      createAgentPreset({ name: "Writer", displayName: "Editorial writer" }),
    ).resolves.toEqual({ ok: true });
    expect(mocks.copy).toHaveBeenCalledWith({
      from: "standard",
      agentPreset: "writer",
      name: "Editorial writer",
    });
  });

  it("moves the DSH default pointer before removing a renamed default", async () => {
    mocks.list.mockResolvedValue({
      presets: [{ id: "research", isDefault: true }],
    });

    await expect(renameAgentPreset("research", "Deep research")).resolves.toEqual({
      ok: true,
    });
    expect(mocks.copy).toHaveBeenCalledWith({
      from: "research",
      agentPreset: "deep-research",
      name: "Deep research",
    });
    expect(mocks.update).toHaveBeenCalledWith("agent-presets", {
      default: "deep-research",
    });
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.remove.mock.invocationCallOrder[0]!,
    );
    expect(mocks.remove).toHaveBeenCalledWith("research");
  });

  it("refuses to remove the current default preset", async () => {
    mocks.list.mockResolvedValue({
      presets: [{ id: "standard", isDefault: true }],
    });

    const result = await deleteAgentPreset("standard");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/another default/i);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
