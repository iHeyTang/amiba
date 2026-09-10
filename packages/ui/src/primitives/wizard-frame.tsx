import { ArrowLeft, X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./cn";

export interface WizardTab {
  id: string;
  label: string;
  active: boolean;
  onSelect(): void;
}

export interface WizardFrameProps {
  /** Platform mark shown in the header; omit for a plain title. */
  icon?: ReactNode;
  /** Branded app icons own their surface; generic glyphs use the default tile. */
  iconAppearance?: "tile" | "bare";
  title: string;
  subtitle?: string;
  tabs?: WizardTab[];
  /** ONE line of secondary text, footer-left (the only place small print lives). */
  hint?: ReactNode;
  /** The screen's own buttons, footer-right. */
  actions?: ReactNode;
  /** Optional in-flow navigation, shown at the top-left of the frame. */
  onBack?: () => void;
  backLabel?: string;
  onClose?: () => void;
  closeLabel?: string;
  className?: string;
  children: ReactNode;
}

/**
 * The one screen shape every takeover shares — a settings dialog page, a
 * conversation seat, a provider's connect wizard: header (mark + title +
 * subtitle + close), optional tab row, body, footer (hint left, actions
 * right). It is a set of parts a screen composes, never a container that
 * wraps someone else's screen: the caller owns every button in `actions`.
 *
 * Docked above the composer it sits inside `ComposerDockSheet`, whose
 * `pb-5` already clears the composer card; the `[.amiba-dock-sheet_&]`
 * variants below tighten the header and drop the footer's bottom inset there
 * so a docked wizard reads as tight as the approval and question sheets. An
 * ancestor selector, not a prop: provider wizards render the frame from their
 * own bundles without knowing which seat mounted them.
 */
export function WizardFrame({
  icon,
  iconAppearance = "tile",
  title,
  subtitle,
  tabs,
  hint,
  actions,
  onBack,
  backLabel,
  onClose,
  closeLabel,
  className,
  children,
}: WizardFrameProps) {
  const hasFooter = Boolean(hint) || Boolean(actions);
  const closeButton = onClose ? (
    <button
      aria-label={closeLabel ?? "Close"}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClose}
      type="button"
    >
      <X className="h-4 w-4" />
    </button>
  ) : null;
  return (
    <section
      className={cn("flex min-w-0 flex-col", className)}
      data-wizard-frame=""
    >
      <header className="px-6 pt-5 [.amiba-dock-sheet_&]:px-4 [.amiba-dock-sheet_&]:pt-3">
        {onBack ? (
          <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
            <button
              className="-ml-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onBack}
              type="button"
            >
              <ArrowLeft className="h-4 w-4" />
              {backLabel ?? "Back"}
            </button>
            {closeButton}
          </div>
        ) : null}
        <div className="flex items-start gap-3.5">
          {icon ? (
            <span
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center",
                iconAppearance === "bare"
                  ? "[&>img]:h-full [&>img]:w-full [&>svg]:h-full [&>svg]:w-full"
                  : "rounded-xl bg-muted/40 text-primary",
              )}
              data-wizard-icon={iconAppearance}
            >
              {icon}
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold leading-6 tracking-[-0.02em]">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
          </div>
          {!onBack ? closeButton : null}
        </div>
      </header>
      {tabs && tabs.length > 0 ? (
        <div
          className="mx-6 mt-5 flex w-fit items-center gap-1 rounded-lg bg-muted/35 p-1 [.amiba-dock-sheet_&]:mx-4"
          role="tablist"
        >
          {tabs.map((tab) => (
            <button
              aria-selected={tab.active}
              className={cn(
                "h-8 rounded-md px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tab.active
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:bg-background/45 hover:text-foreground",
              )}
              key={tab.id}
              onClick={tab.onSelect}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="px-6 pb-1 pt-5 [.amiba-dock-sheet_&]:px-4">
        {children}
      </div>
      {hasFooter ? (
        <footer className="mt-3 flex flex-wrap items-center gap-2 px-6 pb-5 pt-2 [.amiba-dock-sheet_&]:px-4 [.amiba-dock-sheet_&]:pb-0">
          <div className="mr-auto flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {hint}
          </div>
          {actions}
        </footer>
      ) : null}
    </section>
  );
}
