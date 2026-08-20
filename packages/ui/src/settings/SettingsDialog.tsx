import { useEffect, useRef, type ReactNode } from "react";

export interface SettingsDialogProps {
  /** Shell-owned open state (Settings is a modal layer, not a route). */
  open: boolean;
  /** Close paths: the header button, a mask click, and document Escape. */
  onClose: () => void;
  /**
   * Id of the node holding the panel's title text — the settings navigation
   * heading, which is the `settings.header` seat's render site. The dialog's
   * accessible name points at it, exactly as the official shell does.
   */
  titleId: string;
  children: ReactNode;
}

/**
 * The settings modal layer: full-viewport mask + centred panel, layered over
 * the chat surface, which stays mounted behind it.
 *
 * Structure is the official settings shell's
 * (`@deepseek-ai/dsh-client-ui-settings-general`'s `SettingsRoot` →
 * `SettingsPanel`): a `role="presentation"` overlay, an `aria-hidden` mask
 * that closes on click, and a `role="dialog" aria-modal="true"` panel named
 * through `aria-labelledby`, with a document-level Escape listener whose
 * lifetime is the panel's. The PIXELS are Amiba's — Amiba's tokens, radii and
 * shadow — and the panel's body is Amiba's own `SettingsView`, unchanged.
 *
 * One deliberate departure from upstream: focus. The official panel focuses
 * its close button on mount and lets focus fall wherever it lands on close;
 * Amiba's settings pages remount per navigation, so auto-focusing a per-page
 * control would steal focus on every nav click. The panel itself takes focus
 * on open (so Escape and Tab start inside the dialog) and the element that
 * was focused when the dialog opened gets it back on close — which is the
 * sidebar trigger on the sidebar path, and the invoking control on every
 * other entry path.
 */
export function SettingsDialog({
  open,
  onClose,
  titleId,
  children,
}: SettingsDialogProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const restoreTo = document.activeElement;
    panel.current?.focus();
    return () => {
      if (restoreTo instanceof HTMLElement && restoreTo.isConnected) {
        restoreTo.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      data-amiba-settings-dialog
      role="presentation"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/45"
        onClick={onClose}
      />
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative flex h-full max-h-[860px] w-full min-h-0 min-w-0 max-w-[1180px] overflow-hidden rounded-xl border border-border/70 bg-background shadow-2xl outline-none"
        ref={panel}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
