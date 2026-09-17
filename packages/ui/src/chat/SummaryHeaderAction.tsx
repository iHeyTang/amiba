import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { LayoutGrid } from "lucide-react";
import { useT } from "@amiba/i18n";
import type { WorkbenchSummaryContribution } from "@amiba/extension-sdk";
import { useWorkspacePane } from "./WorkspacePane";

/**
 * The pinned summary is a floating stack of cards in the top-right, docked to
 * the window's right edge below the header. It never participates in the main
 * row's flex width; a header action (registered beside the transcript) toggles
 * it. Cards own their chrome — a live preview card is borderless, a text-only
 * card draws its own bordered container — so the shell adds no outer frame.
 */

const SUMMARY_CARD_WIDTH = 280;
const SUMMARY_RIGHT_GUTTER = 8;

const SummaryContributionsContext = createContext<
  readonly WorkbenchSummaryContribution[]
>([]);

/** Hosts the `amiba.workbench.summary` ledger for the header-action summary. */
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

/** The header icon that opens the pinned summary. */
export function SummaryHeaderAction({ sessionId }: { sessionId: string }) {
  const pane = useWorkspacePane();
  const contributions = useSummaryContributions();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [geometry, setGeometry] = useState({ top: 0, right: SUMMARY_RIGHT_GUTTER });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Auto-reveal on new activity; closing while the same attention is pending
  // keeps it closed until the next activity (opening the workbench clears it).
  useEffect(() => {
    if (pane.attention) setOpen(true);
  }, [pane.attention]);

  // Anchor the panel to the conversation column's right edge (not the window),
  // so it follows the chat flow left when the sidebar or workbench resizes it.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const chatColumn = trigger.closest(
      ".amiba-chat-column",
    ) as HTMLElement | null;
    const measure = () => {
      const triggerRect = trigger.getBoundingClientRect();
      const columnRight = chatColumn
        ? chatColumn.getBoundingClientRect().right
        : window.innerWidth;
      setGeometry({
        top: triggerRect.bottom + 6,
        right: Math.max(
          SUMMARY_RIGHT_GUTTER,
          window.innerWidth - columnRight + SUMMARY_RIGHT_GUTTER,
        ),
      });
    };
    measure();
    const observer = chatColumn ? new ResizeObserver(measure) : null;
    if (chatColumn) observer?.observe(chatColumn);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  // Outside-click dismiss (the trigger itself is excluded so its own onClick
  // toggles cleanly).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Escape dismiss.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!pane.enabled || pane.sessionId !== sessionId) return null;

  const panel = (
    <div
      ref={panelRef}
      data-summary-panel
      className="fixed flex flex-col gap-2"
      style={{
        right: geometry.right,
        top: geometry.top,
        width: SUMMARY_CARD_WIDTH,
        maxHeight: "calc(100vh - 24px)",
        overflowY: "auto",
        zIndex: 60,
      }}
    >
      {contributions.length > 0 ? (
        contributions.map((contribution) => {
          const Component = contribution.component;
          return <Component key={contribution.id} sessionId={pane.sessionId} />;
        })
      ) : (
        <div className="rounded-xl border border-border/60 bg-popover p-3 text-xs text-muted-foreground shadow-popover">
          {t("summary.empty")}
        </div>
      )}
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={t("summary.title")}
        aria-label={t("summary.title")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LayoutGrid className="size-3.5" aria-hidden="true" />
        {pane.attention && (
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />
        )}
      </button>
      {open && createPortal(panel, document.body)}
    </>
  );
}
