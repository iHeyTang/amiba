import { useEffect, useId, useState, type ReactNode } from "react";
import { usePluginT } from "@amiba/i18n/plugin";
import { cn } from "../primitives";
import {
  DshPluginInventoryView,
  type DshPluginInventoryAdapter,
} from "./DshPluginInventory";

export interface PluginInventoryTab {
  id: string;
  label: string;
}

/** The inventory stays mounted so contributed tabs cannot reset its filters. */
export function PluginInventoryTabs({
  adapter,
  tabs,
  renderTab,
}: {
  adapter: DshPluginInventoryAdapter;
  tabs: readonly PluginInventoryTab[];
  renderTab(id: string): ReactNode;
}) {
  const { language } = usePluginT();
  const prefix = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const current = tabs.some((tab) => tab.id === selected) ? selected : null;
  useEffect(() => {
    if (selected !== current) setSelected(current);
  }, [selected, current]);
  const entries = [
    { id: null, label: language === "zh-CN" ? "插件清单" : "Plugin inventory" },
    ...tabs,
  ];
  const index = entries.findIndex((entry) => entry.id === current);
  const tabId = (position: number) => `${prefix}-tab-${position}`;
  const panelId = (position: number) => `${prefix}-panel-${position}`;
  return (
    <>
      {tabs.length > 0 && (
        <div
          role="tablist"
          className="mx-6 mb-3 inline-flex h-9 w-fit items-center rounded-lg bg-muted p-1 text-muted-foreground"
          aria-label={language === "zh-CN" ? "插件页面" : "Plugin pages"}
          onKeyDown={(event) => {
            const next =
              event.key === "ArrowRight"
                ? (index + 1) % entries.length
                : event.key === "ArrowLeft"
                  ? (index + entries.length - 1) % entries.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? entries.length - 1
                      : -1;
            if (next < 0) return;
            event.preventDefault();
            setSelected(entries[next].id);
            event.currentTarget
              .querySelectorAll<HTMLButtonElement>('[role="tab"]')
              [next]?.focus();
          }}
        >
          {entries.map((entry, position) => (
            <button
              type="button"
              role="tab"
              key={entry.id === null ? "inventory" : `plugin:${entry.id}`}
              id={tabId(position)}
              aria-controls={panelId(position)}
              aria-selected={position === index}
              tabIndex={position === index ? 0 : -1}
              onClick={() => setSelected(entry.id)}
              className={cn(
                "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                position === index && "bg-background text-foreground shadow",
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
      <DshPluginInventoryView
        key="inventory"
        adapter={adapter}
        active={current === null}
        panel={
          tabs.length ? { id: panelId(0), labelledBy: tabId(0) } : undefined
        }
      />
      {tabs.map((tab, position) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={panelId(position + 1)}
          aria-labelledby={tabId(position + 1)}
          tabIndex={0}
          hidden={current !== tab.id}
          className={cn("min-h-0 flex-1", current !== tab.id && "hidden")}
        >
          {current === tab.id ? renderTab(tab.id) : null}
        </div>
      ))}
    </>
  );
}
