import { describe, expect, it, vi } from "vitest";
import { loadAgentPresets, type PresetConnection } from "../presets";

// One `remote.agentPresets` face stub — the shape a plugin reads as
// `ctx.remote.agentPresets`. No `api` wrapper: that belonged to the retired
// `ctx.get("connection")` access path.
function connectionReturning(value: unknown): PresetConnection {
  return {
    agentPresets: { list: vi.fn(async () => value) },
  } as unknown as PresetConnection;
}

// Fixtures mirror the REAL result envelope `agentPresets.list` resolves to on
// DSH 0.1.5-rc.1: a bare `{ ok, value }`, with no wrapping `{ rpcId, result }`
// carrier and no arguments.
function envelope(value: unknown) {
  return { ok: true, value };
}

describe("loadAgentPresets", () => {
  it("unwraps the result envelope and maps presets to id/label/isDefault", async () => {
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
    expect(conn.agentPresets.list).toHaveBeenCalledWith();
  });

  it("drops entries with a missing or empty id", async () => {
    const conn = connectionReturning(
      envelope({ presets: [{ id: "", name: "x", isDefault: false }, { name: "no-id" }, { id: "ok", isDefault: false }] }),
    );
    expect(await loadAgentPresets(conn)).toEqual([{ id: "ok", label: "ok", isDefault: false }]);
  });

  it("returns [] for a failed result, a malformed response, or a throwing call", async () => {
    expect(await loadAgentPresets(connectionReturning({ ok: false, error: { message: "nope" } }))).toEqual([]);
    expect(await loadAgentPresets(connectionReturning(null))).toEqual([]);
    // An ok envelope whose `value` is absent or not an object carries no rows.
    expect(await loadAgentPresets(connectionReturning({ ok: true, profiles: [] }))).toEqual([]);
    const throwing = {
      agentPresets: { list: vi.fn(async () => { throw new Error("boom"); }) },
    } as unknown as PresetConnection;
    expect(await loadAgentPresets(throwing)).toEqual([]);
  });
});
