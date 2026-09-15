import { describe, expect, it, vi } from "vitest";

import {
  createAgentPresetsAdapter,
  normalizeAgentPresetId,
  type AgentPresetsApi,
} from "../data.js";

type RosterEntry = {
  id: string;
  trust: "system" | "user";
  isDefault: boolean;
  name?: string;
  description?: string;
  broken?: string;
};

// The wire result envelope as of DSH 0.1.5-rc.1: a `remote.<namespace>` method
// resolves straight to `{ ok, value }` (the retired `{ rpcId, result }`
// carrier is gone) and the adapter reads these fields at the top level.
function ok<T>(value: T) {
  return { ok: true as const, value };
}

function refused(message: string) {
  return { ok: false as const, error: { message } };
}

function makeApi(presets: RosterEntry[]) {
  const api = {
    agentPresets: {
      list: vi.fn(async () =>
        ok({ presets, authorable: true, hasDocument: true }),
      ),
      read: vi.fn(async () =>
        ok({
          agentPreset: "researcher",
          trust: "user" as const,
          content: "# soul",
        }),
      ),
      copy: vi.fn(async () => ok({ agentPreset: "copied" })),
      deletePreset: vi.fn(async () => ok({})),
    },
    settings: {
      update: vi.fn(async () => ok({ ns: "agent-presets" })),
      openAgentPresetDirectory: vi.fn(async () => ok({ opened: true as const })),
    },
  };
  return { api, adapter: createAgentPresetsAdapter(api as unknown as AgentPresetsApi) };
}

const roster: RosterEntry[] = [
  { id: "default", trust: "system", isDefault: false, name: "Amiba" },
  {
    id: "researcher",
    trust: "user",
    isDefault: true,
    description: "Verifies product claims",
  },
];

describe("createAgentPresetsAdapter", () => {
  it("maps the wire roster onto the page shape and derives the active id", async () => {
    const { adapter } = makeApi(roster);
    const result = await adapter.getAgentPresets();
    expect(result.ok).toBe(true);
    expect(result.active).toBe("researcher");
    expect(result.profiles).toEqual([
      {
        id: "default",
        name: "Amiba",
        is_default: false,
        description: "Amiba",
        trust: "system",
      },
      {
        id: "researcher",
        name: "researcher",
        is_default: true,
        description: "Verifies product claims",
        trust: "user",
      },
    ]);
  });

  it("folds an ok:false envelope into a failed response", async () => {
    const { api, adapter } = makeApi(roster);
    api.agentPresets.list.mockResolvedValueOnce(
      refused("loopback only") as never,
    );
    const result = await adapter.getAgentPresets();
    expect(result).toMatchObject({ ok: false, error: "loopback only" });
  });

  it("creates by copying the default preset when no clone source is named", async () => {
    const { api, adapter } = makeApi(roster);
    const result = await adapter.createAgentPreset({
      name: "My Writer",
      displayName: "Writer",
    });
    expect(result.ok).toBe(true);
    expect(api.agentPresets.copy).toHaveBeenCalledWith(
      "researcher",
      "my-writer",
      "Writer",
    );
  });

  it("writes the default through the agent-presets settings namespace", async () => {
    const { api, adapter } = makeApi(roster);
    const result = await adapter.setDefaultAgentPreset("writer");
    expect(result.ok).toBe(true);
    expect(api.settings.update).toHaveBeenCalledWith(
      "agent-presets",
      { default: "writer" },
      undefined,
    );
  });

  it("rename of the default preset re-points the default and rolls back on a settings refusal", async () => {
    const { api, adapter } = makeApi(roster);
    api.settings.update.mockResolvedValueOnce(
      refused("settings locked") as never,
    );
    const result = await adapter.renameAgentPreset("researcher", "writer");
    expect(result).toMatchObject({ ok: false, error: "settings locked" });
    // The freshly copied id is rolled back; the source stays.
    expect(api.agentPresets.deletePreset).toHaveBeenCalledTimes(1);
    expect(api.agentPresets.deletePreset).toHaveBeenCalledWith("writer");
  });

  it("refuses to delete the default preset before another default is chosen", async () => {
    const { api, adapter } = makeApi(roster);
    const result = await adapter.deleteAgentPreset("researcher");
    expect(result.ok).toBe(false);
    expect(api.agentPresets.deletePreset).not.toHaveBeenCalled();
  });

  it("reads a preset's composition through the agentPresets face", async () => {
    const { api, adapter } = makeApi(roster);
    await expect(
      adapter.readAgentPresetComposition("researcher"),
    ).resolves.toEqual({ ok: true, content: "# soul" });
    expect(api.agentPresets.read).toHaveBeenCalledWith("researcher");
  });

  it("surfaces the resolved path when the host has no native opener", async () => {
    const { api, adapter } = makeApi(roster);
    api.settings.openAgentPresetDirectory.mockResolvedValueOnce(
      ok({ opened: false as const, path: "/presets/researcher" }) as never,
    );
    await expect(adapter.openAgentPresetDocument("researcher")).resolves.toEqual(
      { ok: true, path: "/presets/researcher" },
    );
    expect(api.settings.openAgentPresetDirectory).toHaveBeenCalledWith(
      "researcher",
    );
  });
});

describe("normalizeAgentPresetId", () => {
  it("lowercases and collapses non-alphanumerics", () => {
    expect(normalizeAgentPresetId("  My Writer! ")).toBe("my-writer");
  });

  it("rejects an id with no letter or digit", () => {
    expect(() => normalizeAgentPresetId("--")).toThrow();
  });
});
