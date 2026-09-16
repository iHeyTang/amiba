import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Activity, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useT } from "@amiba/i18n";
import type { WorkbenchSummaryContribution } from "@amiba/extension-sdk";
import {
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../primitives";
import { useWorkspacePane } from "./WorkspacePane";

/** Below the header's edge-control row, above ordinary chat content. */
const SUMMARY_Z = "z-40";
const RAIL_WIDTH_PX = 300;
const STRIP_WIDTH_PX = 40;
/** The chat column is "narrow" below this width; the rail then defers to a popover. */
const NARROW_THRESHOLD_PX = 640;

/**
 * The pinned summary panel — a floating right-edge rail that summarizes the
 * workspace (browser tabs, background jobs, …) WITHOUT squeezing the chat
 * column. It is anchored to the conversation column, so when the workbench
 * expands and narrows the column it moves left with it.
 *
 * It is deliberately NOT part of the workbench: it floats over the chat
 * content and never participates in the flex width of the main row. Two
 * presentation modes, driven by the conversation column's width:
 *   • wide   → a persistent rail (default expanded) with a header toggle;
 *   • narrow → a slim icon strip whose toggle opens a popover instead.
 */
export function SummaryPanel({
  contributions,
  topOffsetPx = 40,
}: {
  contributions: readonly WorkbenchSummaryContribution[];
  topOffsetPx?: number;
}) {
  const pane = useWorkspacePane();
  const { t } = useT();
  const [collapsed, setCollapsed] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  // Anchor to the conversation column: our `offsetParent` is the chat column
  // (`relative`), whose width shrinks when the workbench opens.
  useLayoutEffect(() => {
    const parent = anchorRef.current?.parentElement;
    if (!parent) return;
    const measure = () =>
      setNarrow(parent.getBoundingClientRect().width < NARROW_THRESHOLD_PX);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  const hasActivity = pane.attention || pane.tabs.length > 0;
  // A new automatic arrival re-reveals the rail so the activity is not missed.
  useEffect(() => {
    if (pane.attention) setCollapsed(false);
  }, [pane.attention]);

  if (!pane.enabled || !hasActivity) return null;

  const expanded = !narrow && !collapsed;

  const list = (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {contributions.length > 0 ? (
        contributions.map((contribution) => {
          const Component = contribution.component;
          return <Component key={contribution.id} sessionId={pane.sessionId} />;
        })
      ) : (
        <FallbackSummary />
      )}
    </div>
  );

  const toggleButton = (
    <button
      type="button"
      onClick={() => {
        if (narrow) setPopoverOpen((open) => !open);
        else setCollapsed((collapsed) => !collapsed);
      }}
      title={t(expanded ? "summary.collapse" : "summary.expand")}
      aria-label={t(expanded ? "summary.collapse" : "summary.expand")}
      aria-pressed={expanded}
      className={cn(
        "relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        expanded && "bg-foreground/5 text-foreground",
      )}
    >
      {expanded ? (
        <PanelRightClose className="h-3.5 w-3.5" />
      ) : (
        <PanelRightOpen className="h-3.5 w-3.5" />
      )}
      {pane.attention && (
        <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />
      )}
    </button>
  );

  return (
    <div
      ref={anchorRef}
      data-summary-panel
      className={cn("pointer-events-none absolute right-0", SUMMARY_Z)}
      style={{ top: topOffsetPx, bottom: 0 }}
    >
      <div
        className={cn(
          "pointer-events-auto flex h-full flex-col border-l border-border/40 bg-background shadow-lg transition-[width] duration-200 ease-out",
          expanded ? "w-[300px]" : "w-10",
        )}
        style={{ width: expanded ? RAIL_WIDTH_PX : STRIP_WIDTH_PX }}
      >
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border/40 px-1.5">
          {expanded && (
            <span className="min-w-0 flex-1 truncate pl-1 text-xs font-medium">
              {t("summary.title")}
            </span>
          )}
          {narrow ? (
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>{toggleButton}</PopoverTrigger>
              <PopoverContent align="end" size="compact" className="w-72">
                {list}
              </PopoverContent>
            </Popover>
          ) : (
            toggleButton
          )}
        </div>
        {expanded ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-3">{list}</div>
        ) : null}
      </div>
    </div>
  );
}

function FallbackSummary() {
  const pane = useWorkspacePane();
  const { t } = useT();
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-md border border-border/60 p-3">
        <div className="flex items-center gap-2 text-xs">
          <Activity className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium">
            {t("summary.tabsCount", { count: pane.tabs.length })}
          </span>
        </div>
        {pane.attention && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("summary.newActivity")}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            pane.setOpen(true);
            pane.clearAttention();
          }}
          className="mt-2 text-[11px] font-medium text-primary hover:underline focus:outline-none"
        >
          {t("summary.openWorkbench")}
        </button>
      </div>
      {pane.tabs.length === 0 && (
        <p className="px-1 text-[11px] text-muted-foreground/70">
          {t("summary.empty")}
        </p>
      )}
    </div>
  );
}
