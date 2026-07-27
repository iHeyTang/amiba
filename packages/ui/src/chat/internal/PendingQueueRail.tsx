import { MessageSquareText, Send, X } from "lucide-react";
import { useT } from "@amiba/i18n";

import { cn } from "../../primitives";

/**
 * "Queued for after the current turn" tabs inside Composer's context rail.
 * They share the same attached shelf as the conversation workspace instead of
 * introducing a second card above the input. Each tab exposes three actions:
 *
 *   - **Send now** — pre-empt the current stream and fire this item.
 *   - **Click the preview** — hoist it into the composer for editing.
 *   - **Close** — drop the item (and its attachments).
 *
 * Pure presentational: the parent owns the queue state and the three
 * action callbacks. We don't re-export the `PendingChatTurn` shape on
 * purpose — keeping it parent-internal means we can change its fields
 * without touching the chip-row component.
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
      className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => {
        const isEditing = item.queueId === editingQueueId;
        return (
          <li
            key={item.queueId}
            className={cn(
              "group flex h-6 w-fit max-w-64 shrink-0 items-center rounded-md bg-background/55 pl-1.5 pr-0.5 text-[11px]",
              "transition-colors hover:bg-background/85",
              isEditing && "text-muted-foreground",
            )}
          >
            <button
              type="button"
              onClick={() => onEdit(item.queueId)}
              disabled={isEditing}
              title={
                isEditing ? t("sidepanel.queue.editing") : item.preview
              }
              aria-label={t("sidepanel.queue.edit.aria")}
              className={cn(
                "flex min-w-0 items-center gap-1.5 rounded px-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                isEditing ? "cursor-default" : "text-foreground/85",
              )}
            >
              <MessageSquareText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
              <span className="max-w-40 truncate">
                {item.preview}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onSendNow(item.queueId)}
              title={t("sidepanel.queue.sendNow")}
              aria-label={t("sidepanel.queue.sendNow.aria")}
              className="ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/55 transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <Send className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => onRemove(item.queueId)}
              title={t("sidepanel.queue.delete")}
              aria-label={t("sidepanel.queue.delete")}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/40 transition-colors hover:bg-destructive/5 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <X className="h-3 w-3" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
