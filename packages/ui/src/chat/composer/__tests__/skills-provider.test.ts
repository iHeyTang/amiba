import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeSkillsProvider } from "../providers/skills";

vi.mock("@amiba/app-runtime/platform", () => ({
  getPlatform: () => ({
    agentSessions: {
      list: vi.fn().mockResolvedValue([{ sessionId: "s1", updatedAt: 1 }]),
    },
    agentSkills: {
      list: vi.fn().mockResolvedValue({
        skills: [
          { name: "translate", description: "Translate text", userInvocable: true },
          { name: "summarize", description: "Summarize", userInvocable: true },
        ],
      }),
    },
  }),
}));

describe("skills provider", () => {
  beforeEach(() => vi.clearAllMocks());
  it("searches by query and returns MenuItems with skill mentions", async () => {
    const p = makeSkillsProvider();
    const items = await p.search("trans");
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("translate");
    expect(items[0].insert).toEqual({
      type: "skill",
      payload: { name: "translate" },
      display: "translate",
    });
  });
  it("serializes a skill mention for sending", () => {
    const p = makeSkillsProvider();
    expect(
      p.serialize?.({
        type: "skill",
        payload: { name: "translate" },
        display: "translate",
      }),
    ).toContain("translate");
  });
  it("closes completion once slash arguments begin", () => {
    const p = makeSkillsProvider();
    expect(p.match("translate")).toBe(true);
    expect(p.match("translate to Chinese")).toBe(false);
  });
});
