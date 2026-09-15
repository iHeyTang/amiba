import { describe, expect, it } from "vitest";
import type { SessionListState } from "@deepseek-ai/dsh-api-session-controller/client";

import { isOnboardingActive } from "./settings-onboarding.js";

/**
 * An official sessions-list snapshot with only the members the predicate
 * reads. The cast is at the SEAM, not inside the predicate: the function
 * itself is typed against the real `SessionListState`, so a drift in the
 * three fields it reads is a compile error, and building the other eight
 * members (`subagentsByParent`, `jobsBySession`, …) here would be noise, not
 * fidelity.
 */
function listState(state: {
  phase: "pending" | "ready";
  current?: string;
  byId?: Record<string, { blank: boolean }>;
}): SessionListState {
  return {
    ids: Object.keys(state.byId ?? {}),
    byId: state.byId ?? {},
    current: state.current,
    phase: state.phase,
  } as unknown as SessionListState;
}

describe("isOnboardingActive — upstream's empty-Hero predicate", () => {
  it("is false while the session list has not landed, even with no selection", () => {
    expect(isOnboardingActive(listState({ phase: "pending" }))).toBe(false);
  });

  it("is true on the home view: ready, and no session current", () => {
    // Amiba's home is exactly this state — the R1 sessions bridge calls
    // ctx.sessions.clear() whenever Amiba's own activeId is "".
    expect(isOnboardingActive(listState({ phase: "ready" }))).toBe(true);
  });

  it("is true on a selected but blank (empty-log) session", () => {
    expect(
      isOnboardingActive(
        listState({
          phase: "ready",
          current: "s1",
          byId: { s1: { blank: true } },
        }),
      ),
    ).toBe(true);
  });

  it("is false once the selected session has a log", () => {
    expect(
      isOnboardingActive(
        listState({
          phase: "ready",
          current: "s1",
          byId: { s1: { blank: false } },
        }),
      ),
    ).toBe(false);
  });

  it("is false for a current id the host list does not carry", () => {
    // A missing row is not evidence of a blank session; upstream's optional
    // chain answers the same way.
    expect(
      isOnboardingActive(
        listState({ phase: "ready", current: "gone", byId: {} }),
      ),
    ).toBe(false);
  });

  it("is false when the list is ready but pending selection has a non-blank row", () => {
    expect(
      isOnboardingActive(
        listState({
          phase: "pending",
          current: "s1",
          byId: { s1: { blank: true } },
        }),
      ),
    ).toBe(false);
  });
});
