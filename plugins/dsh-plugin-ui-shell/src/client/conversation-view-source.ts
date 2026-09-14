import { resolveSlotLabel } from "@deepseek-ai/dsh-client-ui-slots";
import type {
  ContributionsSource,
  SlotContributionsCtx,
} from "./session-list-sources.js";

export interface ConversationViewEntry {
  id: string;
  label: string;
}

/** Read registration metadata only: never invoke session-scoped inject factories here. */
export function createConversationViewSource(
  slots: SlotContributionsCtx,
): ContributionsSource<ConversationViewEntry> {
  let version = -1;
  let language = "";
  let snapshot: readonly ConversationViewEntry[] = [];
  return {
    getSnapshot() {
      const next = slots.getVersion("conversation.view");
      const lang =
        typeof document === "undefined" ? "" : document.documentElement.lang;
      if (version !== next || language !== lang) {
        version = next;
        language = lang;
        snapshot = slots
          .entriesOfSlot("conversation.view")
          .slice()
          .sort((a, b) => (a.options.order ?? 0) - (b.options.order ?? 0))
          .flatMap((entry) =>
            entry.options.id === undefined
              ? []
              : [
                  {
                    id: entry.options.id,
                    label:
                      resolveSlotLabel(entry.options.label) ?? entry.options.id,
                  },
                ],
          );
      }
      return snapshot;
    },
    subscribe(listener) {
      const off = slots.subscribe("conversation.view", listener);
      const observer =
        typeof MutationObserver === "undefined"
          ? undefined
          : new MutationObserver(listener);
      if (typeof document !== "undefined")
        observer?.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["lang"],
        });
      return () => {
        off();
        observer?.disconnect();
      };
    },
  };
}
