import type { ToolProgress } from "@amiba/app-runtime/core";
import { useT } from "@amiba/i18n";
import { cn } from "../../primitives";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useWorkspacePane } from "../WorkspacePane";
import {
  toolCallBlockFromProgress,
  toolCallBlockName,
} from "./tool-call-block";
import { useToolCallSeat } from "./tool-call-seat";
import { ToolRowFrame } from "./tool-row-frame";
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
  const hasDetail = hasToolDetail(event);
  const opensInWorkspace = workspacePane.canOpenToolEvent(event);

  let durationMs: number | undefined;
  if (!running && typeof event.durationMs === "number") {
    durationMs = event.durationMs;
  } else if (running && typeof event.startedAt === "number") {
    durationMs = Date.now() - event.startedAt;
  }

  return (
    <ToolRowFrame
      icon={presentation.icon}
      action={presentation.action}
      target={
        presentation.target ? (
          <ToolTarget presentation={presentation} running={running} />
        ) : undefined
      }
      {...(durationMs === undefined ? {} : { durationMs })}
      running={running}
      failed={Boolean(event.error)}
      ariaLabel={[presentation.action, presentation.target]
        .filter(Boolean)
        .join(" ")}
      detail={hasDetail ? <ToolDetail event={event} t={t} /> : undefined}
      onOpen={
        opensInWorkspace ? () => workspacePane.openToolEvent(event) : undefined
      }
      title={
        opensInWorkspace ? t("workspacePane.openToolResource") : undefined
      }
      expandTitle={t("sidepanel.trace.expandDetails")}
      collapseTitle={t("sidepanel.trace.collapseDetails")}
    />
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
