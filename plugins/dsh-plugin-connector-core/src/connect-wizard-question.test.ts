import { describe, expect, it } from "vitest";

import { CONNECT_WIZARD_QUESTION_ID, decodePrefill, encodePrefill } from "./connect-wizard-question.js";

describe("connect wizard question payload", () => {
  it("round-trips defined fields only", () => {
    const detail = encodePrefill({ provider: "lark", name: "飞书助手", agentPreset: undefined });
    expect(JSON.parse(detail)).toEqual({ provider: "lark", name: "飞书助手" });
    expect(decodePrefill(detail)).toEqual({ provider: "lark", name: "飞书助手" });
  });
  it("encodes nothing as an empty string and decodes junk as {}", () => {
    expect(encodePrefill({})).toBe("");
    expect(decodePrefill(undefined)).toEqual({});
    expect(decodePrefill("not json")).toEqual({});
    expect(decodePrefill('{"provider":42}')).toEqual({});
  });
  it("pins the question id", () => {
    expect(CONNECT_WIZARD_QUESTION_ID).toBe("amiba.connect-wizard");
  });
});
