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
  resolve?: (pluginId: string) => string | undefined;
}

/** Static names and optional plugin-owned dynamic source resolvers. */
export function createMessageSourcesSource(
  ctx: SlotContributionsCtx,
): ContributionsSource<MessageSourceRow> {
  return createSlotContributionsSource<MessageSourceRow>(
    ctx,
    MESSAGE_SOURCE_SLOT,
    (entry, face) => {
      const id = entry.options.id ?? "";
      if (!id) return null;
      return {
        id,
        order: entry.options.order ?? 0,
        label: resolveSlotLabel(entry.options.label) ?? id,
        ...(typeof face?.resolve === "function" ? { resolve: face.resolve as MessageSourceRow["resolve"] } : {}),
      };
    },
  );
}

/**
 * Folds the contributions into the lookup `<FullScreenChatView
 * messageSourceLabel>` takes. An id nobody registered resolves to
 * `undefined`, which the bubble renders with a localized generic attribution.
 */
export function messageSourceLabelResolver(
  rows: readonly MessageSourceRow[],
): (pluginId: string) => string | undefined {
  const labels = new Map<string, string>();
  for (const row of rows) if (!labels.has(row.id)) labels.set(row.id, row.label);
  return (pluginId: string) => {
    const exact = labels.get(pluginId);
    if (exact !== undefined) return exact;
    for (const row of rows) {
      const label = row.resolve?.(pluginId);
      if (label !== undefined) return label;
    }
    return undefined;
  };
}
