import { getPlatform } from "@amiba/app-runtime/platform";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "../primitives/cn";
import {
  DIALOG_CONTENT_MOTION_CLASS,
  DIALOG_MOTION_MS,
  DIALOG_OVERLAY_MOTION_CLASS,
} from "../primitives/dialog";

/** The `p-4` inset the mask uses on every edge the OS does not own. */
const BASE_INSET_PX = 16;

export interface SettingsDialogProps {
  /** Shell-owned open state (Settings is a modal layer, not a route). */
  open: boolean;
  /** Close paths: the header button, a mask click, and Escape. */
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
 * The settings modal layer around the product's large split-pane settings
 * surface. The chat surface stays mounted behind it.
 *
 * Its inner split-pane content follows the official settings shell's shape,
 * while its overlay and panel consume exactly the same enter/exit motion
 * contract as DialogContent. It deliberately stays a host-level container:
 * plugin dialogs can then open above it without nesting two independently
 * bundled Radix modal managers across Fibers. The visible panel remains named
 * through the `settings.header` Slot via `aria-labelledby`. The PIXELS are
 * Amiba's — tokens, radii and shadow — and the panel body remains Amiba's own
 * `SettingsView`.
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
  const [present, setPresent] = useState(open);

  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    if (!present) return;
    const timer = window.setTimeout(() => setPresent(false), DIALOG_MOTION_MS);
    return () => window.clearTimeout(timer);
  }, [open, present]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      // Radix handles the top dismissable layer during capture and prevents
      // default. Also respect portalled dialogs owned by other plugin bundles.
      const nestedDialog = Array.from(document.querySelectorAll(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
      )).some(dialog => dialog !== panel.current);
      if (nestedDialog) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !present) return;
    const restoreTo = document.activeElement;
    panel.current?.focus();
    return () => {
      if (restoreTo instanceof HTMLElement && restoreTo.isConnected) {
        restoreTo.focus();
      }
    };
  }, [open, present]);

  if (!present) return null;

  const topInset = Math.max(
    BASE_INSET_PX,
    getPlatform().windowChrome?.topBarHeightPx ?? 0,
  );
  const state = open ? "open" : "closed";

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4"
      data-amiba-settings-dialog
      role="presentation"
      style={{
        paddingTop: topInset,
        pointerEvents: open ? undefined : "none",
      }}
    >
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-0 bg-black/80",
          DIALOG_OVERLAY_MOTION_CLASS,
        )}
        data-state={state}
        data-ui-overlay="dialog-overlay"
        onClick={() => {
          if (open) onClose();
        }}
      />
      <div
        aria-labelledby={open ? titleId : undefined}
        aria-modal={open ? "true" : undefined}
        className={cn(
          "relative flex h-full max-h-[860px] w-full min-h-0 min-w-0 max-w-[1180px] overflow-hidden rounded-xl border border-border/70 bg-background shadow-overlay outline-none",
          DIALOG_CONTENT_MOTION_CLASS,
        )}
        data-state={state}
        data-ui-overlay="dialog"
        data-glass-surface="surface"
        ref={panel}
        role={open ? "dialog" : undefined}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
