import { ChevronDown, ChevronRight, Home } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getPlatform } from "@amiba/app-runtime/platform";

import { useT } from "@amiba/i18n";
import { useResolvedTheme } from "../theme";
import { AmibaLogo, ScrollArea } from "../primitives";

import { SettingsPageScaffold } from "./SettingsPageScaffold";
import { SETTINGS_PAGES, settingsPageById } from "./settings-pages";
import {
  NavigationGroupLabel,
  NavigationRow,
} from "../navigation/NavigationRow";
import { APP_SIDEBAR_DEFAULT_WIDTH } from "../navigation/sidebar-layout";

/**
 * Settings follows the product's real concepts rather than an "advanced"
 * catch-all:
 *   General:     Appearance → Shortcuts → Usage
 *   Assistant:   DSH plugin-owned sections such as Behavior & identity,
 *                Agent presets, Models & services, Tools, and Skills
 *   Plugins:      supplied by DSH Client plugins through the section ledger
 *   Advanced:    Status → Logs
 *
 * The registry in ./settings-pages is the single source of navigation
 * entries, head titles, and routing targets — this component only owns the
 * shell (sidebar, two-segment hash routing, and the main-area scaffold
 * mount point).
 */

interface SettingsRoute {
  tab: string;
  detail?: string;
}

