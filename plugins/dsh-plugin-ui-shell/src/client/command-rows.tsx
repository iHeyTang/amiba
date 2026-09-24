import type { ReactNode } from "react";
import type { CommandRowOwner } from "@amiba/extension-sdk";
import type { ConversationSnapshot } from "./conversation-snapshot.js";

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

/**
 * The registered command rows to interleave into the conversation timeline.
 *
 * Pure on purpose: callers own the subscription. Deriving these in the window
 * shell subscribed it to a projection that publishes on every streamed frame,
 * so the shell — and with it the whole window — re-rendered per frame. The
 * conversation pane reads them instead (see `createConversationRowsSource`),
 * which is where the stream-rate reads belong.
 */
export function commandTimelineRows(
  snapshot: Pick<ConversationSnapshot, "chat"> | undefined,
  registered: readonly string[],
  render: (owner: CommandRowOwner) => ReactNode,
): { id: string; seq: number; content: ReactNode; replaceMessageId?: string }[] {
  const inputs = snapshot ? snapshot.chat.order.flatMap(key => {
    const node = snapshot.chat.nodes.get(key);
    if (node?.kind !== "command-input" || node.visibility !== "visible") return [];
    const data = node.data as { text?: unknown };
    if (typeof data.text !== "string") return [];
    return [{ id: node.key, seq: node.anchorSeq, content: <div className="flex justify-end"><div className="max-w-[82%] whitespace-pre-wrap break-words rounded-2xl bg-muted px-4 py-2 text-sm">{data.text}</div></div> }];
  }) : [];
  return [...inputs, ...commandRowOwners(snapshot)
    .filter(row => registered.includes(row.owner.node.name ?? ""))
    .map(row => ({
      id: row.id,
      seq: row.seq,
      content: render(row.owner),
      replaceMessageId: `dsh:command:${row.owner.node.commandId}:result`,
    }))];
}
