import { createContext, useContext, type ReactNode } from "react";

import { PageContent, cn, type PageContentSize } from "../primitives";
/**
 * Host-driven configuration for every settings pane's title header.
 *
 * Each pane's title strip doubles as the right pane's window-chrome
 * line on desktop:
 *
 *   - `className` is folded into the header so a host can mark the strip
 *     `app-drag-region` (Electron) or leave it neutral.
 *   - `chromeHeightPx`, when set, is a *minimum* row height. A compact py-2
 *     keeps a one-line title inside the shared 40px desktop chrome while
 *     still allowing subtitle-bearing headers to grow naturally. When unset
 *     (extension/web), the header keeps the natural pt-5/pb-3 spacing.
 */
interface PaneHeaderConfig {
  className: string;
  chromeHeightPx: number | undefined;
}

const DEFAULT_CONFIG: PaneHeaderConfig = {
  className: "",
  chromeHeightPx: undefined,
};

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
    <PaneHeaderContext.Provider value={value}>
      {children}
    </PaneHeaderContext.Provider>
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
  /** Left-aligned navigation or identity control placed before the title. */
  leading?: ReactNode;
  /** Right-aligned actions (buttons, badges). Already opted out of the
   *  drag region via the global `.app-drag-region button` CSS rule. */
  children?: ReactNode;
  /** Optional width/alignment constraints for the visible header content.
   *  The outer header remains full-width so desktop window dragging works. */
  contentClassName?: string;
  /** Matches the title strip to the page body's named width. */
  contentSize?: PageContentSize;
  /** Optional visual treatment for this pane's header shell. */
  headerClassName?: string;
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
  leading,
  children,
  contentClassName,
  contentSize = "md",
  headerClassName,
}: SettingsPaneHeaderProps) {
  const { className, chromeHeightPx } = useContext(PaneHeaderContext);
  const hasChromeFloor = chromeHeightPx !== undefined;
  const hasContent = !!leading || !!title || !!subtitle || !!children;
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
      className={cn("shrink-0", className, headerClassName)}
      style={hasChromeFloor ? { minHeight: chromeHeightPx } : undefined}
    >
      <PageContent
        className={cn("px-7", hasChromeFloor ? "py-2" : "pb-3 pt-5")}
        padding="none"
        size={contentSize}
      >
        <div
          className={cn(
            "flex w-full items-center justify-between gap-3",
            contentClassName,
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            {leading}
            <div className="flex min-w-0 flex-col justify-center gap-0.5 leading-tight">
              {title && (
                <h2 className="truncate text-base font-medium tracking-tight text-foreground">
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
          </div>
          {children}
        </div>
      </PageContent>
    </header>
  );
}
