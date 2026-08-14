import { ChevronLeft, Play, Plus, RefreshCw, Settings2 } from "lucide-react";
import { Fragment, useRef, useState } from "react";

import { useT } from "@amiba/i18n";
import { SkillsPage } from "../skills";
import { Button, PageContent, ScrollArea, cn } from "../primitives";
import { SidebarExpandControl } from "../navigation/SidebarExpandControl";
import { PluginsTab } from "./PluginsTab";
import { SettingsExtensions, type SettingsExtensionsHandle } from "./SettingsExtensions";
import type { ManagedExtensionView } from "./ManagedExtensions";

type CapabilityTab = "extensions" | "plugins" | "skills";

export interface SettingsCapabilitiesProps {
  topBarHeightPx?: number;
  topBarClassName?: string;
  topBarLeftInset?: number;
  sidebarCollapsed?: boolean;
  showSidebarExpandControl?: boolean;
  onExpandSidebar?: () => void;
}

export function SettingsCapabilities({
  topBarHeightPx = 40,
  topBarClassName,
  topBarLeftInset = 0,
  sidebarCollapsed = false,
  showSidebarExpandControl = sidebarCollapsed,
  onExpandSidebar,
}: SettingsCapabilitiesProps = {}) {
  const { t } = useT();
  const extensionsRef = useRef<SettingsExtensionsHandle>(null);
  const [tab, setTab] = useState<CapabilityTab>("extensions");
  const [extensionsRefreshing, setExtensionsRefreshing] = useState(false);
  const [extensionView, setExtensionView] = useState<ManagedExtensionView | null>(null);

  function selectTab(next: CapabilityTab) {
    setTab(next);
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header
        className={cn(
          "flex shrink-0 items-center bg-background pr-2",
          topBarClassName,
        )}
        style={{
          height: topBarHeightPx,
          paddingLeft: sidebarCollapsed ? Math.max(topBarLeftInset, 12) : 10,
        }}
      >
        {onExpandSidebar ? (
          <SidebarExpandControl
            className="mr-1"
            collapsed={sidebarCollapsed}
            onExpand={onExpandSidebar}
            visible={showSidebarExpandControl}
          />
        ) : null}
        {extensionView ? (
          <div className="app-no-drag flex min-w-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              aria-label={t("options.extensions.title")}
              title={t("options.extensions.title")}
              onClick={() => setExtensionView(null)}
            >
              <ChevronLeft />
            </Button>
            <h2 className="truncate px-1 text-sm font-medium tracking-tight">
              {extensionView.name}
            </h2>
          </div>
        ) : (
          <nav
            className="app-no-drag flex items-center gap-1"
            aria-label={t("options.extensions.library.title")}
          >
            {(["extensions", "plugins", "skills"] as const).map((value) => {
              const active = tab === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => selectTab(value)}
                  className={cn(
                    "inline-flex h-8 items-center rounded-md px-2.5 text-[13px] font-medium transition-colors",
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/45 hover:text-foreground",
                  )}
                >
                  {value === "extensions"
                    ? t("options.extensions.title")
                    : value === "plugins"
                      ? t("options.plugins.heading")
                      : t("options.nav.skills")}
                </button>
              );
            })}
          </nav>
        )}
        <div className="app-no-drag ml-auto flex items-center gap-1">
          {extensionView ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-muted-foreground"
              onClick={() => setExtensionView({
                ...extensionView,
                mode: extensionView.mode === "use" ? "manage" : "use",
              })}
            >
              {extensionView.mode === "use" ? <Settings2 /> : <Play />}
              {extensionView.mode === "use"
                ? t("options.extensions.managed.manage")
                : t("options.extensions.managed.use")}
            </Button>
          ) : tab === "extensions" ? (
            <Fragment key="extensions-actions">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 bg-transparent text-muted-foreground shadow-none hover:bg-muted/55 hover:text-foreground active:bg-muted/70 active:text-foreground [&_svg]:size-3.5"
                aria-busy={extensionsRefreshing}
                aria-label={t("options.extensions.refresh")}
                title={t("options.extensions.refresh")}
                onClick={() => {
                  setExtensionsRefreshing(true);
                  extensionsRef.current?.refresh();
                }}
              >
                <RefreshCw
                  className={cn(extensionsRefreshing && "animate-spin")}
                />
              </Button>
              <Button
                size="sm"
                className="h-7 gap-1.5 rounded-lg px-2.5 text-xs [&_svg]:size-3.5"
                onClick={() => void extensionsRef.current?.add()}
              >
                <Plus />
                {t("common.add")}
              </Button>
            </Fragment>
          ) : null}
        </div>
      </header>

      {tab === "extensions" ? (
        <SettingsExtensions
          ref={extensionsRef}
          embedded
          onRefreshingChange={setExtensionsRefreshing}
          showPageTitle
          view={extensionView}
          onViewChange={setExtensionView}
        />
      ) : tab === "plugins" ? (
        <ScrollArea className="min-h-0 flex-1">
          <PageContent title={t("options.plugins.heading")}>
            <PluginsTab />
          </PageContent>
        </ScrollArea>
      ) : (
        <SkillsPage embedded showPageTitle profileId="default" />
      )}
    </div>
  );
}
