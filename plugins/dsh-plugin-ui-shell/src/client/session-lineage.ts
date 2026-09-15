import type { SessionListState } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";

export interface LineageTitle {
  readonly id: SessionId;
  readonly displayTitle: string;
  readonly current: boolean;
}

/** Only real subagent ancestry participates; forks do not imply a subagent parent. */
export function sessionLineage(list: SessionListState, activeId: string): readonly LineageTitle[] {
  if (!activeId || list.current !== activeId) return [];
  const result: LineageTitle[] = [];
  const seen = new Set<string>();
  let cursor: SessionId | undefined = list.current;
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor);
    const summary: SessionListState["byId"][SessionId] | undefined = list.byId[cursor];
    if (!summary) break;
    const current = cursor === activeId;
    // Upstream dispatches this slot for the current title and subagent ancestors.
    // The ordinary ancestor's title is not a lineage slot.
    if (current || summary.origin === "subagent") {
      result.unshift({ id: summary.id, displayTitle: summary.displayTitle, current });
    }
    if (summary.origin !== "subagent") break;
    cursor = summary.parentId;
  }
  return result;
}

export function equalSessionLineage(left: readonly LineageTitle[], right: readonly LineageTitle[]): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return other !== undefined && entry.id === other.id
      && entry.displayTitle === other.displayTitle && entry.current === other.current;
  });
}
