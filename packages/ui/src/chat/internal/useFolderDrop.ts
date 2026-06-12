import { useCallback, useEffect, useMemo, useState, type DragEvent, type HTMLAttributes } from "react";
import { getPlatform } from "@amiba/platform";
import { useSessions } from "@amiba/core";

/**
 * "Workspace binding" is the desktop-only feature where the user
 * drags a folder onto the chat surface to pin it as the working
 * directory for this session — subsequent file-system tool calls use
 * that path as their root. The capability lives in `platform.workspaces`
 * (Electron preload bridge); on the extension side `getPlatform().workspaces`
 * is `undefined` and this hook stays inert.
 *
 * The hook owns the surface state (current path, error chip, drag-over
 * ring) AND the engine subscription that keeps the path chip in sync
 * with the active session's binding. It exposes drop-handler props that
 * the caller spreads onto whatever DOM region should accept folder
 * drops (typically the outer wrapper that also contains the composer).
 */
export interface UseFolderDropArgs {
  sessions: ReturnType<typeof useSessions>;
}

export interface UseFolderDropResult {
  /** Currently bound path for `sessions.activeId`, or null. */
  workspacePath: string | null;
  /** User-actionable error from the last bind/unbind attempt. The
   * surface renders this in the error chip row; the X button clears it
   * via `setWorkspaceError(null)`. */
  workspaceError: string | null;
  setWorkspaceError: (v: string | null) => void;
  /** True while a folder drag is hovering the drop region. The surface
   * uses this to draw the primary-tinted ring on the wrapper and to
   * show the "Drop folder…" overlay. */
  folderDragOver: boolean;
  /** Spread these onto the wrapper element that should accept folder
   * drops. Internally gates on `dragHasDirectory(dt)` so file-only
   * drops (which Composer's attachment flow owns) pass through
   * untouched. */
  dropHandlers: Pick<
    HTMLAttributes<HTMLDivElement>,
    "onDragOver" | "onDragLeave" | "onDrop"
  >;
  /** Detach the current session's workspace binding. The path chip's X
   * button calls this. */
  unbindCurrent: () => void;
}

/** Electron 33 removed `File.path` from the renderer; the preload
 * bridge exposes `webUtils.getPathForFile()` via
 * `window.amiba.workspaces.getPathForFile`. Returns null when the
 * bridge isn't present (extension / web). */
function resolveDroppedFolderPath(file: File): string | null {
  const bridge = (
    window as unknown as {
      amiba?: { workspaces?: { getPathForFile?: (f: File) => string } };
    }
  ).amiba?.workspaces?.getPathForFile;
  if (!bridge) return null;
  try {
    const p = bridge(file);
    return p && p.length > 0 ? p : null;
  } catch {
    return null;
  }
}

/** True iff the active drag carries at least one filesystem directory.
 * Used to gate the folder-drop overlay so file drops on the composer
 * (which the composer's own handler owns) don't accidentally trigger
 * workspace binding. */
function dragHasDirectory(dt: DataTransfer): boolean {
  const items = dt.items;
  if (!items) return false;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind !== "file") continue;
    const entry = (
      it as DataTransferItem & {
        webkitGetAsEntry?: () => { isDirectory?: boolean } | null;
      }
    ).webkitGetAsEntry?.();
    if (entry && entry.isDirectory) return true;
  }
  return false;
}

export function useFolderDrop(args: UseFolderDropArgs): UseFolderDropResult {
  const { sessions } = args;

  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [folderDragOver, setFolderDragOver] = useState(false);

  // Per-session workspace binding. Re-read on activeId change so
  // switching sessions flips the chip to the new session's binding
  // (or hides it if that session has none). Extension lacks the
  // `workspaces` sub-API entirely — the chip/drop overlay stays
  // hidden in that case.
  useEffect(() => {
    const ws = getPlatform().workspaces;
    if (!ws) return;
    const activeId = sessions.activeId;
    if (!activeId) {
      setWorkspacePath(null);
      return;
    }
    let cancelled = false;
    void ws.getCurrent(activeId).then((p) => {
      if (!cancelled) setWorkspacePath(p);
    });
    const unsub = ws.onChange((change) => {
      // Only react to changes for the session this surface is showing —
      // a bind on session B should not move session A's chip.
      if (change.sessionId !== activeId) return;
      if (change.kind === "bound") setWorkspacePath(change.path);
      else if (change.kind === "unbound") setWorkspacePath(null);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [sessions.activeId]);

  const handleFolderDrop = useCallback(
    async (files: File[]): Promise<void> => {
      const ws = getPlatform().workspaces;
      if (!ws) return;
      // First folder wins. Mixed selections (folder + files) pick the
      // folder and ignore the rest — the file drop happens on the
      // composer, not here.
      let chosen: string | null = null;
      for (const f of files) {
        const p = resolveDroppedFolderPath(f);
        if (p) {
          chosen = p;
          break;
        }
      }
      if (!chosen) {
        setWorkspaceError("Could not resolve the dropped folder's path.");
        return;
      }
      try {
        // Bindings are session-scoped: ensure an active session exists
        // so a drop on a brand-new app launch (no chat yet) still pins
        // to a real session id rather than failing silently.
        const sessionId = sessions.ready
          ? await sessions.ensureActive()
          : null;
        if (!sessionId) {
          setWorkspaceError(
            "Open or start a chat session before binding a workspace.",
          );
          return;
        }
        await ws.bind(sessionId, chosen);
        setWorkspaceError(null);
      } catch (e) {
        setWorkspaceError(String((e as Error)?.message || e));
      }
    },
    [sessions],
  );

  const dropHandlers = useMemo<UseFolderDropResult["dropHandlers"]>(
    () => ({
      onDragOver: (e: DragEvent<HTMLDivElement>) => {
        // Workspace binding is a desktop-only capability — bail early on
        // the extension surface so the composer's file-drop handler
        // keeps owning the chat-area drop without competition.
        if (!getPlatform().workspaces) return;
        const dt = e.dataTransfer;
        if (!dt) return;
        if (!Array.from(dt.types || []).includes("Files")) return;
        if (!dragHasDirectory(dt)) return;
        e.preventDefault();
        setFolderDragOver((prev) => (prev ? prev : true));
      },
      onDragLeave: (e: DragEvent<HTMLDivElement>) => {
        // A nested element inside the drop region fires `dragleave` even
        // when the pointer hasn't actually left the wrapper. Only clear
        // when the related target is outside our subtree.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setFolderDragOver(false);
      },
      onDrop: (e: DragEvent<HTMLDivElement>) => {
        if (!getPlatform().workspaces) return;
        const dt = e.dataTransfer;
        if (!dt || !dragHasDirectory(dt)) return;
        e.preventDefault();
        setFolderDragOver(false);
        const files = Array.from(dt.files || []);
        if (files.length > 0) void handleFolderDrop(files);
      },
    }),
    [handleFolderDrop],
  );

  const unbindCurrent = useCallback(() => {
    const ws = getPlatform().workspaces;
    if (!ws) return;
    const sid = sessions.activeId;
    if (!sid) return;
    void ws.unbind(sid).catch((e) => {
      setWorkspaceError(String((e as Error)?.message || e));
    });
  }, [sessions.activeId]);

  return {
    workspacePath,
    workspaceError,
    setWorkspaceError,
    folderDragOver,
    dropHandlers,
    unbindCurrent,
  };
}
