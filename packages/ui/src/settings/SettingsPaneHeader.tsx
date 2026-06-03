import { createContext, useContext, type ReactNode } from "react";

import { cn } from "../primitives";
/**
 * Host-driven configuration for every settings pane's title header.
 *
 * Each pane's title strip doubles as the right pane's window-chrome
 * line on desktop:
 *
 *   - `className` is folded into the header so a host can mark the strip
 *     `app-drag-region` (Electron) or leave it neutral.
 *   - `chromeHeightPx`, when set, is a *minimum* row height. The header
 *     still carries pt-3/pb-3 breathing room (so the title isn't flush
 *     against the chrome line) and grows past the minimum if the content
 *     needs it. Picking ~44 (OS title-bar height) makes the title strip
 *     read as one continuous chrome line with the macOS traffic lights
 *     on the sidebar side. When unset (extension/web), the header keeps
 *     the natural pt-5/pb-3 spacing with auto height.
 */
interface PaneHeaderConfig {
  className: string;
  chromeHeightPx: number | undefined;
}

const DEFAULT_CONFIG: PaneHeaderConfig = { className: "", chromeHeightPx: undefined };

const PaneHeaderContext = createContext<PaneHeaderConfig>(DEFAULT_CONFIG);

export function SettingsPaneProvider({
  className,
  chromeHeightPx,
  children,
}: {
  className?: string;
  chromeHeightPx?: number;
  children: ReactNode;
}) {
  const value: PaneHeaderConfig = {
    className: className ?? DEFAULT_CONFIG.className,
    chromeHeightPx,
  };
  return (
    <PaneHeaderContext.Provider value={value}>{children}</PaneHeaderContext.Provider>
  );
}

interface SettingsPaneHeaderProps {
  /**
   * Visible heading. Omit (along with `subtitle` and `children`) when the
   * pane wants to keep the chrome strip — for desktop window-drag — but
   * doesn't need a visible title (e.g. its own internal nav makes the
   * location obvious).
   */
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Tooltip displayed on hover over the subtitle row. */
  subtitleTooltip?: string;
  /** Right-aligned actions (buttons, badges). Already opted out of the
   *  drag region via the global `.app-drag-region button` CSS rule. */
  children?: ReactNode;
}

/**
 * Title strip shared by every settings tab. Reads its drag-region class
 * and chrome height from `SettingsPaneProvider` so the host decides
 * whether the strip behaves as window chrome.
 *
 * Title-less mode: when no title/subtitle/children are supplied, the
 * strip still renders (and still carries the drag-region className +
 * chrome height) but has no visible content. Used by panes that surface
 * their own internal navigation and don't want a redundant header above
 * it; desktop still gets a draggable top band so the OS window-drag
 * affordance survives.
 */
export function SettingsPaneHeader({
  title,
  subtitle,
  subtitleTooltip,
  children,
}: SettingsPaneHeaderProps) {
  const { className, chromeHeightPx } = useContext(PaneHeaderContext);
  const hasChromeFloor = chromeHeightPx !== undefined;
  const hasContent = !!title || !!subtitle || !!children;
  if (!hasContent) {
    // Drag-only strip. Keep the className (drag region on desktop) and
    // the chrome floor; extension/web hosts collapse to a zero-height
    // no-op since they don't supply a chrome height.
    return (
      <div
        className={cn("shrink-0", className)}
        style={hasChromeFloor ? { minHeight: chromeHeightPx } : undefined}
      />
    );
  }
  return (
    <header
      className={cn(
        "flex shrink-0 items-center justify-between gap-3 px-6",
        // Desktop hosts (chromeHeightPx set) use tighter padding so the
        // title sits near the chrome line; web/extension keeps the more
        // generous pt-5/pb-3 it shipped with.
        hasChromeFloor ? "pt-3 pb-3" : "pt-5 pb-3",
        className,
      )}
      style={hasChromeFloor ? { minHeight: chromeHeightPx } : undefined}
    >
      <div className="flex min-w-0 flex-col justify-center gap-0.5 leading-tight">
        {title && (
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            {title}
          </h2>
        )}
        {subtitle && (
          <p
            className="truncate text-[11px] text-muted-foreground"
            title={subtitleTooltip}
          >
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </header>
  );
}
