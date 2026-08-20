import { useCallback, useEffect, useState } from "react";

/** One registered onboarding step, projected from the slot ledger in order. */
export interface OnboardingStepRow {
  id: string;
}

export interface OnboardingCoordinator {
  /**
   * The step to mount right now — the FIRST registered step not yet
   * completed, or `undefined` while the active condition is false or every
   * step is done. Exactly one step is ever mounted.
   */
  activeStepId: string | undefined;
  /** Complete or skip a step and transfer ownership to the next entry. */
  complete: (stepId: string) => void;
}

/**
 * The settings-backed onboarding coordinator, reproduced rule for rule from
 * the official settings shell (`SettingsRoot` in
 * `@deepseek-ai/dsh-client-ui-settings-general`):
 *
 *   1. an `active` fact gates the whole flow (the caller supplies it; see the
 *      product shell for how Amiba derives it from the official sessions
 *      service);
 *   2. the mounted step is `steps.find(step => !completed.has(step.id))` —
 *      the first REGISTERED step not yet completed, in ledger order;
 *   3. the caller renders exactly that one, through `{ only: stepId }`;
 *   4. `complete(id)` marks it done, which hands off to the next;
 *   5. `openSection` belongs to the caller (it is the shell's own affordance);
 *   6. completion is NOT persisted: the completed set RESETS the moment
 *      `active` goes false.
 *
 * Rule 6 is copied deliberately, not improved. It means a user who completes
 * step A, sends a message (active → false) and then returns to a blank
 * session sees step A again. Upstream is the authority on the flow's
 * semantics and a divergence here would make third-party steps written
 * against the official shell behave differently under Amiba — which is
 * exactly the failure this vocabulary policy exists to prevent. If the
 * behaviour is to change, it changes upstream first.
 */
export function useOnboardingCoordinator(
  active: boolean,
  steps: readonly OnboardingStepRow[],
): OnboardingCoordinator {
  const [completed, setCompleted] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  // Rule 6, and the same shape upstream uses: an effect keyed on the active
  // fact alone, which clears the set on every transition into inactive (and
  // once at mount when it starts inactive). The already-empty guard is the
  // one addition — it only skips a redundant re-render, the observable
  // behaviour is upstream's.
  useEffect(() => {
    if (active) return;
    setCompleted((previous) => (previous.size === 0 ? previous : new Set()));
  }, [active]);

  const complete = useCallback((stepId: string) => {
    setCompleted((previous) => {
      if (previous.has(stepId)) return previous;
      return new Set([...previous, stepId]);
    });
  }, []);

  const activeStepId = active
    ? steps.find((step) => !completed.has(step.id))?.id
    : undefined;

  return { activeStepId, complete };
}
