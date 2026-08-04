import { useEffect, useState } from "react";

import { useSessions } from "@amiba/core";
import { getPlatform } from "@amiba/platform";

export interface UseConversationWorkspaceArgs {
  sessions: ReturnType<typeof useSessions>;
}

export interface UseConversationWorkspaceResult {
  /** The immutable workspace bound to the active conversation. */
  workspacePath: string | null;
  /** Failure raised while restoring or creating the conversation binding. */
  workspaceError: string | null;
  setWorkspaceError: (value: string | null) => void;
}

/**
 * Read the active conversation's workspace binding.
 *
 * Workspace selection belongs exclusively to the id-less Home surface. Its
 * first submission creates the session and binds the chosen directory before
 * Hermes receives the message. From that point on the conversation only reads
 * this association: switching conversations restores their own directory, but
 * the conversation composer cannot replace or detach it.
 */
export function useConversationWorkspace({
  sessions,
}: UseConversationWorkspaceArgs): UseConversationWorkspaceResult {
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  useEffect(() => {
    const workspaces = getPlatform().workspaces;
    const activeId = sessions.activeId;

    // Never leave the previous conversation's directory visible while the
    // next binding is crossing the IPC boundary.
    setWorkspacePath(null);
    if (!workspaces || !activeId) return;

    let cancelled = false;
    const restoreCurrent = () =>
      workspaces
        .getCurrent(activeId)
        .then((path) => {
          if (cancelled) return;
          setWorkspacePath(path);
          setWorkspaceError(null);
        })
        .catch((error) => {
          if (cancelled) return;
          setWorkspacePath(null);
          setWorkspaceError(String((error as Error)?.message || error));
        });
    void restoreCurrent();

    const unsubscribe = workspaces.onChange((change) => {
      if (change.sessionId !== activeId) return;
      if (change.kind === "bound") {
        setWorkspacePath(change.path);
        setWorkspaceError(null);
      } else {
        // Removing an explicit project binding returns the task to the
        // product-level $HOME workspace; it is not a "no workspace" state.
        void restoreCurrent();
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [sessions.activeId]);

  return {
    workspacePath,
    workspaceError,
    setWorkspaceError,
  };
}
