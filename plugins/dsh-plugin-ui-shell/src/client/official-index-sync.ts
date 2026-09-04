/**
 * Amiba's own session index (`useSessions().sessions`) is loaded from the
 * host list RPC and re-read only on explicit actions (open-by-id, fork) or
 * when another window writes the shared index. Sessions that appear or change
 * on the HOST — a plugin creating a task session, a blank session getting its
 * first turn — reach the official `ctx.sessions.list` store live, but nothing
 * carried that signal into Amiba's index, so the sidebar silently lagged.
 *
 * `officialListFingerprint` reduces the official snapshot to the facts the
 * index cares about; the product shell re-reads the index whenever it
 * changes. `updatedAt` is deliberately excluded: it moves on every streamed
 * event and would turn the effect into a per-token refresh.
 */
import { useEffect } from "react";

export interface OfficialListRowLike {
  blank: boolean;
  title?: string;
  agentPreset?: string;
}

export interface OfficialListLike {
  ids: readonly string[];
  byId: Readonly<Record<string, OfficialListRowLike | undefined>>;
}

export function officialListFingerprint(state: OfficialListLike): string {
  return state.ids
    .map((id) => {
      const row = state.byId[id];
      if (!row) return id;
      return `${id}:${row.blank ? "b" : "-"}:${row.agentPreset ?? ""}:${row.title ?? ""}`;
    })
    .join("\n");
}

/**
 * The registry-global archive set, as the official workspaces store mirrors
 * it. It lives on a DIFFERENT store from the session list — the host pushes
 * `host/archived-sessions-changed` (the full set) into
 * `ctx.workspaces.list`, not into `ctx.sessions.list` — so archiving is a
 * second, independent trigger for the same index re-read: Amiba projects
 * `SessionMeta.archived` from this set, and archiving in another window (or
 * from the official workspace browser) must move the row into the archived
 * view here too.
 */
export interface OfficialWorkspaceListLike {
  archivedSessionIds: readonly string[];
}

export function officialArchivedFingerprint(
  state: OfficialWorkspaceListLike,
): string {
  return state.archivedSessionIds.join("\n");
}

/**
 * Re-read Amiba's own session index whenever ANY official-store fingerprint
 * changes. Keeping the effect here — rather than inline in the shell — is
 * what makes "a change in either store refreshes the index" testable: the
 * two fingerprints above are joined into one dependency, so adding a third
 * live source later is one more array element and no new effect.
 */
export function useOfficialIndexRefresh(
  fingerprints: readonly string[],
  ready: boolean,
  refresh: () => void | Promise<void>,
): void {
  const key = fingerprints.join("\u0000");
  useEffect(() => {
    if (!ready) return;
    void refresh();
  }, [key, ready, refresh]);
}
