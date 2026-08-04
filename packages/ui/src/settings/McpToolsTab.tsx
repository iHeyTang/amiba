import { ChevronRight, CircleAlert, Plus, Server } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getHermesInstalledMcps, type HermesInstalledMcp } from "@amiba/core";
import { useT } from "@amiba/i18n";

import { useRefetchOnFocus } from "../hooks/useRefetchOnFocus";
import { Button, cn } from "../primitives";
import { useStartAgentTask } from "./agent-task";
import {
  MODEL_SETTINGS_SECTION_CLASS,
  MODEL_SETTINGS_SURFACE_CLASS,
  ModelSettingsSectionHeader,
} from "./ModelSettingsSectionChrome";

export function McpToolsTab({ profileId }: { profileId?: string }) {
  const { t } = useT();
  const startAgentTask = useStartAgentTask();
  const [items, setItems] = useState<HermesInstalledMcp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getHermesInstalledMcps(profileId);
    setLoading(false);
    if (!result.ok) {
      setError(result.error || t("externalTools.mcp.loadFailed"));
      return;
    }
    setItems(result.items);
  }, [profileId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useRefetchOnFocus(() => void refresh());

  function askToAdd() {
    if (!startAgentTask) return;
    void startAgentTask(
      t("externalTools.mcp.addPrompt", {
        profile: profileId ?? "default",
      }),
      {
        sourceApp: t("agentCapabilities.title"),
      },
    );
  }

  function askToConfigure(item: HermesInstalledMcp) {
    if (!startAgentTask) return;
    void startAgentTask(
      t("externalTools.mcp.configurePrompt", {
        name: item.label,
        slug: item.slug,
        profile: profileId ?? "default",
      }),
      { sourceApp: t("agentCapabilities.title") },
    );
  }

  return (
    <section className={MODEL_SETTINGS_SECTION_CLASS}>
      <ModelSettingsSectionHeader
        title={t("externalTools.mcp.title")}
        description={t("externalTools.mcp.subtitle")}
        accessory={
          startAgentTask ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg px-2.5 shadow-none"
              onClick={askToAdd}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("externalTools.mcp.add")}
            </Button>
          ) : undefined
        }
      />

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && items.length === 0 ? (
        <McpListSkeleton />
      ) : items.length === 0 ? (
        <div className={MODEL_SETTINGS_SURFACE_CLASS}>
          <div className="flex items-center gap-3 px-4 py-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/55 text-muted-foreground">
              <Server className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {t("externalTools.mcp.emptyTitle")}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("externalTools.mcp.emptyDescription")}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <ul className={MODEL_SETTINGS_SURFACE_CLASS} data-mcp-tools-surface>
          {items.map((item) => (
            <li
              key={item.slug}
              className="border-b border-border/40 last:border-b-0"
            >
              <button
                type="button"
                disabled={!startAgentTask}
                onClick={() => askToConfigure(item)}
                className={cn(
                  "group flex w-full items-center gap-3 px-4 py-3 text-left",
                  startAgentTask && "transition-colors hover:bg-muted/20",
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/55 text-muted-foreground">
                  <Server className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/75">
                      {[t("externalTools.mcp.source"), item.transport_kind]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {item.description ? (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  ) : null}
                </span>
                <span
                  className={
                    item.enabled
                      ? "flex shrink-0 items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-300"
                      : "flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
                  }
                >
                  <span
                    className={
                      item.enabled
                        ? "h-1.5 w-1.5 rounded-full bg-emerald-500"
                        : "h-1.5 w-1.5 rounded-full border border-muted-foreground/50"
                    }
                  />
                  {t(
                    item.enabled
                      ? "externalTools.status.enabled"
                      : "externalTools.status.disabled",
                  )}
                </span>
                {startAgentTask && (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function McpListSkeleton() {
  return (
    <div className={MODEL_SETTINGS_SURFACE_CLASS}>
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="flex items-center gap-3 border-b border-border/40 px-4 py-3 last:border-b-0"
        >
          <div className="h-8 w-8 animate-pulse rounded-md bg-muted/70" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-28 animate-pulse rounded bg-muted/70" />
            <div className="h-2.5 w-48 animate-pulse rounded bg-muted/50" />
          </div>
        </div>
      ))}
    </div>
  );
}
