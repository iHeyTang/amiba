/**
 * The composer's trigger session: everything one composer instance needs to
 * speak the official pipeline, resolved once per (runtime, session) pair.
 *
 * Two mounts, one model:
 *   - `official: true` — the host runtime resolved a per-session
 *     `InputTriggerController`. The composer DRIVES it (track / onSpace /
 *     adjudicate / serializeReference) and the menu renders from the
 *     shadowed `conversation.input.overlay` seat.
 *   - `official: false` — no plugin runtime, or a draft whose DSH session has
 *     not materialized yet. The composer's own provider registry serves the
 *     menu, over the SAME sources and through the SAME editor verbs.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReferenceResolver } from "../expandMentions";
import {
  localReferenceResolver,
  localTriggerSources,
} from "../providers/dsh-sources";
import { CommandClaimStore } from "./claim";
import type {
  CommandClaim,
  ComposerTriggerController,
  ComposerTriggerRuntime,
  SubmitOutcome,
  TriggerGuard,
  InputTriggerSource,
} from "./contracts";
import { DraftRevision } from "./editor-ops";

export interface ComposerTriggerSession {
  readonly draftSources: readonly InputTriggerSource[];
  readonly claims: CommandClaimStore;
  readonly revision: DraftRevision;
  /** The official controller, when the host runtime resolved one. */
  readonly controller?: ComposerTriggerController;
  /** True exactly when the official pipeline owns this composer's menu. */
  readonly official: boolean;
  readonly runtime?: ComposerTriggerRuntime;
  readonly sessionId?: string;
  /** Model-form resolution for reference chips at submit time. */
  readonly resolver: ReferenceResolver;
  /**
   * Run a command claim's submit transaction against the session scope, or
   * `null` on a surface with no plugin runtime (where a claim cannot occur —
   * Amiba's own sources never return one).
   */
  readonly submitClaim:
    | ((claim: CommandClaim, args: string, images?: Parameters<CommandClaim["submit"]>[2]) => Promise<SubmitOutcome>)
    | null;
  /** The availability tier handed to `track` (upstream's `guardOf(phase)`). */
  guard(): TriggerGuard;
  /** Mark a submit attempt in flight: `'frozen'` suppresses both triggers. */
  setAttemptInFlight(inFlight: boolean, phase?: "adjudicating" | "submitting"): void;
}

export interface UseComposerTriggersOptions {
  runtime?: ComposerTriggerRuntime;
  sessionId?: string;
  /** The composer is not editable: upstream freezes the triggers too. */
  disabled?: boolean;
}

export function useComposerTriggers(
  options: UseComposerTriggersOptions,
): ComposerTriggerSession {
  const { runtime, sessionId, disabled = false } = options;
  const draftSources = useSyncExternalStore(runtime?.subscribe ?? noSubscribe, runtime?.draftSources ?? emptySources, emptySources);
  const claims = useMemo(() => sessionId && runtime?.commandClaimsFor ? runtime.commandClaimsFor(sessionId) : new CommandClaimStore(), [runtime, sessionId]);
  const revision = useMemo(() => new DraftRevision(), []);
  const attemptRef = useRef(false);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  // The controller is resolved in an effect, not during render: on a freshly
  // minted draft the DSH session materializes later, so the first answer is
  // legitimately `undefined` and the seat is legitimately empty.
  const [controller, setController] = useState<
    ComposerTriggerController | undefined
  >(undefined);
  useEffect(() => {
    if (runtime === undefined || !sessionId) {
      setController(undefined);
      return;
    }
    const resolve = (): void => {
      setController((previous) => {
        const next = runtime.controllerFor(sessionId);
        return next === previous ? previous : next;
      });
    };
    resolve();
    // Re-resolve when the official session roster moves: a freshly minted
    // Amiba draft has no DSH session yet, and without this the composer would
    // stay on the session-less path for that entire session.
    return runtime.subscribe?.(resolve);
  }, [runtime, sessionId]);

  // A session switch abandons any command mode: the claim belonged to the
  // draft that just went away.
  useEffect(() => {
    if (runtime?.commandClaimsFor && sessionId) return () => {
      if (runtime.inputSubmissionSource?.(sessionId).getSnapshot().pending) return;
      claims.release(); claims.setAttemptPhase(null);
    };
    claims.release();
  }, [claims, runtime, sessionId]);

  const resolver = useMemo<ReferenceResolver>(() => {
    if (controller !== undefined) return controller;
    return localReferenceResolver([...localTriggerSources(sessionId), ...draftSources]);
  }, [controller, sessionId, draftSources]);

  return useMemo<ComposerTriggerSession>(
    () => ({
      draftSources,
      claims,
      revision,
      controller,
      official: controller !== undefined,
      runtime,
      sessionId,
      resolver,
      submitClaim:
        runtime?.submitClaim !== undefined && sessionId
          ? (claim: CommandClaim, args: string, images?: Parameters<CommandClaim["submit"]>[2]): Promise<SubmitOutcome> =>
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              runtime.submitClaim!(sessionId, claim, args, images)
          : null,
      guard(): TriggerGuard {
        if (attemptRef.current || disabledRef.current || (sessionId && runtime?.inputSubmissionSource?.(sessionId).getSnapshot().pending)) return { tier: "frozen" };
        return { tier: claims.get() !== null ? "claimed" : "plain" };
      },
      setAttemptInFlight(inFlight: boolean, phase: "adjudicating" | "submitting" = "adjudicating") {
        attemptRef.current = inFlight;
        claims.setAttemptPhase(inFlight ? phase : null);
      },
    }),
    [claims, controller, resolver, revision, runtime, sessionId, draftSources],
  );
}

const EMPTY_SOURCES: readonly InputTriggerSource[] = [];
const emptySources = () => EMPTY_SOURCES;
const noSubscribe = () => () => {};
