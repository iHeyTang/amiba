import { useEffect, useRef, useState } from "react";

import { getHermesMessages, type SessionMeta } from "@amiba/core";
import { getPlatform, type WorkspaceChange } from "@amiba/platform";
import { splitWorkspaceFromBody } from "./helpers";

export interface WorkspaceBindingsState {
  /** False on runtimes such as the browser extension that have no directories. */
  supported: boolean;
  /** Becomes true after the initial binding snapshot has resolved. */
  ready: boolean;
  /** Canonical absolute workspace path keyed by conversation id. */
  bySessionId: Record<string, string>;
}

/**
 * Read the complete workspace binding index once, then maintain it from the
 * same bind/unbind event stream used by the active-conversation composer.
 *
 * The initial list call keeps the sidebar to one IPC round-trip regardless of
 * history size. Changes that arrive while that snapshot is in flight are
 * replayed over it so a newly-created conversation cannot briefly disappear
 * into the unbound group.
 */
export function useWorkspaceBindings(
  sessions: SessionMeta[] = [],
): WorkspaceBindingsState {
  const workspaces = getPlatform().workspaces;
  const [state, setState] = useState<WorkspaceBindingsState>(() => ({
    supported: !!workspaces,
    ready: !workspaces,
    bySessionId: {},
  }));
  const bindingsRef = useRef(state.bySessionId);
  const attemptedLegacyRestoreRef = useRef(new Set<string>());
  bindingsRef.current = state.bySessionId;

  useEffect(() => {
    if (!workspaces) {
      setState({ supported: false, ready: true, bySessionId: {} });
      return;
    }

    let active = true;
    let loading = true;
    const changesDuringLoad = new Map<string, string | null>();

    const applyChange = (change: WorkspaceChange) => {
      if (loading) {
        changesDuringLoad.set(
          change.sessionId,
          change.kind === "bound" ? change.path : null,
        );
      }
      setState((previous) => {
        const bySessionId = { ...previous.bySessionId };
        if (change.kind === "bound") {
          bySessionId[change.sessionId] = change.path;
        } else {
          delete bySessionId[change.sessionId];
        }
        return { ...previous, bySessionId };
      });
    };

    setState((previous) => ({
      supported: true,
      ready: false,
      bySessionId: previous.bySessionId,
    }));
    const unsubscribe = workspaces.onChange(applyChange);

    void workspaces
      .listBindings()
      .then((snapshot) => {
        if (!active) return;
        loading = false;
        const bySessionId = { ...snapshot };
        for (const [sessionId, path] of changesDuringLoad) {
          if (path) bySessionId[sessionId] = path;
          else delete bySessionId[sessionId];
        }
        setState({ supported: true, ready: true, bySessionId });
      })
      .catch(() => {
        if (!active) return;
        loading = false;
        setState((previous) => ({ ...previous, ready: true }));
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [workspaces]);

  useEffect(() => {
    if (!workspaces || !state.ready) return;

    // Earlier desktop builds persisted the injected `<workspace>` message but
    // not the session→directory index used by the sidebar and structured cwd.
    // Hermes exposes a short first-message preview, so only fetch the small
    // subset of legacy candidates that visibly start with that internal tag.
    const candidates = sessions.filter((session) => {
      if (bindingsRef.current[session.id]) return false;
      if (attemptedLegacyRestoreRef.current.has(session.id)) return false;
      return session.preview
        ?.trimStart()
        .toLowerCase()
        .startsWith("<workspace");
    });

    for (const session of candidates) {
      attemptedLegacyRestoreRef.current.add(session.id);
      void getHermesMessages(session.id)
        .then(async (result) => {
          if (!result.ok || bindingsRef.current[session.id]) return;
          let restoredPath = "";
          for (const message of result.messages) {
            if (
              message.role !== "user" ||
              typeof message.content !== "string"
            ) {
              continue;
            }
            restoredPath = splitWorkspaceFromBody(
              message.content,
            ).workspacePath;
            if (restoredPath) break;
          }
          if (!restoredPath || bindingsRef.current[session.id]) return;
          await workspaces.bind(session.id, restoredPath);
        })
        .catch(() => {
          // A missing or moved legacy directory should leave the conversation
          // in the normal unbound group rather than blocking the sidebar.
        });
    }
  }, [sessions, state.ready, workspaces]);

  return state;
}
