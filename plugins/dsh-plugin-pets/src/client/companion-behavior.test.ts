import type { SurfaceActivitySnapshot } from "@amiba/extension-sdk";
import { describe, expect, it } from "vitest";
import { companionScene, companionPose } from "./companion-behavior.js";
import { hasCompanionActions } from "../mofli-capabilities.generated.js";
const activity = (
  phase: SurfaceActivitySnapshot["phase"],
  restored = false,
): SurfaceActivitySnapshot => ({
  sessionId: "a",
  phase,
  restored,
  revision: 1,
});
describe("Amiba companion behavior", () => {
  it("prioritizes live execution and approvals over typing", () => {
    const typing = {
      pointer: null,
      input: { active: true, focused: true, composing: false },
    };
    expect(companionScene(activity("waiting"), typing)).toBe("waiting");
    expect(companionScene(activity("thinking"), typing)).toBe("thinking");
    expect(companionScene(activity("completed"), typing)).toBe("typing");
  });
  it("does not celebrate restored history or celebrate forever", () => {
    expect(companionScene(activity("completed", true))).toBe("idle");
    expect(companionPose("completed", 0).action).toBe(hasCompanionActions ? "victory-hop" : "expression-completed");
    expect(companionPose("completed", 12).state).toBeLessThan(18);
    expect(companionPose("failed", 12).state).toBeLessThan(18);
  });
  it.skipIf(!hasCompanionActions)("uses different body choreography for thinking and waiting", () => {
    expect(companionPose("thinking", 1).action).toBe("ponder-tilt");
    expect(companionPose("thinking", 4.5).action).toBe("weigh-options");
    expect(companionPose("waiting", 1).action).toBe("attention-bob");
  });
});

it.skipIf(!hasCompanionActions)("plays four different authored actions for every lifecycle scene on all rigs", () => {
  const scenes = [
    "idle",
    "loading",
    "typing",
    "thinking",
    "responding",
    "tooling",
    "waiting",
    "completed",
    "failed",
    "interrupted",
  ] as const;
  for (const scene of scenes) {
    const actions = new Set<string>();
    for (let time = 0; time < 10; time += 0.25) {
      const flat = companionPose(scene, time),
        spatial = companionPose(scene, time, true);
      actions.add(flat.action);
      expect(flat.state - spatial.state).toBe(6);
      expect(spatial.action).toBe(flat.action);
      expect(flat.state).toBeGreaterThanOrEqual(14);
      expect(flat.state).toBeLessThan(66);
    }
    expect(actions.size).toBeGreaterThanOrEqual(3);
    expect(companionPose(scene, 1, false, true)).toEqual(
      companionPose(scene, 2, false, true),
    );
  }
});

it("reserves task attention and restores pointer attention after terminal feedback", () => {
  for (const spatial of [false, true]) {
    for (const reduced of [false, true]) {
      for (const scene of [
        "loading",
        "typing",
        "thinking",
        "responding",
        "tooling",
        "completed",
        "failed",
        "interrupted",
      ] as const)
        expect(
          companionPose(scene, 0, spatial, reduced).followsPointer,
          scene,
        ).toBe(false);
      for (const scene of ["idle", "waiting"] as const)
        expect(
          companionPose(scene, 0, spatial, reduced).followsPointer,
          scene,
        ).toBe(true);
      for (const scene of ["completed", "failed", "interrupted"] as const)
        expect(
          companionPose(scene, 30, spatial, reduced).followsPointer,
          scene,
        ).toBe(true);
    }
  }
});

it.skipIf(hasCompanionActions)("published rigs use valid idle body poses and scene expressions", () => {
  expect(companionPose("thinking", 1)).toMatchObject({ state: 0, expression: 1, followsPointer: false });
  expect(companionPose("waiting", 1)).toMatchObject({ state: 0, expression: 11, followsPointer: true });
  expect(companionPose("completed", 0).expression).toBe(3);
  expect(companionPose("completed", 30)).toMatchObject({ state: 0, expression: -1, followsPointer: true });
  expect(companionPose("thinking", 1, false, true)).toEqual(companionPose("thinking", 4, false, true));
});
