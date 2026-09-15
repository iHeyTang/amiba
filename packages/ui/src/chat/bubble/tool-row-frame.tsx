import { useT } from "@amiba/i18n";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../primitives";
import { formatToolDuration } from "../internal/helpers";

/**
 * The GENERIC tool-row look: icon + action + target + duration in one quiet
 * line, with an optional inline detail fold. This is the shared building
 * block behind Amiba's own `ToolChip` rows AND any plugin that takes over a
 * tool's row through the keyed `tool.call.toolview` seat — compose it with
 * your own state logic and evidence body, and the row stays visually
 * indistinguishable from the built-in ones.
 */
export interface ToolRowFrameProps {
  presentation?: "row" | "summary";
  icon: LucideIcon;
  /** The semantic action label (调用工具 / 读取文件 / …). */
  action: string;
  /** Opt in for tool actions; reasoning and interaction labels already own their tense. */
  actionStatus?: "running" | "completed" | "failed";
  /** Optional target/summary shown after the action; string or custom node. */
  target?: ReactNode;
  /** Milliseconds shown as the trailing duration; omit to hide. */
  durationMs?: number;
  /** Live-call styling (pulsing action text). */
  running?: boolean;
  /** Destructive icon tint. Leave false for user-choice outcomes. */
  failed?: boolean;
  ariaLabel?: string;
  /**
   * Inline evidence. When set, clicking the row toggles it open under the
   * fold indent; when absent the row is inert (unless `onOpen` is given).
   */
  detail?: ReactNode;
  /** Optional controlled fold for plugins that load detail on demand. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** External open action (e.g. workspace pane); takes precedence over `detail`. */
  onOpen?: () => void;
  /** Row tooltip while `onOpen` is set (or for an inert row). */
  title?: string;
  expandTitle?: string;
  collapseTitle?: string;
}

export function ToolRowFrame({
  presentation = "row",
  icon: Icon,
  action: baseAction,
  actionStatus,
  target,
  durationMs,
  running = false,
  failed = false,
  ariaLabel,
  detail,
  onOpen,
  title,
  expandTitle,
  collapseTitle,
  expanded: controlledExpanded,
  onExpandedChange,
}: ToolRowFrameProps) {
  const { t } = useT();
  const statusPrefix = actionStatus ? t(`sidepanel.trace.actionStatus.${actionStatus}`) : "";
  const action = statusPrefix + baseAction;
  const accessibleLabel = ariaLabel ? statusPrefix + ariaLabel : undefined;
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = controlledExpanded ?? localExpanded;
  const hasDetail = detail != null;
  const opensExternally = Boolean(onOpen);
  const actionable = opensExternally || hasDetail;
  const durationText =
    typeof durationMs === "number" && (!running || durationMs >= 1000)
      ? formatToolDuration(durationMs)
      : null;

  if (presentation === "summary") return <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
    {action && <span className="shrink-0">{action}</span>}
    {target && <span className="min-w-0 truncate font-mono opacity-75">{target}</span>}
  </span>;

  return (
    <div className="min-w-0">
      <button
        type="button"
        disabled={!actionable}
        onClick={() => {
          if (onOpen) onOpen();
          else if (hasDetail) {
            setLocalExpanded(!expanded);
            onExpandedChange?.(!expanded);
          }
        }}
        aria-expanded={!opensExternally && hasDetail ? expanded : undefined}
        aria-label={accessibleLabel}
        title={
          opensExternally
            ? title
            : hasDetail
              ? expanded
                ? collapseTitle
                : expandTitle
              : (title ?? action)
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
          <Icon
            className={cn(
              "h-3 w-3",
              failed ? "text-destructive/80" : "opacity-55",
            )}
          />
        </span>
        {action && <span
          className={cn(
            "shrink-0 text-foreground/75",
            running && "agent-thinking-text",
          )}
        >
          {action}
        </span>}
        {typeof target === "string" ? (
          <span
            className={cn(
              "min-w-0 max-w-56 truncate font-mono text-foreground/65",
              running && "agent-thinking-text",
            )}
          >
            {target}
          </span>
        ) : (
          target
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
              !opensExternally && expanded && "rotate-90",
            )}
          />
        ) : null}
      </button>
      {!opensExternally && expanded && hasDetail && (
        <div className="ml-[7px] border-l border-border/60 pb-1.5 pl-4 pr-1">
          {detail}
        </div>
      )}
    </div>
  );
}
