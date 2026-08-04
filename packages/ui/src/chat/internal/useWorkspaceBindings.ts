import { useEffect, useMemo, useRef, useState } from "react";

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
  const [explicitBindings, setExplicitBindings] = useState<
    Record<string, string>
  >({});
  const [defaultRoot, setDefaultRoot] = useState<string | null>(null);
  const [ready, setReady] = useState(!workspaces);
  const bindingsRef = useRef(explicitBindings);
  const attemptedLegacyRestoreRef = useRef(new Set<string>());
  bindingsRef.current = explicitBindings;

  useEffect(() => {
    if (!workspaces) {
      setExplicitBindings({});
      setDefaultRoot(null);
      setReady(true);
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
      setExplicitBindings((previous) => {
        const next = { ...previous };
        if (change.kind === "bound") {
          next[change.sessionId] = change.path;
        } else {
          delete next[change.sessionId];
        }
        return next;
      });
    };

    setReady(false);
    const unsubscribe = workspaces.onChange(applyChange);

    void Promise.all([
      workspaces.listBindings().catch(() => ({})),
      workspaces.getDefaultRoot().catch(() => null),
    ])
      .then(([snapshot, root]) => {
        if (!active) return;
        loading = false;
        const next = { ...snapshot };
        for (const [sessionId, path] of changesDuringLoad) {
          if (path) next[sessionId] = path;
          else delete next[sessionId];
        }
        setExplicitBindings(next);
        setDefaultRoot(root);
        setReady(true);
      })

    return () => {
      active = false;
      unsubscribe();
    };
  }, [workspaces]);

  useEffect(() => {
    if (!workspaces || !ready) return;

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
      const messagesRequest = session.agent?.profileId
        ? getHermesMessages(session.id, session.agent.profileId)
        : getHermesMessages(session.id);
      void messagesRequest
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
  }, [sessions, ready, workspaces]);

  const bySessionId = useMemo(() => {
    const resolved = { ...explicitBindings };
    if (defaultRoot) {
      for (const session of sessions) {
        if (!resolved[session.id]) resolved[session.id] = defaultRoot;
      }
    }
    return resolved;
  }, [defaultRoot, explicitBindings, sessions]);

  return {
    supported: !!workspaces,
    ready,
    bySessionId,
  };
}
