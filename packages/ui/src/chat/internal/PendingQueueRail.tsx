import { MessageSquareText, Pencil, Send, X } from "lucide-react";
import { useT } from "@amiba/i18n";

import { ComposerDockIconButton } from "../ComposerDockSheet";

import { cn } from "../../primitives";

/**
 * "Queued for after the current turn" rows inside Composer's context rail.
 * They share the same attached shelf as the conversation workspace instead of
 * introducing a second card above the input. Each row spans the full shelf
 * width and exposes three actions:
 *
 *   - **Send now** — pre-empt the current stream and fire this item.
 *   - **Edit** — hoist it into the composer for editing.
 *   - **Close** — drop the item (and its attachments).
 *
 * Pure presentational: the parent owns the queue state and the three
 * action callbacks. We don't re-export the `PendingChatTurn` shape on
 * purpose — keeping it parent-internal means we can change its fields
 * without touching the rail component.
 */
export interface QueueRailItem {
  queueId: string;
  /** Short preview line for the chip (already truncated by the parent —
   * the chip applies its own visual ellipsis on overflow regardless). */
  preview: string;
}

export interface PendingQueueRailProps {
  items: QueueRailItem[];
  editingQueueId: string | null;
  onSendNow: (queueId: string) => void;
  onEdit: (queueId: string) => void;
  onRemove: (queueId: string) => void;
}

export function PendingQueueRail({
  items,
  editingQueueId,
  onSendNow,
  onEdit,
  onRemove,
}: PendingQueueRailProps) {
  const { t } = useT();
  if (items.length === 0) return null;
  return (
    <ul
      aria-label={t("sidepanel.queue.tooltip")}
      className="flex min-w-0 flex-1 flex-col gap-1"
    >
      {items.map((item) => {
        const isEditing = item.queueId === editingQueueId;
        return (
          <li
            key={item.queueId}
            className={cn(
              "group flex min-h-7 w-full items-center rounded-md text-xs",
              "transition-colors hover:bg-chat-surface-hover",
              isEditing && "text-muted-foreground",
            )}
          >
            <div title={item.preview} className="flex min-w-0 flex-1 items-center gap-1.5 px-0.5 text-foreground/85">
              <MessageSquareText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
              <span className="min-w-0 flex-1 truncate">{item.preview}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <ComposerDockIconButton
                type="button"
                onClick={() => onSendNow(item.queueId)}
                title={t("sidepanel.queue.sendNow")}
                aria-label={t("sidepanel.queue.sendNow.aria")}
              >
                <Send className="h-3.5 w-3.5" />
              </ComposerDockIconButton>
              <ComposerDockIconButton
                onClick={() => onEdit(item.queueId)}
                title={t(isEditing ? "sidepanel.queue.editing" : "sidepanel.queue.edit.aria")}
                aria-label={t("sidepanel.queue.edit.aria")}
                disabled={isEditing}
              >
                <Pencil />
              </ComposerDockIconButton>
              <ComposerDockIconButton
                destructive
                type="button"
                onClick={() => onRemove(item.queueId)}
                title={t("sidepanel.queue.delete")}
                aria-label={t("sidepanel.queue.delete")}
              >
                <X className="h-3.5 w-3.5" />
              </ComposerDockIconButton>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
