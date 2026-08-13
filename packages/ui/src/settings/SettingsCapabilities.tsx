import { Plus, RefreshCw } from "lucide-react";
import { Fragment, useRef, useState } from "react";

import { useT } from "@amiba/i18n";
import { SkillsPage } from "../skills";
import { Button, PageContent, ScrollArea, cn } from "../primitives";
import { SidebarExpandControl } from "../navigation/SidebarExpandControl";
import { PluginsTab } from "./PluginsTab";
import { SettingsApplets, type SettingsAppletsHandle } from "./SettingsApplets";
import { useStartAgentTask } from "./agent-task";

type CapabilityTab = "applets" | "plugins" | "skills";

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
  const startAgentTask = useStartAgentTask();
  const appletsRef = useRef<SettingsAppletsHandle>(null);
  const [tab, setTab] = useState<CapabilityTab>("applets");
  const [appletsRefreshing, setAppletsRefreshing] = useState(false);

  function selectTab(next: CapabilityTab) {
    setTab(next);
  }

  function installPlugin() {
    if (!startAgentTask) return;
    void startAgentTask(t("externalTools.plugin.addPrompt"), {
      sourceApp: t("options.plugins.heading"),
    });
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
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
        <nav
          className="app-no-drag flex items-center gap-1"
          aria-label={t("options.extensions.library.title")}
        >
          {(["applets", "plugins", "skills"] as const).map((value) => {
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
                {value === "applets"
                  ? t("options.extensions.title")
                  : value === "plugins"
                    ? t("options.plugins.heading")
                    : t("options.nav.skills")}
              </button>
            );
          })}
        </nav>
        <div className="app-no-drag ml-auto flex items-center gap-1">
          {tab === "applets" ? (
            <Fragment key="applets-actions">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 bg-transparent text-muted-foreground shadow-none hover:bg-muted/55 hover:text-foreground active:bg-muted/70 active:text-foreground [&_svg]:size-3.5"
                aria-busy={appletsRefreshing}
                aria-label={t("options.extensions.refresh")}
                title={t("options.extensions.refresh")}
                onClick={() => {
                  setAppletsRefreshing(true);
                  appletsRef.current?.refresh();
                }}
              >
                <RefreshCw
                  className={cn(appletsRefreshing && "animate-spin")}
                />
              </Button>
              <Button
                size="sm"
                className="h-7 gap-1.5 rounded-lg px-2.5 text-xs [&_svg]:size-3.5"
                onClick={() => void appletsRef.current?.add()}
              >
                <Plus />
                {t("common.add")}
              </Button>
            </Fragment>
          ) : tab === "plugins" && startAgentTask ? (
            <Button
              key="plugins-add-action"
              size="sm"
              className="h-7 gap-1.5 rounded-lg px-2.5 text-xs [&_svg]:size-3.5"
              onClick={installPlugin}
            >
              <Plus />
              {t("common.add")}
            </Button>
          ) : null}
        </div>
      </header>

      {tab === "applets" ? (
        <SettingsApplets
          ref={appletsRef}
          embedded
          onRefreshingChange={setAppletsRefreshing}
          showPageTitle
        />
      ) : tab === "plugins" ? (
        <ScrollArea className="min-h-0 flex-1">
          <PageContent title={t("options.plugins.heading")}>
            <PluginsTab showAddAction={false} />
          </PageContent>
        </ScrollArea>
      ) : (
        <SkillsPage embedded showPageTitle profileId="default" />
      )}
    </div>
  );
}
