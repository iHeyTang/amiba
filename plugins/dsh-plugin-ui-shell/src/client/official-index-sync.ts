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
