import { useEffect, useMemo, useState } from "react";

import { getPlatform, type WorkspaceChange } from "@amiba/app-runtime/platform";

export interface WorkspaceBindingsState {
  /** False on hosts that do not expose a native workspace adapter. */
  supported: boolean;
  /** Becomes true after the initial binding snapshot has resolved. */
  ready: boolean;
  /** Manually bound workspace paths; the implicit task workspace is excluded. */
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
export function useWorkspaceBindings(): WorkspaceBindingsState {
  const platform = getPlatform();
  const workspaces = platform.workspaces;
  const [explicitBindings, setExplicitBindings] = useState<
    Record<string, string>
  >({});
  const [defaultRoot, setDefaultRoot] = useState<string | null>(null);
  const [ready, setReady] = useState(!workspaces);

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

  const bySessionId = useMemo(() => {
    return Object.fromEntries(
      Object.entries(explicitBindings).filter(([, path]) => path !== defaultRoot),
    );
  }, [defaultRoot, explicitBindings]);

  return {
    supported: !!workspaces,
    ready,
    bySessionId,
  };
}
