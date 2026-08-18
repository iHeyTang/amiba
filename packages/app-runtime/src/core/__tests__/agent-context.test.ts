import { describe, expect, it } from "vitest";

import {
  normalizeAgentContext,
  normalizeAgentProfileId,
} from "../agent-context";

describe("agent execution context", () => {
  it("normalizes the default profile", () => {
    expect(normalizeAgentProfileId("")).toBe("default");
  });

  it("normalizes named DSH presets", () => {
    expect(normalizeAgentProfileId("Research Team")).toBe("research team");
  });

  it("normalizes an execution context to a DSH preset only", () => {
    expect(normalizeAgentContext({ profileId: "coder" })).toEqual({
      profileId: "coder",
    });
  });
});
