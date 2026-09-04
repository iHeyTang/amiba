import { resolveSlotLabel } from "@deepseek-ai/dsh-client-ui-slots";

import {
  createSlotContributionsSource,
  type ContributionsSource,
  type SlotContributionsCtx,
} from "./session-list-sources.js";

const MESSAGE_SOURCE_SLOT = "amiba.message.source";

/**
 * One `amiba.message.source` registration: the display name a plugin claims
 * for messages it dispatches. `id` is the plugin's own DSH plugin name — the
 * exact value core carries on `ChatMessage.origin.plugin` straight off the
 * `user/message` wire — and `label` is what the conversation shows for it.
 */
export interface MessageSourceRow {
  id: string;
  order: number;
  label: string;
}

/**
 * The `amiba.message.source` contributions source. Purely declarative: unlike
 * the session-list slots there is NO business face at all, because there is
 * no per-session question to answer — a plugin only states "messages tagged
 * with my id are called this". `order` exists solely to keep the projection
 * deterministic when two registrations claim the same id (first wins in
 * {@link messageSourceLabelResolver}).
 */
export function createMessageSourcesSource(
  ctx: SlotContributionsCtx,
): ContributionsSource<MessageSourceRow> {
  return createSlotContributionsSource<MessageSourceRow>(
    ctx,
    MESSAGE_SOURCE_SLOT,
    (entry) => {
      const id = entry.options.id ?? "";
      if (!id) return null;
      return {
        id,
        order: entry.options.order ?? 0,
        label: resolveSlotLabel(entry.options.label) ?? id,
      };
    },
  );
}

/**
 * Folds the contributions into the lookup `<FullScreenChatView
 * messageSourceLabel>` takes. An id nobody registered resolves to
 * `undefined`, which the bubble renders as the raw id rather than dropping
 * the attribution.
 */
export function messageSourceLabelResolver(
  rows: readonly MessageSourceRow[],
): (pluginId: string) => string | undefined {
  const labels = new Map<string, string>();
  for (const row of rows) if (!labels.has(row.id)) labels.set(row.id, row.label);
  return (pluginId: string) => labels.get(pluginId);
}
