import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./cn";

export interface WizardTab {
  id: string;
  label: string;
  active: boolean;
  onSelect(): void;
}

export interface WizardFrameProps {
  /** Platform mark shown in the header tile; omit for a plain title. */
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  tabs?: WizardTab[];
  /** ONE line of secondary text, footer-left (the only place small print lives). */
  hint?: ReactNode;
  /** The screen's own buttons, footer-right. */
  actions?: ReactNode;
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
  icon, title, subtitle, tabs, hint, actions, onClose, closeLabel, className, children,
}: WizardFrameProps) {
  const hasFooter = Boolean(hint) || Boolean(actions);
  return (
    <section className={cn("flex min-w-0 flex-col", className)} data-wizard-frame="">
      <header className="flex items-start gap-3 px-4 pt-4 [.amiba-dock-sheet_&]:pt-3">
        {icon ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-primary/25 bg-background text-primary shadow-sm">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold leading-[22px]">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {onClose ? (
          <button
            aria-label={closeLabel ?? "Close"}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </header>
      {tabs && tabs.length > 0 ? (
        <div className="mt-3 flex gap-5 border-b border-border/90 px-4" role="tablist">
          {tabs.map((tab) => (
            <button
              aria-selected={tab.active}
              className={cn(
                "-mb-px border-b-2 pb-2 pt-1 text-[13px] font-medium transition-colors",
                tab.active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
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
      <div className="px-4 pb-1 pt-4">{children}</div>
      {hasFooter ? (
        <footer className="mt-3 flex items-center gap-2 border-t border-border/70 px-4 pb-4 pt-3 [.amiba-dock-sheet_&]:pb-0">
          <div className="mr-auto flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            {hint}
          </div>
          {actions}
        </footer>
      ) : null}
    </section>
  );
}
