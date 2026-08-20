import type { SessionListState } from "@deepseek-ai/dsh-client-runtime/client";

/**
 * Rule 1 of the official onboarding coordinator, reproduced verbatim from
 * `SettingsRoot` in `@deepseek-ai/dsh-client-ui-settings-general`:
 *
 * ```js
 * const onboardingActive = useSessions((state) =>
 *   state.phase === "ready" &&
 *   (state.current === void 0 || state.byId[state.current]?.blank === true));
 * ```
 *
 * The selector is a pure function of the OFFICIAL sessions list snapshot, and
 * that is deliberate: `ctx.sessions` is the official service, the standard
 * `useSessions` hook is on every slot component's props (`GlobalStandardProps`
 * in dsh-client-runtime), and Amiba already keeps the official current
 * selection in lock-step with its own through the R1 sessions bridge. So the
 * "Amiba equivalent" of upstream's empty-Hero fact is not an approximation —
 * it is the same store, read with the same predicate:
 *
 *   - `phase === "ready"` — the host list has landed at least once. Before
 *     that Amiba is still booting and no onboarding step should mount.
 *   - `current === undefined` — no session is selected. That IS Amiba's home
 *     view: the sessions bridge calls `ctx.sessions.clear()` whenever Amiba's
 *     own `activeId` is `""`, which is exactly the state
 *     `resolveChatSurfaceMode` calls `"home"`.
 *   - `byId[current]?.blank === true` — the selected session's EMPTY-LOG bit,
 *     as the host derives it ("blank sessions are reused by New Session
 *     instead of minting another"). Amiba's freshly created, never-submitted
 *     task is exactly such a row; the bit flips to false on the first
 *     accepted prompt, which is the moment the draft stops being a draft.
 *
 * A missing row answers false, as upstream's optional chain does: an id the
 * host list does not carry is not evidence of a blank session.
 */
export function isOnboardingActive(state: SessionListState): boolean {
  return (
    state.phase === "ready" &&
    (state.current === undefined || state.byId[state.current]?.blank === true)
  );
}
