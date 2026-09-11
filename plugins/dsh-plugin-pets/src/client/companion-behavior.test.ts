import type { SurfaceActivitySnapshot } from "@amiba/extension-sdk";
import { describe, expect, it } from "vitest";
import { companionScene, companionExpression } from "./companion-behavior.js";
const activity = (phase: SurfaceActivitySnapshot["phase"], restored = false): SurfaceActivitySnapshot => ({ sessionId: "a", phase, restored, revision: 1 });
describe("Amiba companion behavior", () => {
  it("prioritizes live execution and approvals over typing", () => {
    const typing = { pointer: null, input: { active: true, focused: true, composing: false } };
    expect(companionScene(activity("waiting"), typing)).toBe("waiting");
    expect(companionScene(activity("thinking"), typing)).toBe("thinking");
    expect(companionScene(activity("completed"), typing)).toBe("typing");
  });
  it("does not celebrate restored history or celebrate forever", () => {
    expect(companionScene(activity("completed", true))).toBe("idle");
    expect(companionExpression("completed", 0)).toBe(3);
    expect(companionExpression("completed", 12)).toBe(-1);
    expect(companionExpression("failed", 12)).toBe(-1);
  });
  it("uses facial expressions without cycling body states", () => {
    expect(companionExpression("idle", 0)).toBe(-1);
    expect(companionExpression("idle", 10)).toBe(-1);
    expect(companionExpression("thinking", 1)).toBe(1);
    expect(companionExpression("thinking", 4)).toBe(9);
    expect(companionExpression("waiting", 1)).toBe(11);
  });
});
