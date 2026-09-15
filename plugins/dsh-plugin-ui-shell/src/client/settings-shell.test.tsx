// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionListState } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SnapshotSelectorHook } from "@deepseek-ai/dsh-client-ui-slots";
import type { OnboardingStepRow } from "@amiba/ui";

import {
  useSettingsShell,
  type SettingsOnboardingStepsSource,
} from "./settings-shell.js";

/**
 * Honest double of the OFFICIAL sessions list store behind the framework's
 * `useSessions` standard hook: a snapshot plus the selector call, which is
 * all the coordinator's active fact consumes. The state is driven by the
 * test the way the real store is driven by the host — home (`current`
 * undefined), a blank session, and a session with a log.
 */
function officialSessions(initial: {
  phase: "pending" | "ready";
  current?: string;
  byId?: Record<string, { blank: boolean }>;
}) {
  let snapshot = initial;
  const hook: SnapshotSelectorHook<SessionListState> = (selector) =>
    selector({
      ids: Object.keys(snapshot.byId ?? {}),
      byId: snapshot.byId ?? {},
      current: snapshot.current,
      phase: snapshot.phase,
    } as unknown as SessionListState);
  return {
    hook,
    set(next: typeof initial) {
      snapshot = next;
    },
  };
}

/** A fixture plugin's two `settings.onboarding` registrations, in order. */
function stepLedger(
  initial: readonly OnboardingStepRow[],
): SettingsOnboardingStepsSource & { set(next: readonly OnboardingStepRow[]): void } {
  let rows = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => rows,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      rows = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

function layoutAction(detail: Record<string, unknown>) {
  window.dispatchEvent(
    new CustomEvent("amiba:dsh-layout-action", { detail }),
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

// This package runs vitest without `globals`, so @testing-library/react does
// NOT auto-register its cleanup. Without this, every hook rendered by an
// earlier test stays mounted with its own window listener and the next test
// sees N handlers for one event.
afterEach(cleanup);

describe("settings dialog open state", () => {
  it("starts closed", () => {
    const sessions = officialSessions({ phase: "ready" });
    const { result } = renderHook(() =>
      useSettingsShell({ useOfficialSessions: sessions.hook }),
    );
    expect(result.current.open).toBe(false);
  });

  it("opens on the open-settings layout action and lands on the addressed section", () => {
    const sessions = officialSessions({ phase: "ready" });
    const { result } = renderHook(() =>
      useSettingsShell({ useOfficialSessions: sessions.hook }),
    );
    act(() => layoutAction({ action: "open-settings", sectionId: "skills" }));
    expect(result.current.open).toBe(true);
    // The hash IS the routing source SettingsView reads — deep linking
    // survives the view→dialog change because addressing still happens here.
    expect(window.location.hash).toBe("#dsh:skills");
  });

  it("re-addresses an ALREADY OPEN dialog, and announces it with a hashchange", () => {
    const sessions = officialSessions({ phase: "ready" });
    const { result } = renderHook(() =>
      useSettingsShell({ useOfficialSessions: sessions.hook }),
    );
    act(() => layoutAction({ action: "open-settings", sectionId: "skills" }));
    let announced = 0;
    const onHashChange = () => {
      announced += 1;
    };
    window.addEventListener("hashchange", onHashChange);
    act(() => layoutAction({ action: "open-settings", sectionId: "memory" }));
    window.removeEventListener("hashchange", onHashChange);
    expect(result.current.open).toBe(true);
    expect(window.location.hash).toBe("#dsh:memory");
    // replaceState fires no event of its own; without this synthetic one an
    // open dialog would never move to the newly addressed section.
    expect(announced).toBe(1);
  });

  it("opens without touching the hash when no section is addressed", () => {
    const sessions = officialSessions({ phase: "ready" });
    window.history.replaceState(null, "", "/#logs");
    const { result } = renderHook(() =>
      useSettingsShell({ useOfficialSessions: sessions.hook }),
    );
    act(() => layoutAction({ action: "open-settings" }));
    expect(result.current.open).toBe(true);
    expect(window.location.hash).toBe("#logs");
  });

  it("ignores unrelated layout actions", () => {
    const sessions = officialSessions({ phase: "ready" });
    const { result } = renderHook(() =>
      useSettingsShell({ useOfficialSessions: sessions.hook }),
    );
    act(() => layoutAction({ action: "open-chat" }));
    act(() => layoutAction({ action: "toggle-sidebar" }));
    expect(result.current.open).toBe(false);
  });

  it("closes", () => {
    const sessions = officialSessions({ phase: "ready" });
    const { result } = renderHook(() =>
      useSettingsShell({ useOfficialSessions: sessions.hook }),
    );
    act(() => result.current.openAt());
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
  });

  it("stops listening once unmounted", () => {
    const sessions = officialSessions({ phase: "ready" });
    const { result, unmount } = renderHook(() =>
      useSettingsShell({ useOfficialSessions: sessions.hook }),
    );
    unmount();
    act(() => layoutAction({ action: "open-settings", sectionId: "skills" }));
    expect(result.current.open).toBe(false);
  });
});

describe("onboarding coordinator, end to end over the official sessions store", () => {
  const STEPS: readonly OnboardingStepRow[] = [
    { id: "step-a" },
    { id: "step-b" },
  ];

  it("presents a fixture plugin's two steps ONE AT A TIME, in registration order", () => {
    const sessions = officialSessions({ phase: "ready" });
    const steps = stepLedger(STEPS);
    const { result } = renderHook(() =>
      useSettingsShell({ steps, useOfficialSessions: sessions.hook }),
    );
    expect(result.current.onboardingStepId).toBe("step-a");
    act(() => result.current.completeOnboardingStep("step-a"));
    expect(result.current.onboardingStepId).toBe("step-b");
    act(() => result.current.completeOnboardingStep("step-b"));
    expect(result.current.onboardingStepId).toBeUndefined();
  });

  it("mounts nothing before the session list is ready", () => {
    const sessions = officialSessions({ phase: "pending" });
    const steps = stepLedger(STEPS);
    const { result } = renderHook(() =>
      useSettingsShell({ steps, useOfficialSessions: sessions.hook }),
    );
    expect(result.current.onboardingStepId).toBeUndefined();
  });

  it("stays active on a blank session and stops once that session has a log", () => {
    const sessions = officialSessions({
      phase: "ready",
      current: "s1",
      byId: { s1: { blank: true } },
    });
    const steps = stepLedger(STEPS);
    const { result, rerender } = renderHook(() =>
      useSettingsShell({ steps, useOfficialSessions: sessions.hook }),
    );
    expect(result.current.onboardingStepId).toBe("step-a");
    sessions.set({
      phase: "ready",
      current: "s1",
      byId: { s1: { blank: false } },
    });
    rerender();
    expect(result.current.onboardingStepId).toBeUndefined();
  });

  it("RESETS completion when the active condition is left — deliberately not persisted", () => {
    const sessions = officialSessions({ phase: "ready" });
    const steps = stepLedger(STEPS);
    const { result, rerender } = renderHook(() =>
      useSettingsShell({ steps, useOfficialSessions: sessions.hook }),
    );
    act(() => result.current.completeOnboardingStep("step-a"));
    expect(result.current.onboardingStepId).toBe("step-b");

    sessions.set({
      phase: "ready",
      current: "s1",
      byId: { s1: { blank: false } },
    });
    rerender();
    expect(result.current.onboardingStepId).toBeUndefined();

    sessions.set({ phase: "ready" });
    rerender();
    expect(result.current.onboardingStepId).toBe("step-a");
  });

  it("picks up a late registration through the ledger subscription", () => {
    const sessions = officialSessions({ phase: "ready" });
    const steps = stepLedger([]);
    const { result } = renderHook(() =>
      useSettingsShell({ steps, useOfficialSessions: sessions.hook }),
    );
    expect(result.current.onboardingStepId).toBeUndefined();
    act(() => steps.set(STEPS));
    expect(result.current.onboardingStepId).toBe("step-a");
  });

  it("mounts nothing when no plugin registers a step", () => {
    const sessions = officialSessions({ phase: "ready" });
    const { result } = renderHook(() =>
      useSettingsShell({ useOfficialSessions: sessions.hook }),
    );
    expect(result.current.onboardingStepId).toBeUndefined();
  });

  it("openSection (openAt) opens the dialog directly on the named section", () => {
    // Rule 5 of the coordinator contract, exercised through the very
    // affordance the shell hands the active step.
    const sessions = officialSessions({ phase: "ready" });
    const steps = stepLedger(STEPS);
    const { result } = renderHook(() =>
      useSettingsShell({ steps, useOfficialSessions: sessions.hook }),
    );
    expect(result.current.open).toBe(false);
    act(() => result.current.openAt("models"));
    expect(result.current.open).toBe(true);
    expect(window.location.hash).toBe("#dsh:models");
    // Opening settings does not complete or dismiss the step.
    expect(result.current.onboardingStepId).toBe("step-a");
  });
});
