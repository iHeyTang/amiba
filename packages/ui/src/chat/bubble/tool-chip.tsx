import { useNestedToolCalls, useNestedToolExpansion } from "./nested-tool-calls";
import type { ToolCallOwnerProps } from "@amiba/extension-sdk";
import { useToolImageEvidence } from "./tool-image-evidence";
import type { ToolProgress } from "@amiba/app-runtime/core";
import { useT } from "@amiba/i18n";
import { cn } from "../../primitives";
import { useCallback, useEffect, useMemo, useState, useRef, useSyncExternalStore } from "react";

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
  return (
    <span
      className={cn(
        "min-w-0 max-w-56 truncate font-mono text-foreground/65",
        running && "agent-thinking-text",
      )}
    >
      {presentation.target}
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
function ToolChipRow({ event, mode, owner }: { event: ToolProgress; mode?: "row" | "summary"; owner?: ToolCallOwnerProps }) {
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
  const imageBlock = useMemo(() => toolCallBlockFromProgress(event), [event]);
  const images = useToolImageEvidence(event.toolCallId, imageBlock);
  const nested = useNestedToolCalls(owner);
  const expansion = useNestedToolExpansion(imageBlock);
  const opensInWorkspace = workspacePane.canOpenToolEvent(event);

  let durationMs: number | undefined;
  if (!running && typeof event.durationMs === "number") {
    durationMs = event.durationMs;
  } else if (running && typeof event.startedAt === "number") {
    durationMs = Date.now() - event.startedAt;
  }

  return (
    <ToolRowFrame
      {...expansion}
      presentation={mode}
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
      detail={hasDetail || images || nested ? <>{hasDetail ? <ToolDetail event={event} t={t} /> : null}{images}{nested}</> : undefined}
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
const emptySubscribe = () => () => {};
const idleRequest = {callId:"",version:0};
const emptyRequest = () => idleRequest;
export function ToolChip({ event, mode = "row" }: { event: ToolProgress; mode?: "row" | "summary" }) {
  const seat = useToolCallSeat();
  const navigation = seat?.navigation;
  const request = useSyncExternalStore(navigation?.subscribe ?? emptySubscribe, navigation?.getSnapshot ?? emptyRequest);
  const ref = useRef<HTMLDivElement>(null);
  const revealVersion = request.callId === event.toolCallId ? request.version : 0;
  useEffect(()=>{ if (mode === "row" && revealVersion) ref.current?.scrollIntoView?.({block:"center",behavior:"smooth"}); },[revealVersion, mode]);
  const workspacePane = useWorkspacePane();
  const openFile = useCallback(
    (path: string) => workspacePane.openFile(path),
    [workspacePane],
  );
  const block = useMemo(() => toolCallBlockFromProgress(event), [event]);
  // The shell adds `inspect` only when a contributed trajectory view can
  // receive the call. This runtime-neutral row cannot promise that surface.
  const owner = useMemo(
    () =>
      block
        ? {
            presentation: mode,
            revealToolCall: navigation?.reveal,
            revealVersion,
            callId: event.toolCallId,
            toolName: toolCallBlockName(block),
            block,
            ...(seat?.cwd ? { cwd: seat.cwd } : {}),
            openFile,
          }
        : null,
    [block, event.toolCallId, openFile, seat?.cwd, mode, navigation, revealVersion],
  );

  const fallback = <ToolChipRow event={event} mode={mode} owner={owner ?? undefined} />;
  const row = seat?.render && owner ? seat.render({ owner, fallback }) : fallback;
  if (mode === "summary") return <>{row}</>;
  return <div ref={ref}>{row}{seat?.activity?.({ callId: event.toolCallId })}</div>;
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
