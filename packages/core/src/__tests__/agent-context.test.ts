import { describe, expect, it } from "vitest";

import {
  hermesAgentPath,
  normalizeAgentContext,
  normalizeAgentProfileId,
} from "../agent-context";

describe("agent execution context", () => {
  it("normalizes the default profile without adding a multiplexer prefix", () => {
    expect(normalizeAgentProfileId("")).toBe("default");
    expect(hermesAgentPath("default", "/v1/runs")).toBe("/v1/runs");
  });

  it("routes named profiles through Hermes multiplex paths", () => {
    expect(hermesAgentPath("Research Team", "/v1/runs")).toBe(
      "/p/research%20team/v1/runs",
    );
  });

  it("drops incomplete response modes", () => {
    expect(
      normalizeAgentContext({
        profileId: "coder",
        personality: { key: "concise", prompt: "" },
      }),
    ).toEqual({ profileId: "coder" });
  });
});
