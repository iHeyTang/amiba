import { describe, expect, it, vi } from "vitest";
import { loadAgentPresets } from "../presets";

function connectionReturning(value: unknown) {
  return { api: { agentPresets: { list: vi.fn(async () => value) } } };
}

// Fixtures mirror the REAL rpc envelope `agentPresets.list` resolves to.
function envelope(value: unknown) {
  return { rpcId: "r1", result: { ok: true, value } };
}

describe("loadAgentPresets", () => {
  it("unwraps the rpc envelope and maps presets to id/label/isDefault", async () => {
    const conn = connectionReturning(
      envelope({
        presets: [
          { id: "restricted", name: "Restricted", description: "Least privilege", isDefault: true, trust: "system" },
          { id: "full", name: "  ", isDefault: false, trust: "user" },
        ],
        authorable: true,
        hasDocument: false,
      }),
    );
    expect(await loadAgentPresets(conn)).toEqual([
      { id: "restricted", label: "Restricted", isDefault: true },
      { id: "full", label: "full", isDefault: false },
    ]);
    expect(conn.api.agentPresets.list).toHaveBeenCalledWith({});
  });

  it("drops entries with a missing or empty id", async () => {
    const conn = connectionReturning(
      envelope({ presets: [{ id: "", name: "x", isDefault: false }, { name: "no-id" }, { id: "ok", isDefault: false }] }),
    );
    expect(await loadAgentPresets(conn)).toEqual([{ id: "ok", label: "ok", isDefault: false }]);
  });

  it("returns [] for a failed envelope, a malformed response, or a throwing call", async () => {
    expect(await loadAgentPresets(connectionReturning({ rpcId: "r1", result: { ok: false, error: { message: "nope" } } }))).toEqual([]);
    expect(await loadAgentPresets(connectionReturning(null))).toEqual([]);
    expect(await loadAgentPresets(connectionReturning({ ok: true, profiles: [] }))).toEqual([]); // bare (non-envelope) shape is NOT accepted
    const throwing = { api: { agentPresets: { list: vi.fn(async () => { throw new Error("boom"); }) } } };
    expect(await loadAgentPresets(throwing)).toEqual([]);
  });
});
