import { ChevronDown, ChevronRight, Home, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getPlatform } from "@amiba/app-runtime/platform";

import { useT } from "@amiba/i18n";
import { APP_VERSION } from "../app-version";
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
 *   Assistant:   DSH plugin-owned sections such as Agent presets (with the
 *                pinned default's behavior), Models & services, Tools, Skills
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
    /** DSH section-ledger navigation projected inside the Assistant group. */
    assistantNavigation?: (activeSection?: string) => React.ReactNode;
    /**
     * Render target for one DSH plugin-owned list section selected by id.
     * The section renders in the same React tree as the scaffold, so its
     * head actions ride SettingsPageActions' plain context path — no owner
     * side-channel is needed.
     */
    section?: (sectionId: string) => React.ReactNode;
    /**
     * The official `settings.header` seat: the panel title text, rendered in
     * the navigation heading row. The dialog's accessible name points at that
     * node (`aria-labelledby`), exactly as the official shell does. Hosts
     * that pass nothing get Amiba's own title.
     */
    header?: React.ReactNode;
    /**
     * The official `settings.action` seat: shell-level actions in the page
     * header, before Close. Forwarded to every page's scaffold.
     */
    action?: React.ReactNode;
    /**
     * The official `settings.general.item` seat: extra preference rows inside
     * the General section (Amiba's Appearance page).
     */
    generalItem?: React.ReactNode;
  };
  /**
   * Modal close affordance. When provided, Settings is being hosted in the
   * settings dialog: every page header gets a close button whose
   * visually-hidden label is the `settings.close` seat (`slots.close`), and
   * the navigation's Home row closes the dialog rather than navigating.
   */
  onClose?: () => void;
  /**
   * The official `settings.close` seat: the close button's visually-hidden
   * label text. The button itself — icon, geometry, focus — is shell chrome.
   * Unlike upstream, an unoccupied seat does NOT leave the button nameless:
   * the dispatch carries Amiba's own label as its `fallback`, which is the
   * job upstream's own `CloseLabel` registration does. Amiba cannot register
   * that entry itself, because `settings.close` is a SINGLE slot and a
   * priority-0 occupant would make a third-party registration throw.
   */
  closeLabel?: React.ReactNode;
  /** DOM id stamped on the navigation heading, for the dialog's aria-labelledby. */
  headerId?: string;
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
}

export function SettingsView({
  slots,
  onGoHome,
  onClose,
  closeLabel,
  headerId,
  sidebarHeaderLeftInset = 0,
  sidebarHeaderHeightPx = 40,
  sidebarHeaderClassName,
  paneHeaderClassName,
  paneHeaderChromeHeightPx,
  dshSections,
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

  // The modal shell's close button. Chrome is Amiba's (icon, geometry,
  // focus ring); the accessible name is the official `settings.close` seat,
  // with Amiba's own copy as the dispatch fallback so the button is never
  // nameless. Absent outside the dialog host.
  const closeControl = onClose ? (
    <button
      className="app-no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
      data-settings-close
      onClick={onClose}
      type="button"
    >
      <X className="h-4 w-4" />
      <span className="sr-only">{closeLabel ?? t("common.close")}</span>
    </button>
  ) : undefined;

  return (
    <div data-settings-view className="flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground">
      <aside
        data-testid="settings-sidebar"
        className="flex min-h-0 shrink-0 flex-col bg-muted/30"
        style={{ width: APP_SIDEBAR_DEFAULT_WIDTH }}
      >
        {/*
         * The navigation heading row — the official `settings.header` seat's
         * render site, and the node the settings dialog names itself after
         * (`aria-labelledby={headerId}`). One row for every host: the logo
         * only joins it on surfaces that render Settings standalone.
         */}
        <div
          className={`flex shrink-0 items-center gap-2.5 pr-3 ${sidebarHeaderClassName ?? ""}`}
          style={{
            height: sidebarHeaderHeightPx,
            paddingLeft: Math.max(sidebarHeaderLeftInset, 12),
          }}
        >
          {onGoHome ? null : <AmibaLogo size={20} className="shrink-0" />}
          <p
            className="min-w-0 truncate text-sm font-semibold tracking-tight"
            id={headerId}
          >
            {slots?.header ?? t("chat.settings")}
          </p>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <nav className="flex flex-col gap-0.5 p-2">
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
          </nav>
        </ScrollArea>
        <div className="px-3 py-2">
          <p className="text-[10px] text-muted-foreground/60">v{APP_VERSION}</p>
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
            actions={slots?.action}
            closeControl={closeControl}
          >
            {slots?.section?.(dshSection)}
          </SettingsPageScaffold>
        ) : activePage ? (
          <SettingsPageScaffold
            key={activePage.id}
            icon={<activePage.icon />}
            title={t(activePage.titleKey)}
            headerClassName={paneHeaderClassName}
            headerHeightPx={paneHeaderChromeHeightPx ?? 40}
            scroll={activePage.scroll ?? "page"}
            actions={slots?.action}
            closeControl={closeControl}
          >
            <activePage.component
              detail={route.detail}
              onOpenDetail={(id) => navigate(activePage.id, id ?? undefined)}
              generalItems={slots?.generalItem}
            />
          </SettingsPageScaffold>
        ) : null}
      </main>
    </div>
  );
}
