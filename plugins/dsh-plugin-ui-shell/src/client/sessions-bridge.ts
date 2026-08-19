/**
 * Selection bridge between Amiba's own sessions store (per-window
 * ``activeId``) and the official dsh-client-runtime sessions service
 * (``ctx.sessions``, whose ``list.current`` selection feeds the renderer's
 * SessionMaybeProvider — the source every session-scoped slot resolves its
 * ``sessionId`` standard kit from). Both sides track the same DSH session
 * ids but hold separate selection state; without this bridge the official
 * ``conversation.*`` seats Amiba dispatches (session scope) would never see
 * a current session.
 *
 * amiba → official (``setActive``): the product shell mirrors every
 * ``activeId`` transition here. The official ``open(id)`` FAILS LOUD on ids
 * not yet in its list (``sessions.select: unknown session`` — the manager
 * checks its summaries before selecting), and a freshly minted Amiba
 * session races that list: Amiba creates blank sessions locally and the
 * real DSH session only materializes on first submit. So an unlisted id is
 * DEFERRED: the bridge clears the official selection (so official
 * session-scoped slots do not keep rendering the previous session under
 * the new draft surface) and opens the id when the official list gains it.
 * A newer ``setActive`` supersedes the pending target.
 *
 * official → amiba (``onExternalOpen``): the bridge subscribes to official
 * ``list.current`` changes so official-ecosystem contributions calling
 * ``ctx.sessions.open`` switch the Amiba surface too. The callback routes
 * through the existing Amiba open-session path (the ``amiba:open-session``
 * event → product-shell ``openSession``).
 *
 * Ping-pong / echo suppression: ``lastPushed`` remembers Amiba's most
 * recent projection; an official current-change equal to it is our own echo
 * and is not forwarded. In the other direction, a forwarded external open
 * flows back through ``setActive`` with the id the official side already
 * has current, which no-ops. An official ``clear()`` from the ecosystem is
 * NOT forwarded (Amiba has no external deselect path today) — recorded
 * asymmetry.
 *
 * Startup: the official runtime may restore a persisted selection; Amiba
 * windows deliberately start with no selection (per-window state). The
 * constructor records the official current as a baseline WITHOUT forwarding
 * it, and the shell's mount-time ``setActive("")`` then converges the
 * official side onto Amiba's empty selection.
 */

/** Minimal observable snapshot of the official session list this bridge reads. */
export interface OfficialSessionListSnapshot {
  /** Host-list order (ids the official `open()` accepts without an address). */
  readonly ids: readonly string[];
  /** The official current selection. */
  readonly current: string | undefined;
}

/**
 * The narrow official sessions face the bridge consumes — a structural
 * subset of dsh-client-runtime's `ctx.sessions` (`ISessions`).
 */
export interface OfficialSessionsFace {
  list: {
    getSnapshot(): OfficialSessionListSnapshot;
    subscribe(listener: () => void): () => void;
  };
  /** Select a listed session as current; throws on ids not in the list. */
  open(id: string): void;
  /** Clear the current selection into the no-session view state. */
  clear(): void;
}

export interface AmibaSessionsBridge {
  /**
   * amiba → official: project the shell's active session id ("" = none).
   * Unlisted ids defer (see module doc); "" clears the official selection.
   */
  setActive(id: string): void;
  dispose(): void;
}

/**
 * @param sessions - the official sessions face (`ctx.sessions`).
 * @param onExternalOpen - called with a session id when the OFFICIAL side
 *   switched to a session Amiba did not push (official-ecosystem opens).
 */
export function createSessionsBridge(
  sessions: OfficialSessionsFace,
  onExternalOpen: (sessionId: string) => void,
): AmibaSessionsBridge {
  /** Amiba's latest projected selection ("" = none). */
  let lastPushed = "";
  /** Deferred amiba→official target not yet in the official list. */
  let pending: string | null = null;
  /**
   * The official current as this bridge last observed it ("" = none).
   * Restored-selection baseline: initialized from the live snapshot so a
   * persisted official selection is not forwarded as an external open.
   */
  let lastSeenCurrent = sessions.list.getSnapshot().current ?? "";
  let disposed = false;

  const tryOpen = (id: string): void => {
    try {
      sessions.open(id);
    } catch (error) {
      // The list-membership guard makes this unreachable in the same tick;
      // keep the official fail-loud visible without taking the shell down.
      console.error(
        `amiba-ui-shell sessions bridge: official open(${id}) failed`,
        error,
      );
    }
  };

  const handleListChange = (): void => {
    if (disposed) return;
    const snapshot = sessions.list.getSnapshot();
    if (pending !== null && snapshot.ids.includes(pending)) {
      const target = pending;
      pending = null;
      // Escape the store-notification stack before mutating the selection.
      queueMicrotask(() => {
        // Superseded while queued (a newer setActive moved on) — drop it.
        if (disposed || lastPushed !== target) return;
        tryOpen(target);
      });
    }
    const current = snapshot.current ?? "";
    if (current === lastSeenCurrent) return;
    lastSeenCurrent = current;
    // Echo of our own open()/clear() — or an official clear, which has no
    // Amiba route today — is not forwarded.
    if (current !== "" && current !== lastPushed) onExternalOpen(current);
  };

  const unsubscribe = sessions.list.subscribe(handleListChange);

  return {
    setActive(id: string): void {
      if (disposed) return;
      lastPushed = id;
      pending = null;
      const snapshot = sessions.list.getSnapshot();
      const current = snapshot.current ?? "";
      if (id === "") {
        if (current !== "") sessions.clear();
        return;
      }
      if (current === id) return;
      if (snapshot.ids.includes(id)) {
        tryOpen(id);
        return;
      }
      // Not listed yet (fresh Amiba draft racing the official list): the
      // official open() would throw. Clear so official session-scoped slots
      // stop rendering the previous session, and defer the open until the
      // list carries the id.
      if (current !== "") sessions.clear();
      pending = id;
    },
    dispose(): void {
      disposed = true;
      pending = null;
      unsubscribe();
    },
  };
}
