import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "../primitives";

/** Compact operations share one geometry across every toaster region. */
export function ComposerDockIconButton({ className, destructive = false, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { destructive?: boolean }) {
  return <button type="button" {...props} data-composer-dock-action=""
    data-destructive={destructive || undefined}
    className={cn("amiba-dock-icon-button", className)} />;
}

/** Ordered destinations keep plugin registration order out of the visual and reading order. */
const REGIONS = ["context", "queue", "interaction", "feedback"] as const;
export type ComposerDockRegion = typeof REGIONS[number];
type Targets = Record<ComposerDockRegion, HTMLDivElement | null>;
const ToasterContext = createContext<{ targets: Targets; registerInteraction: () => () => void } | null>(null);

/** Shared footprint: the interaction toaster covers the persistent context/queue toaster. */
export function ComposerToaster({ children }: { children: ReactNode }) {
  const parent = useContext(ToasterContext);
  const [targets, setTargets] = useState<Targets>({ context: null, queue: null, interaction: null, feedback: null });
  const [interactions, setInteractions] = useState(0);
  const registerInteraction = useCallback(() => {
    setInteractions(count => count + 1);
    return () => setInteractions(count => count - 1);
  }, []);
  const refs = useMemo(() => Object.fromEntries(REGIONS.map(region => [region, (node: HTMLDivElement | null) => {
    setTargets(current => current[region] === node ? current : { ...current, [region]: node });
  }])) as Record<ComposerDockRegion, (node: HTMLDivElement | null) => void>, []);
  const value = useMemo(() => ({ targets, registerInteraction }), [targets, registerInteraction]);
  if (parent) return <>{children}</>;
  const covered = interactions > 0;
  return (
    <ToasterContext.Provider value={value}>
      <div className="amiba-toaster-stack" data-composer-toaster-stack="" data-interacting={covered || undefined}>
        <div className="amiba-dock-sheet amiba-composer-toaster" data-composer-toaster="persistent"
          aria-hidden={covered || undefined} {...(covered ? { inert: "" } : {})}>
          <div ref={refs.context} data-composer-toaster-region="context" />
          <div ref={refs.queue} data-composer-toaster-region="queue" />
          <div ref={refs.feedback} data-composer-toaster-region="feedback" />
        </div>
        <div className="amiba-dock-sheet amiba-composer-toaster" data-composer-toaster="interaction">
          <div ref={refs.interaction} data-composer-toaster-region="interaction" />
        </div>
      </div>
      {children}
    </ToasterContext.Provider>
  );
}

/** Content contributes to an ordered region; only the host paints toaster chrome.
 * Standalone surfaces retain the same sheet treatment without requiring a host. */

const TONES = {
  // Frosted WHITE, not muted gray: the sheet covers a large area, and a
  // muted wash over the light canvas read as one drab slab. Inner controls
  // provide the gray as small chips (bg-muted/45) on this bright ground.
  neutral: "border-border/45 bg-popover/70",
  warn: "border-warning/40 bg-warning/[0.06]",
  danger: "border-destructive/35 bg-destructive/[0.06]",
} as const;

export type ComposerDockTone = keyof typeof TONES;

export interface ComposerDockSheetProps {
  tone?: ComposerDockTone;
  region?: ComposerDockRegion;
  className?: string;
  children: ReactNode;
}

export function ComposerDockSheet({
  tone = "neutral",
  region = "interaction",
  className,
  children,
}: ComposerDockSheetProps) {
  const host = useContext(ToasterContext);
  const register = host?.registerInteraction;
  useLayoutEffect(() => region === "interaction" ? register?.() : undefined, [region, register]);
  if (host) {
    const target = host.targets[region];
    return target ? createPortal(
      <section className={cn("amiba-composer-section", className)} data-composer-section={region} data-tone={tone}>
        {children}
      </section>, target,
    ) : null;
  }
  return (
    <div
      className={cn(
        // pb-5 = the 2.5 tucked under the composer card PLUS 2.5 of visible
        // clearance, so content never has to pad its own bottom edge to
        // keep off the composer.
        "amiba-dock-sheet relative z-0 mx-4 -mb-2.5 overflow-hidden rounded-t-[14px] border border-b-0 pb-5",
        "shadow-[inset_0_1px_0_rgb(255_255_255_/_0.5)] backdrop-blur-xl dark:shadow-[inset_0_1px_0_rgb(255_255_255_/_0.04)]",
        TONES[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Compact one-line danger sheet for recoverable composer-local errors
 * (attachment staging, workspace binding). Dismissible, quiet.
 */
export function ComposerDockError({
  message,
  onDismiss,
  dismissLabel,
}: {
  message: string;
  onDismiss: () => void;
  dismissLabel: string;
}) {
  return (
    <ComposerDockSheet region="feedback" tone="danger">
      <div className="flex items-start justify-between gap-2 px-4 pt-2.5 text-[11px] leading-relaxed text-destructive">
        <span className="min-w-0 flex-1 break-words">{message}</span>
        <ComposerDockIconButton onClick={onDismiss} aria-label={dismissLabel} title={dismissLabel} destructive>
          <svg aria-hidden fill="none" stroke="currentColor" strokeLinecap="round" viewBox="0 0 24 24">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </ComposerDockIconButton>
      </div>
    </ComposerDockSheet>
  );
}
