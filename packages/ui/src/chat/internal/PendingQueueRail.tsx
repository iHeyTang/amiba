import { Pencil, Send, Trash2 } from "lucide-react";
import { useT } from "@amiba/i18n";

import { cn } from "../../primitives";

/**
 * The horizontal strip of "queued for after current turn" chips that
 * sits above the composer when one or more messages were entered while
 * the engine was streaming. Each chip exposes three actions:
 *
 *   - **Send now** — pre-empt the current stream and fire this item.
 *   - **Edit** — hoist the item's text + attachments into the composer
 *     for in-place editing; Send commits the edit and fires.
 *   - **Delete** — drop the item (and its attachments).
 *
 * Pure presentational: the parent owns the queue state and the three
 * action callbacks. We don't re-export the `PendingChatTurn` shape on
 * purpose — keeping it parent-internal means we can change its fields
 * without touching the chip-row component.
 *
 * Layout note: this row renders with `rounded-t-lg border-b-0` so it
 * visually merges with the composer's flat top (the composer is told
 * to drop its top corner radius via `flatTop`). Treat the two as a
 * single bordered card.
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
  /** True iff the composer is in folder/file drag-over state — used to
   * tint the rail's outer border so the queue row reads as part of the
   * drop target. */
  composerDragOver?: boolean;
  onSendNow: (queueId: string) => void;
  onEdit: (queueId: string) => void;
  onRemove: (queueId: string) => void;
}

export function PendingQueueRail({
  items,
  editingQueueId,
  composerDragOver = false,
  onSendNow,
  onEdit,
  onRemove,
}: PendingQueueRailProps) {
  const { t } = useT();
  if (items.length === 0) return null;
  return (
    <div
      className={cn(
        "relative z-[1] overflow-hidden rounded-t-lg border border-input border-b-0 bg-muted/50 shadow-[0_-2px_10px_-2px_rgba(0,0,0,0.12)] dark:bg-muted/35 dark:shadow-[0_-2px_14px_-2px_rgba(0,0,0,0.45)]",
        composerDragOver && "border-primary/50",
      )}
    >
      <ul className="max-h-[7rem] divide-y divide-border/60 overflow-y-auto">
        {items.map((item) => {
          const isEditing = item.queueId === editingQueueId;
          return (
            <li
              key={item.queueId}
              className="group flex items-center gap-1.5 py-1.5 pl-2.5 pr-1 transition-colors hover:bg-muted/70"
            >
              <p
                className={cn(
                  "min-w-0 flex-1 truncate text-[12px] leading-snug",
                  isEditing
                    ? "text-muted-foreground"
                    : "text-foreground/90",
                )}
                title={
                  isEditing ? t("sidepanel.queue.editing") : item.preview
                }
              >
                {item.preview}
              </p>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => onSendNow(item.queueId)}
                  title={t("sidepanel.queue.sendNow")}
                  aria-label={t("sidepanel.queue.sendNow.aria")}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(item.queueId)}
                  title={t("sidepanel.queue.edit")}
                  aria-label={t("sidepanel.queue.edit.aria")}
                  disabled={isEditing}
                  className={cn(
                    "rounded p-1 transition-colors",
                    isEditing
                      ? "cursor-default text-foreground/40"
                      : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
                  )}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(item.queueId)}
                  title={t("sidepanel.queue.delete")}
                  aria-label={t("sidepanel.queue.delete")}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
