import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { LayoutGrid } from "lucide-react";
import { useT } from "@amiba/i18n";
import type { WorkbenchSummaryContribution } from "@amiba/extension-sdk";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "../primitives";
import { useWorkspacePane } from "./WorkspacePane";

/**
 * The pinned summary is a POPOVER, not a layout rail: it floats over the
 * conversation and never participates in the main row's flex width. A header
 * action (registered in `conversation.session.header.actions`, beside the
 * transcript) opens it; it docks to the conversation's right edge.
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
  const [open, setOpen] = useState(false);
  // Auto-reveal on new activity so the summary surfaces what just happened.
  // Closing it while the same attention is still pending keeps it closed until
  // the next activity; opening the workbench clears the attention itself.
  useEffect(() => {
    if (pane.attention) setOpen(true);
  }, [pane.attention]);
  if (!pane.enabled || pane.sessionId !== sessionId) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Anchor the panel to the window's right edge (not the icon) so it is
          flush with the conversation side. */}
      <PopoverAnchor asChild>
        <div
          className="pointer-events-none fixed h-px w-px"
          style={{
            right: 8,
            top: "calc(var(--amiba-header-height, 40px) + 4px)",
          }}
        />
      </PopoverAnchor>
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
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={4}
        size="md"
        padding="none"
      >
        <div className="flex flex-col gap-4 p-3">
          {contributions.length > 0 ? (
            contributions.map((contribution) => {
              const Component = contribution.component;
              return (
                <section
                  key={contribution.id}
                  className="flex flex-col gap-1.5"
                >
                  <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {contribution.label()}
                  </h3>
                  <Component sessionId={pane.sessionId} />
                </section>
              );
            })
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("summary.empty")}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
