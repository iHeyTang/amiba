import type { SessionListState } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SnapshotSelectorHook } from "@deepseek-ai/dsh-client-ui-slots";
import {
  useOnboardingCoordinator,
  type OnboardingStepRow,
} from "@amiba/ui";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { isOnboardingActive } from "./settings-onboarding.js";

/** Ledger projection of `settings.onboarding`, in ascending `order`. */
export interface SettingsOnboardingStepsSource {
  getSnapshot: () => readonly OnboardingStepRow[];
  subscribe: (listener: () => void) => () => void;
}

const EMPTY_STEPS: readonly OnboardingStepRow[] = [];

export interface SettingsShell {
  /** Whether the settings dialog is open (the shell owns this, not a route). */
  open: boolean;
  /**
   * Open the dialog, optionally addressing one registered section. This is
   * the target of the `open-settings` layout action AND of the onboarding
   * owner's `openSection` — one path, so a step's deep link and the sidebar's
   * navigation cannot drift.
   */
  openAt: (sectionId?: string) => void;
  close: () => void;
  /** The one onboarding step to mount right now, or undefined. */
  onboardingStepId: string | undefined;
  /** Complete a step and hand off to the next registered one. */
  completeOnboardingStep: (stepId: string) => void;
}

/**
 * Address a settings section in the URL hash — the ONE routing source
 * `SettingsView` reads (on mount, and on `hashchange` while mounted).
 *
 * Writing the hash before opening is what keeps every deep link working
 * across the view→dialog change: with the dialog closed `SettingsView` is
 * unmounted, so it reads the fresh hash as it mounts; with it already open
 * the synthetic `hashchange` is what moves it, because `replaceState` fires
 * no event of its own.
 */
function addressSection(sectionId: string): void {
  const base = window.location.pathname + window.location.search;
  window.history.replaceState(null, "", `${base}#dsh:${sectionId}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/**
 * Settings-dialog open state plus the official onboarding coordinator.
 *
 * Both live here rather than inline in the product shell because both are
 * contract surfaces worth testing without mounting the whole chat view: the
 * `open-settings` layout action (every Amiba entry path funnels through it —
 * the sidebar nav's section rows, `ctx.layout.openSettings(id)` from any
 * plugin, and the onboarding owner's `openSection`) and the coordinator's
 * six rules.
 */
export function useSettingsShell({
  steps,
  useOfficialSessions,
}: {
  steps?: SettingsOnboardingStepsSource;
  useOfficialSessions: SnapshotSelectorHook<SessionListState>;
}): SettingsShell {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const openAt = useCallback((sectionId?: string) => {
    if (sectionId !== undefined) addressSection(sectionId);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onLayoutAction = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (detail?.action !== "open-settings") return;
      openAt(
        typeof detail.sectionId === "string" ? detail.sectionId : undefined,
      );
    };
    window.addEventListener("amiba:dsh-layout-action", onLayoutAction);
    return () =>
      window.removeEventListener("amiba:dsh-layout-action", onLayoutAction);
  }, [openAt]);

  const registeredSteps = useSyncExternalStore(
    steps?.subscribe ?? (() => () => {}),
    steps?.getSnapshot ?? (() => EMPTY_STEPS),
  );
  // Rule 1 straight off the OFFICIAL sessions store, through the framework's
  // own `useSessions` standard hook; rules 2-4 and 6 in @amiba/ui's
  // coordinator; rule 5 (`openSection`) is `openAt` above.
  const onboardingActive = useOfficialSessions(isOnboardingActive);
  const { activeStepId, complete } = useOnboardingCoordinator(
    onboardingActive,
    registeredSteps,
  );

  return {
    open,
    openAt,
    close,
    onboardingStepId: activeStepId,
    completeOnboardingStep: complete,
  };
}