function routeFromLocation(): SettingsRoute {
  const raw =
    typeof window !== "undefined"
      ? window.location.hash.replace(/^#/, "").split("?")[0]
      : "";
  const [tab = "", ...rest] = raw.split("/");
  const detail = rest.join("/") || undefined;
  if (tab.startsWith("dsh:") && tab.length > 4) return { tab };
  const page = settingsPageById(tab);
  const isDesktop = getPlatform().kind === "desktop";
  if (page && (isDesktop || !page.desktopOnly)) return { tab, detail };
  // Ids the built-in registry does not know at all resolve against the DSH
  // settings-section ledger instead, so plugin sections stay addressable by
  // bare id (deep links like `#models` keep working after a page migrates
  // from the registry to a plugin contribution). Registry pages gated off
  // this surface (desktopOnly off-desktop) and malformed `dsh:`-prefixed
  // stubs still fall back to Appearance.
  if (!page && tab && !tab.startsWith("dsh:")) return { tab: `dsh:${tab}` };
  return { tab: "appearance" };
}

function isAdvancedTab(tab: string): boolean {
  return settingsPageById(tab)?.group === "advanced";
}

export interface SettingsViewProps {
  slots?: {
    /** Additive DSH entries before the built-in settings navigation. */
    navigationBefore?: React.ReactNode;
    /** DSH section-ledger navigation projected inside the Assistant group. */
    assistantNavigation?: (activeSection?: string) => React.ReactNode;
    /** Additive DSH entries after the built-in settings navigation. */
    navigationAfter?: React.ReactNode;
    /** Render target for one DSH plugin-owned list section selected by id. */
    section?: (
      sectionId: string,
      owner: { actionsHost: () => HTMLElement | null },
    ) => React.ReactNode;
    /**
     * Render target for one DSH plugin-owned agent-preset detail section,
     * scoped to the preset the ledger tab was opened under. Forwarded to
     * the active page as `renderPresetSection`; no registry page reads it
     * today (the agents page moved to dsh-plugin-agent-preset, which emits
     * the same slot marker itself) — kept as the generic mechanism.
     */
    presetSection?: (
      sectionId: string,
      owner: { profileId: string },
    ) => React.ReactNode;
    /** Settings content overlay; entries opt into pointer events. */
    contentOverlay?: React.ReactNode;
  };
  /**
   * Optional — when provided, the sidebar's top-left Amiba logo + title
   * becomes a clickable button that navigates back to Home. Desktop
   * passes this so users have a one-click escape from Settings.
   */
  onGoHome?: () => void;
  /**
   * Optional pixel reserve on the sidebar header's left edge so OS chrome
   * (macOS traffic lights when running inside Electron with a hidden
   * native title bar) doesn't collide with the logo. Default 0; desktop
   * passes ~78 on mac.
   */
  sidebarHeaderLeftInset?: number;
  /**
   * Sidebar header row height in px. Default 24 (compact, matches the
   * extension layout). Desktop passes 40 so the centred Home button
   * lands on the macOS traffic-light baseline (y=20).
   */
  sidebarHeaderHeightPx?: number;
  /**
   * Extra className on the sidebar header. Desktop passes `app-drag-region`
   * so the user can drag the window from there; the inner button auto
   * opts out via the global CSS rule.
   */
  sidebarHeaderClassName?: string;
  /**
   * Extra className folded into every settings pane's title header.
   * Desktop passes `app-drag-region` so the title strip doubles as the
   * window-drag region above the right pane — no separate empty strip,
   * the heading itself sits on the chrome line.
   */
  paneHeaderClassName?: string;
  /**
   * When set, every pane's title header collapses to exactly this
   * pixel height with the title block vertically centred inside it.
   * Desktop passes the OS title-bar height (e.g. 44) so the heading
   * sits *within* the chrome row aligned with the traffic lights,
   * not in an empty band below them. Omit for extension/web — the
   * header then keeps the natural pt-5/pb-3 spacing.
   */
  paneHeaderChromeHeightPx?: number;
  /**
   * Labels for DSH plugin-owned settings sections (title source for the
   * scaffold head when a `dsh:` route is active). Supplied by the product
   * shell from the section ledger; sections without an entry here fall
   * back to their raw id.
   */
  dshSections?: readonly { id: string; label: string }[];
  /**
   * Ledger of DSH plugin-owned agent-preset detail sections. Passed through
   * to every registry page as `presetSections`; no registry page consumes
   * it since the agents page moved to dsh-plugin-agent-preset.
   */
  dshPresetSections?: readonly { id: string; label: string }[];
}

export function SettingsView({
  slots,
  onGoHome,
  sidebarHeaderLeftInset = 0,
  sidebarHeaderHeightPx = 40,
  sidebarHeaderClassName,
  paneHeaderClassName,
  paneHeaderChromeHeightPx,
  dshSections,
  dshPresetSections,
}: SettingsViewProps = {}) {
  useResolvedTheme();
  const { t } = useT();

  const platform = getPlatform();
  const isDesktop = platform.kind === "desktop";
  const [route, setRoute] = useState<SettingsRoute>(routeFromLocation);
  const [advancedOpen, setAdvancedOpen] = useState(() =>
    isAdvancedTab(routeFromLocation().tab),
  );

  useEffect(() => {
    const onHash = () => {
      setRoute(routeFromLocation());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    setAdvancedOpen(isAdvancedTab(route.tab));
  }, [route.tab]);

  function toggleAdvancedSettings() {
    setAdvancedOpen((value) => !value);
  }

  function navigate(tab: string, detail?: string) {
    setRoute({ tab, detail });
    if (!isAdvancedTab(tab)) setAdvancedOpen(false);
    const base = window.location.pathname + window.location.search;
    window.history.replaceState(
      null,
      "",
      detail ? `${base}#${tab}/${detail}` : `${base}#${tab}`,
    );
  }

  const generalPages = SETTINGS_PAGES.filter(
    (p) => p.group === "general" && (isDesktop || !p.desktopOnly),
  );
  const assistantPages = SETTINGS_PAGES.filter(
    (p) => p.group === "assistant" && (isDesktop || !p.desktopOnly),
  );
  const advancedPages = SETTINGS_PAGES.filter(
    (p) => p.group === "advanced" && (isDesktop || !p.desktopOnly),
  );

  const dshSection = route.tab.startsWith("dsh:")
    ? route.tab.slice("dsh:".length)
    : undefined;
  const activePage = dshSection ? undefined : settingsPageById(route.tab);
  const actionsHostRef = useRef<HTMLElement | null>(null);

  return (
    <div className="flex h-screen min-h-0 w-full overflow-hidden bg-background text-foreground">
      <aside
        data-testid="settings-sidebar"
        className="flex min-h-0 shrink-0 flex-col bg-muted/30"
        style={{ width: APP_SIDEBAR_DEFAULT_WIDTH }}
      >
        {onGoHome ? (
          /*
           * Desktop sidebar chrome remains a passive drag region. The
           * actual Home destination belongs to the navigation list below,
           * where it behaves like every other sidebar destination.
           */
          <div
            className={`shrink-0 ${sidebarHeaderClassName ?? ""}`}
            style={{
              height: sidebarHeaderHeightPx,
              paddingLeft: Math.max(sidebarHeaderLeftInset, 12),
            }}
          />
        ) : (
          <div className="flex h-14 shrink-0 items-center gap-2.5 px-3">
            <AmibaLogo size={28} className="shrink-0" />
            <p className="truncate text-sm font-semibold tracking-tight">
              {t("app.title")}
            </p>
          </div>
        )}
        <ScrollArea className="min-h-0 flex-1">
          <nav className="flex flex-col gap-0.5 p-2">
            {slots?.navigationBefore}
            {onGoHome ? (
              <NavigationRow
                icon={<Home className="h-4 w-4 shrink-0 opacity-70" />}
                label={t("chat.goHome")}
                active={false}
                onClick={onGoHome}
              />
            ) : null}

            {/* ── General — safe, everyday app settings ── */}
            <NavigationGroupLabel className={onGoHome ? "mt-2" : "pt-0"}>
              {t("options.nav.section.general")}
            </NavigationGroupLabel>
            {generalPages.map((page) => (
              <NavigationRow
                key={page.id}
                icon={<page.icon className="h-4 w-4 shrink-0 opacity-70" />}
                label={t(page.titleKey)}
                active={route.tab === page.id}
                onClick={() => navigate(page.id)}
              />
            ))}

            {/* ── Assistant — everyday behavior and model defaults ── */}
            <NavigationGroupLabel className="mt-2">
              {t("options.nav.section.agent")}
            </NavigationGroupLabel>
            {assistantPages.map((page) => (
              <NavigationRow
                key={page.id}
                icon={<page.icon className="h-4 w-4 shrink-0 opacity-70" />}
                label={t(page.titleKey)}
                active={route.tab === page.id}
                onClick={() => navigate(page.id)}
              />
            ))}
            {slots?.assistantNavigation?.(dshSection)}

            {/* ── Advanced — diagnostics, collapsed by default ── */}
            <button
              aria-expanded={advancedOpen}
              className="mt-3 flex h-7 w-full items-center gap-1.5 px-2 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70 transition-colors hover:text-muted-foreground"
              onClick={toggleAdvancedSettings}
              type="button"
            >
              {advancedOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <span>{t("options.nav.section.advanced")}</span>
            </button>
            {advancedOpen ? (
              <div className="pl-2">
                {advancedPages.map((page) => (
                  <NavigationRow
                    key={page.id}
                    icon={
                      <page.icon className="h-4 w-4 shrink-0 opacity-70" />
                    }
                    label={t(page.titleKey)}
                    active={route.tab === page.id}
                    onClick={() => navigate(page.id)}
                  />
                ))}
              </div>
            ) : null}
            {slots?.navigationAfter}
          </nav>
        </ScrollArea>
        <div className="px-3 py-2">
          <p className="text-[10px] text-muted-foreground/60">v0.3.0</p>
        </div>
      </aside>

      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {dshSection ? (
          <SettingsPageScaffold
            key={route.tab}
            title={
              dshSections?.find((section) => section.id === dshSection)
                ?.label ?? dshSection
            }
            headerClassName={paneHeaderClassName}
            headerHeightPx={paneHeaderChromeHeightPx ?? 40}
            scroll="self"
            onActionsHostChange={(el) => {
              actionsHostRef.current = el;
            }}
          >
            {slots?.section?.(dshSection, {
              actionsHost: () => actionsHostRef.current,
            })}
          </SettingsPageScaffold>
        ) : activePage ? (
          <SettingsPageScaffold
            key={activePage.id}
            icon={<activePage.icon />}
            title={t(activePage.titleKey)}
            headerClassName={paneHeaderClassName}
            headerHeightPx={paneHeaderChromeHeightPx ?? 40}
            scroll={activePage.scroll ?? "page"}
          >
            <activePage.component
              detail={route.detail}
              onOpenDetail={(id) => navigate(activePage.id, id ?? undefined)}
              presetSections={dshPresetSections}
              renderPresetSection={slots?.presetSection}
            />
          </SettingsPageScaffold>
        ) : null}
        {slots?.contentOverlay ? (
          <div
            data-amiba-slot="amiba.settings.content.overlay"
            className="pointer-events-none absolute inset-0 z-[60]"
          >
            {slots.contentOverlay}
          </div>
        ) : null}
      </main>
    </div>
  );
}
