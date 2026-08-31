import type { ReactNode } from "react";

import { cn } from "../primitives";

/**
 * The ONE container for everything that pops out from behind the composer —
 * approval prompts, ask-user questions, plan reviews, composer-local errors.
 * A frosted sheet with rounded top corners, tucked under the composer card
 * by a negative bottom margin so it reads as toast sliding out of the
 * toaster; the `.amiba-dock-sheet` class carries the slide-up entrance.
 *
 * New docked interactions should render INSIDE this sheet rather than
 * inventing their own card chrome, so every blocking surface above the
 * composer shares one visual language.
 */

const TONES = {
  neutral: "border-border/45 bg-muted/45",
  warn: "border-warning/40 bg-warning/[0.07]",
  danger: "border-destructive/35 bg-destructive/[0.06]",
} as const;

export type ComposerDockTone = keyof typeof TONES;

export interface ComposerDockSheetProps {
  tone?: ComposerDockTone;
  className?: string;
  children: ReactNode;
}

export function ComposerDockSheet({
  tone = "neutral",
  className,
  children,
}: ComposerDockSheetProps) {
  return (
    <div
      className={cn(
        "amiba-dock-sheet relative z-0 mx-4 -mb-2.5 overflow-hidden rounded-t-[14px] border border-b-0 pb-2.5",
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
    <ComposerDockSheet tone="danger">
      <div className="flex items-start justify-between gap-2 px-4 pb-1 pt-2.5 text-[11px] leading-relaxed text-destructive">
        <span className="min-w-0 flex-1 break-words">{message}</span>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-md p-0.5 transition-colors hover:bg-destructive/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30"
          aria-label={dismissLabel}
        >
          <svg
            aria-hidden
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </ComposerDockSheet>
  );
}
