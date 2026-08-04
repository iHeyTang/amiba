import { beforeEach, describe, expect, it, vi } from "vitest";

const backplaneFetch = vi.hoisted(() => vi.fn());

vi.mock("../backplane-client", () => ({
  backplaneFetch,
}));

import {
  getHermesSkillFile,
  getHermesSkillFiles,
  getHermesSkills,
  postHermesSkillToggle,
} from "../hermes-skills";

describe("Hermes skills profile client", () => {
  beforeEach(() => {
    backplaneFetch.mockReset();
  });

  it("scopes the list and metadata requests to the selected profile", async () => {
    backplaneFetch
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json({
          totals: { total: 0, enabled: 0, disabled: 0 },
          items: [],
        }),
      );

    await getHermesSkills("research profile");

    expect(backplaneFetch).toHaveBeenNthCalledWith(
      1,
      "/hermes/skills?profile=research%20profile",
      { method: "GET" },
    );
    expect(backplaneFetch).toHaveBeenNthCalledWith(
      2,
      "/hermes/skills/meta?profile=research%20profile",
      { method: "GET" },
    );
  });

  it("scopes browsing and writes without changing their payload contracts", async () => {
    backplaneFetch
      .mockResolvedValueOnce(Response.json({ ok: true, files: [] }))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          path: "SKILL.md",
          encoding: "utf-8",
          content: "instructions",
        }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true, enabled: false }));

    await getHermesSkillFiles("web-research", "researcher");
    await getHermesSkillFile("web-research", "SKILL.md", "researcher");
    await postHermesSkillToggle("web-research", false, "researcher");

    expect(backplaneFetch.mock.calls[0]?.[0]).toBe(
      "/hermes/skills/web-research/files?profile=researcher",
    );
    expect(backplaneFetch.mock.calls[1]?.[0]).toBe(
      "/hermes/skills/web-research/file?path=SKILL.md&profile=researcher",
    );
    expect(backplaneFetch).toHaveBeenNthCalledWith(
      3,
      "/hermes/skills/toggle?profile=researcher",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ name: "web-research", enabled: false }),
      }),
    );
  });
});
