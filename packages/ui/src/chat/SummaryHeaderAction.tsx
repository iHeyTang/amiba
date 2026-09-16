import { createContext, useContext, type ReactNode } from "react";
import { Activity, LayoutGrid } from "lucide-react";
import { useT } from "@amiba/i18n";
import type { WorkbenchSummaryContribution } from "@amiba/extension-sdk";
import { Popover, PopoverContent, PopoverTrigger } from "../primitives";
import { useWorkspacePane } from "./WorkspacePane";

/**
 * The pinned summary is a POPOVER, not a layout rail: it floats over the
 * conversation and never participates in the main row's flex width. A header
 * action (registered in `conversation.session.header.actions`, beside the
 * transcript) opens it; its right edge aligns to that icon.
 */

const SummaryContributionsContext = createContext<
  readonly WorkbenchSummaryContribution[]
>([]);

/** Hosts the `amiba.workbench.summary` ledger for the header-action popover. */
export function SummaryContributionsProvider({
  contributions,
  children,
}: {
  contributions: readonly WorkbenchSummaryContribution[];
  children: ReactNode;
}) {
  return (
    <SummaryContributionsContext.Provider value={contributions}>
      {children}
    </SummaryContributionsContext.Provider>
  );
}

export function useSummaryContributions(): readonly WorkbenchSummaryContribution[] {
  return useContext(SummaryContributionsContext);
}

/** The header icon that opens the pinned summary popover. */
export function SummaryHeaderAction({ sessionId }: { sessionId: string }) {
  const pane = useWorkspacePane();
  const contributions = useSummaryContributions();
  const { t } = useT();
  if (!pane.enabled || pane.sessionId !== sessionId) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t("summary.title")}
          aria-label={t("summary.title")}
          className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LayoutGrid className="size-3.5" aria-hidden="true" />
          {pane.attention && (
            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} size="sm" padding="none">
        <div className="flex flex-col gap-2 p-3">
          {contributions.length > 0
            ? contributions.map((contribution) => {
                const Component = contribution.component;
                return (
                  <Component key={contribution.id} sessionId={pane.sessionId} />
                );
              })
            : <FallbackSummary />}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FallbackSummary() {
  const pane = useWorkspacePane();
  const { t } = useT();
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-md border border-border/60 p-3">
        <div className="flex items-center gap-2 text-xs">
          <Activity className="size-3.5 shrink-0 text-muted-foreground" />
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
