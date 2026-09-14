import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import type { CommandRowOwner } from "@amiba/extension-sdk";
import type { ConversationSnapshot } from "./conversation-snapshot.js";
import type { ObservableSnapshot } from "@deepseek-ai/dsh-client-store";

/** Use the official Chat projection, including its explicit compaction correlation. */
export function commandRowOwners(snapshot: Pick<ConversationSnapshot, "chat"> | undefined): { id: string; seq: number; owner: CommandRowOwner }[] {
  if (!snapshot) return [];
  return snapshot.chat.order.flatMap(key => {
    const node = snapshot.chat.nodes.get(key);
    if (!node || node.visibility !== "visible") return [];
    if (node.kind === "command") {
      return [{ id: node.key, seq: node.anchorSeq, owner: { node: node.data as CommandRowOwner["node"] } }];
    }
    if (node.kind === "manual-compaction") {
      const data = node.data as import("@deepseek-ai/dsh-client-ui-chat/client").ManualCompactionChatData;
      return [{ id: node.key, seq: node.anchorSeq, owner: { node: data.command, ...(data.compaction ? { compaction: data.compaction } : {}) } }];
    }
    return [];
  });
}

export function useCommandRows(source: ObservableSnapshot<ConversationSnapshot | undefined> | undefined,
  render: (owner: CommandRowOwner) => ReactNode, keys: ObservableSnapshot<readonly string[]>) {
  const subscribe = useCallback((fn: () => void) => source?.subscribe(fn) ?? (() => {}), [source]);
  const read = useCallback(() => source?.getSnapshot(), [source]);
  const snapshot = useSyncExternalStore(subscribe, read, read);
  const registered = useSyncExternalStore(keys.subscribe, keys.getSnapshot, keys.getSnapshot);
  return commandRowOwners(snapshot).filter(row => registered.includes(row.owner.node.name ?? "")).map(row => ({
    id: row.id, seq: row.seq, content: render(row.owner),
    replaceMessageId: `dsh:command:${row.owner.node.commandId}:result`,
  }));
}
