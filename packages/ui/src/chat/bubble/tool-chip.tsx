import type { ToolProgress } from "@amiba/app-runtime/core";
import { useT } from "@amiba/i18n";
import { cn } from "../../primitives";
import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { formatToolDuration } from "../internal/helpers";
import { useWorkspacePane } from "../WorkspacePane";
import {
  toolCallBlockFromProgress,
  toolCallBlockName,
} from "./tool-call-block";
import { useToolCallSeat } from "./tool-call-seat";
import {
  describeToolCall,
  hasToolDetail,
  type ToolCallPresentation,
  ToolDetail,
} from "./tool-presentation";

function ToolTarget({
  presentation,
  running,
}: {
  presentation: ToolCallPresentation;
  running: boolean;
}) {
  const textClass = cn(
    "font-mono text-foreground/65",
    running && "agent-thinking-text",
  );
  if (presentation.kind !== "read-file" && presentation.kind !== "write-file") {
    return (
      <span className={cn("min-w-0 max-w-56 truncate", textClass)}>
        {presentation.target}
      </span>
    );
  }

  const [path, ...metaParts] = presentation.target.split(" · ");
  const separator = path.lastIndexOf("/");
  const parent = separator >= 0 ? path.slice(0, separator) : "";
  const name = separator >= 0 ? path.slice(separator + 1) : path;
  const meta = metaParts.join(" · ");

  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-60 items-center overflow-hidden",
        textClass,
      )}
    >
      {parent && <span className="min-w-0 truncate">{parent}/</span>}
      <span className="shrink-0">{name}</span>
      {meta && (
        <span className="ml-2 shrink-0 tabular-nums text-muted-foreground/75">
          {meta}
        </span>
      )}
    </span>
  );
}

/**
 * One quiet execution row. The conversation exposes the semantic action and
 * its target; only calls with useful evidence can be opened.
 *
 * Amiba's OWN row, driven by the closed `ToolSpec` table. It is also the
 * `fallback` of the official `tool.call.toolview` dispatch in
 * {@link ToolChip}, so an unclaimed tool name renders exactly this and
 * nothing else.
 */
function ToolChipRow({ event }: { event: ToolProgress }) {
  const { t } = useT();
  const workspacePane = useWorkspacePane();
  const [expanded, setExpanded] = useState(false);
  // Force a re-render every second while running so the duration ticks
  // live. Once `completed` arrives the chip re-renders with `durationMs`
  // and this effect tears down.
  const [tick, setTick] = useState(0);
  const running = event.status === "running";
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  void tick;

  const presentation = describeToolCall(event, t);
  const ToolIcon = presentation.icon;
  const hasDetail = hasToolDetail(event);
  const opensInWorkspace = workspacePane.canOpenToolEvent(event);
  const actionable = opensInWorkspace || hasDetail;

  let durationText: string | null = null;
  if (!running && typeof event.durationMs === "number") {
    durationText = formatToolDuration(event.durationMs);
  } else if (running && typeof event.startedAt === "number") {
    const elapsed = Date.now() - event.startedAt;
    if (elapsed >= 1000) durationText = formatToolDuration(elapsed);
  }

  const detailAction = expanded
    ? t("sidepanel.trace.collapseDetails")
    : t("sidepanel.trace.expandDetails");

  return (
    <div className="min-w-0">
      <button
        type="button"
        disabled={!actionable}
        onClick={() => {
          if (opensInWorkspace) {
            workspacePane.openToolEvent(event);
          } else if (hasDetail) {
            setExpanded((v) => !v);
          }
        }}
        aria-expanded={!opensInWorkspace && hasDetail ? expanded : undefined}
        aria-label={[presentation.action, presentation.target]
          .filter(Boolean)
          .join(" ")}
        title={
          opensInWorkspace
            ? t("workspacePane.openToolResource")
            : hasDetail
              ? detailAction
              : presentation.action
        }
        className={cn(
          "group/tool inline-flex min-h-7 max-w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-[11px] text-muted-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          actionable
            ? "cursor-pointer hover:bg-muted/45 hover:text-foreground"
            : "cursor-default",
          running && "text-foreground/75",
        )}
      >
        <span
          aria-hidden
          className="inline-flex h-3 w-3 shrink-0 items-center justify-center leading-none"
        >
          <ToolIcon
            className={cn(
              "h-3 w-3",
              event.error && !presentation.quietFailure
                ? "text-destructive/80"
                : "opacity-55",
            )}
          />
        </span>
        <span
          className={cn(
            "shrink-0 text-foreground/75",
            running && "agent-thinking-text",
          )}
        >
          {presentation.action}
        </span>
        {presentation.target && (
          <ToolTarget presentation={presentation} running={running} />
        )}
        {durationText && (
          <span className="shrink-0 tabular-nums text-muted-foreground/65">
            {durationText}
          </span>
        )}
        {actionable ? (
          <ChevronRight
            aria-hidden
            className={cn(
              "h-3 w-3 shrink-0 opacity-45 transition-transform group-hover/tool:opacity-70",
              !opensInWorkspace && expanded && "rotate-90",
            )}
          />
        ) : null}
      </button>
      {!opensInWorkspace && expanded && hasDetail && (
        <div className="ml-[7px] border-l border-border/60 pb-1.5 pl-4 pr-1">
          <ToolDetail event={event} t={t} />
        </div>
      )}
    </div>
  );
}

/**
 * One tool call row, dispatched through the official keyed
 * `tool.call.toolview` seat when the host provides one.
 *
 * The seat is keyed by the WIRE TOOL NAME, so a plugin registering `"bash"`
 * owns how bash calls render and changes nothing else. With no host renderer
 * (Quick-Ask, any surface outside a DSH plugin runtime) — or with no retained
 * wire material to build a faithful `block` from — this renders
 * {@link ToolChipRow} directly, which is also what the host's dispatch falls
 * back to for every unclaimed name.
 */
export function ToolChip({ event }: { event: ToolProgress }) {
  const seat = useToolCallSeat();
  const workspacePane = useWorkspacePane();
  const openFile = useCallback(
    (path: string) => workspacePane.openFile(path),
    [workspacePane],
  );
  const block = useMemo(() => toolCallBlockFromProgress(event), [event]);
  // `inspect` is deliberately absent from the owner share: it means "inspect
  // this call in the trajectory view", and Amiba runs no trajectory surface.
  // The member is optional, so omitting it is the honest supply.
  const owner = useMemo(
    () =>
      block
        ? {
            callId: event.toolCallId,
            toolName: toolCallBlockName(block),
            block,
            ...(seat?.cwd ? { cwd: seat.cwd } : {}),
            openFile,
          }
        : null,
    [block, event.toolCallId, openFile, seat?.cwd],
  );

  const fallback = <ToolChipRow event={event} />;
  if (!seat || !owner) return fallback;
  return seat.render({ owner, fallback });
}

/** Stack-of-chips fallback for messages without an interleaved timeline. */
export function ToolProgressChips({
  events,
}: {
  events: ToolProgress[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {events.map((ev) => (
        <ToolChip key={ev.toolCallId} event={ev} />
      ))}
    </div>
  );
}
