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
 * AMIBA'S SELECTION IS AUTHORITATIVE. The bridge projects every ``activeId``
 * transition onto the official side and re-projects whenever the official
 * current drifts away from it. The official runtime runs selection policies
 * of its own at boot (a persisted ``dsh.sessions.current`` restore, and
 * ``workspaces.startInitialSelection`` opening the recent workspace's
 * session), and Amiba windows deliberately start empty — so a non-empty
 * official current while Amiba holds NO selection is runtime policy, not a
 * user action, and is cleared rather than followed. Following it made cold
 * windows jump into a session instead of landing on the home view.
 *
 * amiba → official (``setActive``): the official ``open(id)`` FAILS LOUD on
 * ids not yet in its list (``sessions.select: unknown session`` — the
 * manager checks its summaries before selecting), and a freshly minted
 * Amiba session races that list: Amiba creates blank sessions locally and
 * the real DSH session only materializes on first submit. So an unlisted id
 * is DEFERRED: the bridge clears the official selection (so official
 * session-scoped slots do not keep rendering the previous session under the
 * new draft surface) and opens the id once the official list gains it. A
 * newer ``setActive`` supersedes the pending target; a target that vanishes
 * from the list again, or whose open throws, returns to deferral instead of
 * being dropped silently.
 *
 * official → amiba (``onExternalOpen``): forwarded ONLY when Amiba already
 * holds a session and the official side moved to a DIFFERENT one — the one
 * shape the runtime's own boot policies cannot produce (they select into an
 * empty window). That is the deliberate ecosystem open (a plugin calling
 * ``ctx.sessions.open``); it routes through the existing Amiba open-session
 * path (the ``amiba:open-session`` event → product-shell ``openSession``).
 * An official ``clear()`` is NOT forwarded (Amiba has no external deselect
 * path today) — recorded asymmetry, benign: official seats simply render
 * nothing until the next projection.
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
 *   switched to a different session while Amiba already held one.
 */
export function createSessionsBridge(
  sessions: OfficialSessionsFace,
  onExternalOpen: (sessionId: string) => void,
): AmibaSessionsBridge {
  /** Amiba's latest projected selection ("" = none) — the authority. */
  let lastPushed = "";
  /** Deferred amiba→official target not yet in the official list. */
  let pending: string | null = null;
  /** The official current as this bridge last observed it ("" = none). */
  let lastSeenCurrent = sessions.list.getSnapshot().current ?? "";
  let disposed = false;

  const tryOpen = (id: string): boolean => {
    try {
      sessions.open(id);
      return true;
    } catch (error) {
      // Reachable when the row leaves the list between the membership check
      // and the microtask that opens it; keep the official fail-loud visible
      // without taking the shell down, and let the caller re-defer.
      console.error(
        `amiba-ui-shell sessions bridge: official open(${id}) failed`,
        error,
      );
      return false;
    }
  };

  /** Push Amiba's selection onto the official side (deferring when unlisted). */
  const project = (id: string, snapshot: OfficialSessionListSnapshot): void => {
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
    if (current !== "") sessions.clear();
    pending = id;
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
        const listed = sessions.list.getSnapshot().ids.includes(target);
        // The row can leave the list again inside the microtask; keep the
        // target deferred rather than dropping it into a silent desync.
        if (!listed || !tryOpen(target)) pending = target;
      });
    }
    const current = snapshot.current ?? "";
    if (current === lastSeenCurrent) return;
    lastSeenCurrent = current;
    if (current === lastPushed) return; // echo of our own projection
    if (lastPushed !== "" && current !== "") {
      // Amiba holds a session and the official side moved to another one:
      // a deliberate ecosystem open. Follow it (the forward comes back
      // through setActive, which no-ops against the already-current id).
      onExternalOpen(current);
      return;
    }
    // Amiba holds no selection (or the official side cleared): runtime
    // policy, not a user action — re-project Amiba's authority.
    project(lastPushed, snapshot);
  };

  const unsubscribe = sessions.list.subscribe(handleListChange);

  return {
    setActive(id: string): void {
      if (disposed) return;
      lastPushed = id;
      pending = null;
      project(id, sessions.list.getSnapshot());
    },
    dispose(): void {
      disposed = true;
      pending = null;
      unsubscribe();
    },
  };
}
