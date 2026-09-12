import { useEffect, useId, useState, type ReactNode } from "react";
import { cn } from "../primitives";

export interface ConversationViewEntry {
  id: string;
  label: string;
}

/** Keep the native chat mounted and its DOM unchanged when no view is contributed. */
export function ConversationViewRegion({
  sessionId,
  entries,
  renderView,
  chatLabel,
  children,
}: {
  sessionId?: string | null;
  entries: readonly ConversationViewEntry[];
  renderView?: (id: string) => ReactNode;
  chatLabel: string;
  children: ReactNode;
}) {
  const prefix = useId();
  const [selection, setSelection] = useState<{
    sessionId: string;
    id: string;
  } | null>(null);
  const views = sessionId && renderView ? entries : [];
  const current =
    selection !== null &&
    selection.sessionId === sessionId &&
    views.some((view) => view.id === selection.id)
      ? selection.id
      : null;
  useEffect(() => {
    if (selection && current === null) setSelection(null);
  }, [selection, current]);
  const rows = [{ id: null, label: chatLabel }, ...views];
  const index = rows.findIndex((row) => row.id === current);
  const select = (id: string | null) =>
    setSelection(id !== null && sessionId ? { sessionId, id } : null);
  return (
    <>
      {views.length > 0 && (
        <div
          role="tablist"
          aria-label={chatLabel}
          className="mx-3 my-2 inline-flex h-9 w-fit max-w-full shrink-0 items-center overflow-x-auto rounded-lg bg-muted p-1 text-muted-foreground"
          onKeyDown={(event) => {
            const next =
              event.key === "ArrowRight"
                ? (index + 1) % rows.length
                : event.key === "ArrowLeft"
                  ? (index + rows.length - 1) % rows.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? rows.length - 1
                      : -1;
            if (next < 0) return;
            event.preventDefault();
            select(rows[next].id);
            event.currentTarget
              .querySelectorAll<HTMLButtonElement>('[role="tab"]')
              [next]?.focus();
          }}
        >
          {rows.map((row, position) => (
            <button
              key={row.id === null ? "native" : `plugin:${row.id}`}
              type="button"
              role="tab"
              id={`${prefix}-tab-${position}`}
              aria-controls={`${prefix}-panel-${position}`}
              aria-selected={index === position}
              tabIndex={index === position ? 0 : -1}
              onClick={() => select(row.id)}
              className={cn(
                "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                index === position && "bg-background text-foreground shadow",
              )}
            >
              {row.label}
            </button>
          ))}
        </div>
      )}
      <main
        key="native-chat"
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          current !== null && "hidden",
        )}
        hidden={current !== null || undefined}
        tabIndex={views.length ? 0 : undefined}
        role={views.length ? "tabpanel" : undefined}
        id={views.length ? `${prefix}-panel-0` : undefined}
        aria-labelledby={views.length ? `${prefix}-tab-0` : undefined}
      >
        {children}
      </main>
      {views.map((view, position) => (
        <div
          key={`view:${view.id}`}
          role="tabpanel"
          id={`${prefix}-panel-${position + 1}`}
          aria-labelledby={`${prefix}-tab-${position + 1}`}
          tabIndex={0}
          className={cn(
            "min-h-0 min-w-0 flex-1 overflow-auto",
            current !== view.id && "hidden",
          )}
          hidden={current !== view.id}
        >
          {current === view.id ? renderView?.(view.id) : null}
        </div>
      ))}
    </>
  );
}
