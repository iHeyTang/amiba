import {
  ArrowLeft,
  Blocks,
  ChevronRight,
  Cpu,
  Plug,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { usePluginT as useT, type MessageKey } from "@amiba/i18n/plugin";
import {
  type AgentToolInventory,
  type AgentToolSchemaView,
  type AgentToolSourceKind,
  type AgentToolSourceView,
  type AgentToolsAdapter,
} from "@amiba/app-runtime/platform";

import { useRefetchOnFocus } from "../hooks/useRefetchOnFocus";
import { PaneHeaderBar } from "../navigation/PaneHeaderBar";
import { Button, PageContent, ScrollArea } from "../primitives";
import {
  MODEL_SETTINGS_SECTION_CLASS,
  MODEL_SETTINGS_SURFACE_CLASS,
  ModelSettingsSectionHeader,
} from "../settings/ModelSettingsSectionChrome";
import { SettingsPageDescription } from "../settings/page-chrome";

type SourceFilter = "all" | AgentToolSourceKind;

const SOURCES: Array<{
  id: AgentToolSourceKind;
  icon: LucideIcon;
  title: MessageKey;
  description: MessageKey;
}> = [
  {
    id: "dsh-core",
    icon: Cpu,
    title: "agentCapabilities.dsh.source.dshCore",
    description: "agentCapabilities.dsh.source.dshCore.description",
  },
  {
    id: "dsh-plugin",
    icon: Blocks,
    title: "agentCapabilities.dsh.source.dshPlugin",
    description: "agentCapabilities.dsh.source.dshPlugin.description",
  },
  {
    id: "mcp-server",
    icon: Plug,
    title: "agentCapabilities.dsh.source.mcpServer",
    description: "agentCapabilities.dsh.source.mcpServer.description",
  },
];

function sourceConfig(kind: AgentToolSourceKind) {
  return SOURCES.find((source) => source.id === kind) ?? SOURCES[0]!;
}

const LOAD_MODE_KEYS: Record<AgentToolSourceView["loadMode"], MessageKey> = {
  core: "agentCapabilities.dsh.loadMode.core",
  plugin: "agentCapabilities.dsh.loadMode.plugin",
  mcp: "agentCapabilities.dsh.loadMode.mcp",
};

const EXECUTION_TARGET_KEYS: Record<
  AgentToolSourceView["executionTarget"],
  MessageKey
> = {
  "dsh-runtime": "agentCapabilities.dsh.executionTarget.dshRuntime",
  "desktop-service": "agentCapabilities.dsh.executionTarget.desktopService",
  "external-process": "agentCapabilities.dsh.executionTarget.externalProcess",
};

export function DshAgentCapabilitiesPage({
  adapter,
  embedded = false,
  chromeHeightPx,
  headerActionsHost,
  children,
}: {
  adapter: AgentToolsAdapter;
  embedded?: boolean;
  /** Still needed for the tool-detail drill-in's own back+title header,
   *  which stays local (see the `selectedTool` branch below). */
  chromeHeightPx?: number;
  headerActionsHost?: () => HTMLElement | null;
  /** DSH child-slot contributions owned by the Tools feature plugin. */
  children?: ReactNode;
}) {
  const { t } = useT();
  const [inventory, setInventory] = useState<AgentToolInventory | null>(null);
  const [selectedTool, setSelectedTool] = useState<AgentToolSchemaView | null>(
    null,
  );
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await adapter.list();
      setInventory(next);
      setSelectedTool((current) =>
        current
          ? (next.tools.find((item) => item.name === current.name) ?? null)
          : null,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [adapter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRefetchOnFocus(() => void refresh());

  const sourceCounts = useMemo(() => {
    const result = new Map<AgentToolSourceKind, number>();
    for (const tool of inventory?.tools ?? []) {
      result.set(tool.source.kind, (result.get(tool.source.kind) ?? 0) + 1);
    }
    return result;
  }, [inventory]);

  const grouped = useMemo(() => {
    const result = new Map<AgentToolSourceKind, AgentToolSchemaView[]>();
    for (const tool of inventory?.tools ?? []) {
      if (sourceFilter !== "all" && tool.source.kind !== sourceFilter) continue;
      result.set(tool.source.kind, [
        ...(result.get(tool.source.kind) ?? []),
        tool,
      ]);
    }
    return result;
  }, [inventory, sourceFilter]);

  if (selectedTool) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <PaneHeaderBar
          className={chromeHeightPx ? "app-drag-region" : undefined}
          heightPx={chromeHeightPx ?? 40}
          leading={
            <>
              <button
                aria-label={t("agentCapabilities.back")}
                className="app-no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
                onClick={() => setSelectedTool(null)}
                type="button"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="flex min-w-0 flex-col justify-center gap-0.5 leading-tight">
                <h2 className="truncate text-base font-medium tracking-tight text-foreground">
                  {selectedTool.name}
                </h2>
                <p className="truncate text-[11px] text-muted-foreground">
                  {selectedTool.description ||
                    t("agentCapabilities.dsh.noDescription")}
                </p>
              </div>
            </>
          }
        />
        <ScrollArea className="min-h-0 flex-1">
          <PageContent bodyClassName="space-y-5" size="md">
            <ToolSourceSection source={selectedTool.source} />
            <section className={MODEL_SETTINGS_SECTION_CLASS}>
              <ModelSettingsSectionHeader
                title={t("agentCapabilities.dsh.schema")}
                description={t("agentCapabilities.dsh.schema.description")}
              />
              <pre
                className={`${MODEL_SETTINGS_SURFACE_CLASS} overflow-x-auto p-4 text-xs leading-relaxed`}
              >
                {JSON.stringify(selectedTool.parameters, null, 2)}
              </pre>
            </section>
          </PageContent>
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <ScrollArea className="min-h-0 flex-1">
        <PageContent
          bodyClassName="space-y-8"
          className={!embedded ? "pt-3" : undefined}
          size="md"
        >
          {!embedded ? (
            <SettingsPageDescription>
              {t("agentCapabilities.dsh.description")}
            </SettingsPageDescription>
          ) : null}
          <section className={MODEL_SETTINGS_SECTION_CLASS}>
            {error ? (
              <div className="flex items-start justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                <span>{error}</span>
                <Button
                  onClick={() => void refresh()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {t("common.retry")}
                </Button>
              </div>
            ) : null}

            {inventory ? (
              <ToolSourceIndex
                active={sourceFilter}
                counts={sourceCounts}
                onChange={setSourceFilter}
                total={inventory.tools.length}
              />
            ) : null}

            {loading && !inventory ? (
              <DshCapabilitySkeleton />
            ) : inventory?.tools.length === 0 ? (
              <div className={MODEL_SETTINGS_SURFACE_CLASS}>
                <p className="px-4 py-5 text-sm text-muted-foreground">
                  {t("agentCapabilities.dsh.empty")}
                </p>
              </div>
            ) : grouped.size === 0 ? (
              <div className={MODEL_SETTINGS_SURFACE_CLASS}>
                <p className="px-4 py-5 text-sm text-muted-foreground">
                  {t("agentCapabilities.dsh.source.empty")}
                </p>
              </div>
            ) : (
              <div
                className={MODEL_SETTINGS_SURFACE_CLASS}
                data-tool-settings-surface
              >
                {SOURCES.map((group) => {
                  const items = grouped.get(group.id) ?? [];
                  if (items.length === 0) return null;
                  const Icon = group.icon;
                  return (
                    <section
                      className="border-t border-border/60 first:border-t-0"
                      key={group.id}
                    >
                      <div className="flex items-center gap-3 bg-muted/[0.035] px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <h3 className="text-xs font-semibold text-foreground">
                              {t(group.title)}
                            </h3>
                            <p className="text-[11px] text-muted-foreground">
                              {t(group.description)}
                            </p>
                          </div>
                        </div>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {items.length}
                        </span>
                      </div>
                      <ul className="border-t border-border/45">
                        {items.map((tool) => (
                          <li
                            className="border-b border-border/40 last:border-b-0"
                            key={tool.name}
                          >
                            <button
                              className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/20"
                              onClick={() => setSelectedTool(tool)}
                              type="button"
                            >
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/55 text-muted-foreground">
                                <Icon className="h-4 w-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium">
                                  {tool.name}
                                </span>
                                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                  {tool.description ||
                                    t("agentCapabilities.dsh.noDescription")}
                                </span>
                              </span>
                              {tool.source.kind !== "dsh-core" ? (
                                <span className="hidden max-w-36 shrink-0 truncate text-[11px] text-muted-foreground lg:block">
                                  {tool.source.name}
                                </span>
                              ) : null}
                              <span className="flex shrink-0 items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-300">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                {t("agentCapabilities.dsh.ready")}
                              </span>
                              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
          </section>
          {children}
        </PageContent>
      </ScrollArea>
    </div>
  );
}

function ToolSourceIndex({
  active,
  counts,
  total,
  onChange,
}: {
  active: SourceFilter;
  counts: Map<AgentToolSourceKind, number>;
  total: number;
  onChange(source: SourceFilter): void;
}) {
  const { t } = useT();
  const entries: Array<{
    id: SourceFilter;
    icon: LucideIcon;
    title: MessageKey;
    count: number;
  }> = [
    {
      id: "all",
      icon: Wrench,
      title: "agentCapabilities.dsh.source.all",
      count: total,
    },
    ...SOURCES.map((source) => ({
      id: source.id,
      icon: source.icon,
      title: source.title,
      count: counts.get(source.id) ?? 0,
    })),
  ];

  return (
    <div className={`${MODEL_SETTINGS_SURFACE_CLASS} overflow-x-auto p-1.5`}>
      <div
        aria-label={t("agentCapabilities.dsh.source.filter")}
        className="flex min-w-max items-center gap-1"
        role="group"
      >
        {entries.map((entry) => {
          const Icon = entry.icon;
          const selected = active === entry.id;
          return (
            <button
              aria-pressed={selected}
              className={`inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                selected
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/45 hover:text-foreground"
              }`}
              key={entry.id}
              onClick={() => onChange(entry.id)}
              type="button"
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{t(entry.title)}</span>
              <span
                className={`min-w-5 rounded px-1.5 py-0.5 text-center text-[10px] tabular-nums ${
                  selected ? "bg-background/75" : "bg-muted/55"
                }`}
              >
                {entry.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ToolSourceSection({ source }: { source: AgentToolSourceView }) {
  const { t } = useT();
  const category = sourceConfig(source.kind);
  return (
    <section className={MODEL_SETTINGS_SECTION_CLASS}>
      <ModelSettingsSectionHeader
        title={t("agentCapabilities.dsh.source.detail")}
        description={t("agentCapabilities.dsh.source.detail.description")}
      />
      <dl className={MODEL_SETTINGS_SURFACE_CLASS}>
        <ToolMetadataRow
          label={t("agentCapabilities.dsh.source.category")}
          value={t(category.title)}
        />
        <ToolMetadataRow
          label={t("agentCapabilities.dsh.source.owner")}
          value={source.name}
        />
        {source.provider ? (
          <ToolMetadataRow
            label={t("agentCapabilities.dsh.source.provider")}
            value={source.provider}
          />
        ) : null}
        {source.packageName ? (
          <ToolMetadataRow
            label={t("agentCapabilities.dsh.source.package")}
            mono
            value={source.packageName}
          />
        ) : null}
        <ToolMetadataRow
          label={t("agentCapabilities.dsh.source.identifier")}
          mono
          value={source.id}
        />
        <ToolMetadataRow
          label={t("agentCapabilities.dsh.source.loadMode")}
          value={`${t(LOAD_MODE_KEYS[source.loadMode])} · ${t(
            source.dynamic
              ? "agentCapabilities.dsh.source.dynamic"
              : "agentCapabilities.dsh.source.bundled",
          )}`}
        />
        <ToolMetadataRow
          label={t("agentCapabilities.dsh.source.executionTarget")}
          value={t(EXECUTION_TARGET_KEYS[source.executionTarget])}
        />
      </dl>
    </section>
  );
}

function ToolMetadataRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex min-h-11 items-center gap-6 border-b border-border/45 px-4 py-2.5 last:border-b-0">
      <dt className="w-28 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`min-w-0 flex-1 break-all text-right text-sm text-foreground ${
          mono ? "font-mono text-xs" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function DshCapabilitySkeleton() {
  return (
    <div className={MODEL_SETTINGS_SURFACE_CLASS}>
      {[2, 3, 3].map((rows, index) => (
        <div className="border-t border-border/60 first:border-t-0" key={index}>
          <div className="flex h-9 items-center border-b border-border/45 bg-muted/[0.035] px-4">
            <div className="h-3 w-28 animate-pulse rounded bg-muted/70" />
          </div>
          {Array.from({ length: rows }).map((_, row) => (
            <div
              className="flex items-center gap-3 border-b border-border/40 px-4 py-3 last:border-b-0"
              key={row}
            >
              <div className="h-8 w-8 animate-pulse rounded-md bg-muted/70" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-28 animate-pulse rounded bg-muted/70" />
                <div className="h-2.5 w-52 animate-pulse rounded bg-muted/50" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
