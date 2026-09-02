import { describe, expect, it, vi } from "vitest";
import { loadAgentPresets } from "../presets";

function connectionReturning(value: unknown) {
  return { api: { agentPresets: { list: vi.fn(async () => value) } } };
}

describe("loadAgentPresets", () => {
  it("maps profiles to id/label/isDefault", async () => {
    const conn = connectionReturning({
      ok: true,
      active: "restricted",
      profiles: [
        { name: "restricted", description: "Restricted", is_default: true },
        { name: "full", description: "", is_default: false },
      ],
    });
    expect(await loadAgentPresets(conn)).toEqual([
      { id: "restricted", label: "Restricted", isDefault: true },
      { id: "full", label: "full", isDefault: false },
    ]);
    expect(conn.api.agentPresets.list).toHaveBeenCalledWith({});
  });

  it("returns [] for a non-ok or malformed response", async () => {
    expect(await loadAgentPresets(connectionReturning({ ok: false }))).toEqual([]);
    expect(await loadAgentPresets(connectionReturning(null))).toEqual([]);
  });
});
