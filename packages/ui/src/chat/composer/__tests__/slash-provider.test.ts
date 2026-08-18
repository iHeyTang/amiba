import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeSlashProvider } from "../providers/slash";

vi.mock("@amiba/app-runtime/platform", () => ({
  getPlatform: () => ({
    agentSessions: {
      list: vi.fn().mockResolvedValue([{ sessionId: "s1", updatedAt: 1 }]),
    },
    agentCommands: {
      list: vi.fn().mockResolvedValue([
        { name: "model", description: "Switch model", inputHint: "[model]" },
        { name: "reasoning", description: "Effort", inputHint: "[level]" },
      ]),
    },
  }),
}));

describe("slash provider", () => {
  beforeEach(() => vi.clearAllMocks());
  it("lists commands matching query", async () => {
    const p = makeSlashProvider();
    const items = await p.search("mod");
    expect(items.some((i) => i.label === "model")).toBe(true);
  });
  it("keeps DSH command completion single-level", async () => {
    const p = makeSlashProvider();
    const items = await p.search("reasoning");
    const reasoning = items.find((i) => i.label === "reasoning");
    expect(reasoning?.subcommands).toBeUndefined();
  });
  it("returns empty for a command without subcommands at second level", async () => {
    const p = makeSlashProvider();
    expect(p.match("model foo")).toBe(false);
    expect(await p.search("model foo")).toEqual([]);
  });
});
