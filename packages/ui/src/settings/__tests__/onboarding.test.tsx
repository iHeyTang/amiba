import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  useOnboardingCoordinator,
  type OnboardingStepRow,
} from "../onboarding";

const TWO_STEPS: readonly OnboardingStepRow[] = [
  { id: "welcome" },
  { id: "connect-model" },
];

function coordinator(
  active = true,
  steps: readonly OnboardingStepRow[] = TWO_STEPS,
) {
  return renderHook(
    (props: { active: boolean; steps: readonly OnboardingStepRow[] }) =>
      useOnboardingCoordinator(props.active, props.steps),
    { initialProps: { active, steps } },
  );
}

describe("settings onboarding coordinator", () => {
  it("mounts exactly one step at a time, the first not-yet-completed one in registry order", () => {
    const { result } = coordinator();
    expect(result.current.activeStepId).toBe("welcome");
  });

  it("advances to the next step when the active one completes", () => {
    const { result } = coordinator();
    act(() => result.current.complete("welcome"));
    expect(result.current.activeStepId).toBe("connect-model");
    act(() => result.current.complete("connect-model"));
    expect(result.current.activeStepId).toBeUndefined();
  });

  it("follows REGISTRY order, not completion order", () => {
    const { result } = coordinator();
    // Completing the second step first must not promote it: the coordinator
    // always mounts the first *uncompleted* entry of the ledger.
    act(() => result.current.complete("connect-model"));
    expect(result.current.activeStepId).toBe("welcome");
    act(() => result.current.complete("welcome"));
    expect(result.current.activeStepId).toBeUndefined();
  });

  it("mounts nothing while the active fact is false", () => {
    const { result } = coordinator(false);
    expect(result.current.activeStepId).toBeUndefined();
  });

  it("RESETS completion when the active fact goes false — completion is deliberately not persisted", () => {
    const { result, rerender } = coordinator();
    act(() => result.current.complete("welcome"));
    expect(result.current.activeStepId).toBe("connect-model");

    // Leaving the active condition (upstream: the user sends a message, so
    // the current session stops being blank) clears the set. This is copied
    // from the official shell deliberately; see ../onboarding.ts rule 6.
    rerender({ active: false, steps: TWO_STEPS });
    expect(result.current.activeStepId).toBeUndefined();

    rerender({ active: true, steps: TWO_STEPS });
    expect(result.current.activeStepId).toBe("welcome");
  });

  it("ignores a completion for a step that is not registered, and is idempotent", () => {
    const { result } = coordinator();
    act(() => result.current.complete("never-registered"));
    expect(result.current.activeStepId).toBe("welcome");
    act(() => result.current.complete("welcome"));
    act(() => result.current.complete("welcome"));
    expect(result.current.activeStepId).toBe("connect-model");
  });

  it("picks up a late registration — the ledger is the source, not a mount-time snapshot", () => {
    const { result, rerender } = coordinator(true, [{ id: "welcome" }]);
    act(() => result.current.complete("welcome"));
    expect(result.current.activeStepId).toBeUndefined();
    rerender({ active: true, steps: TWO_STEPS });
    expect(result.current.activeStepId).toBe("connect-model");
  });

  it("has a stable complete identity across re-renders", () => {
    const { result, rerender } = coordinator();
    const first = result.current.complete;
    rerender({ active: true, steps: [...TWO_STEPS] });
    expect(result.current.complete).toBe(first);
  });
});
