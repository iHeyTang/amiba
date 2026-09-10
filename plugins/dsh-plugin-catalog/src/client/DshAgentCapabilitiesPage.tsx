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
} from "react";

import {
  Button,
  MODEL_SETTINGS_SECTION_CLASS,
  MODEL_SETTINGS_SURFACE_CLASS,
  ModelSettingsSectionHeader,
  PageContent,
  PaneHeaderBar,
  ScrollArea,
  SettingsPageDescription,
  usePluginT,
  useRefetchOnFocus,
} from "@amiba/ui/plugin";

import { catalogI18n, type CatalogMessageKey } from "./i18n.js";
import type { ToolSourceDescriptor, ToolSourceKind, ToolDistribution } from "../provenance.js";
import type { ToolInventory, ToolSchemaView } from "../remote.js";

/**
 * Wraps `usePluginT` with this plugin's own i18n overlay (see `./i18n.ts`).
 * Every call site in this file should use this, not the bare `usePluginT`,
 * so overlay-covered keys resolve locally instead of depending on the host
 * `agentCapabilities.*` bundle.
 */
function useT() {
  return usePluginT(catalogI18n);
}

type SourceFilter = "all" | ToolDistribution;

/**
 * Adapter this view renders — the catalog plugin's own runtime tool
 * inventory. Deliberately local to the plugin rather than the host platform
 * contract: this view (and its host wrapper `AgentCapabilitiesPage`/
 * `ToolsPage`) used to reach `@amiba/app-runtime/platform`'s
 * `AgentToolsAdapter`/`AgentToolInventory`/`AgentToolSchemaView`/
 * `AgentToolSourceKind`/`AgentToolSourceView`. Once this component moved
 * here those types had zero remaining consumers anywhere in the repo — no
 * chat-composer tool-mention surface reads them, unlike
 * `AgentSkillsAdapter` — so they were deleted from the platform contract
 * outright rather than narrowed. `client/index.tsx` builds an instance of
 * this shape directly from the plugin's own Remote face
 * (`ctx.remote.amibaTools`).
 */
export interface ToolsDirectoryAdapter {
  list(): Promise<ToolInventory>;
}

const SOURCES: Array<{
  id: ToolSourceKind;
  icon: LucideIcon;
  title: CatalogMessageKey;
  description: CatalogMessageKey;
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

const GROUPS = [
  { id: "builtin", icon: Cpu, title: "agentCapabilities.group.builtin", description: "agentCapabilities.group.builtin.description" },
  { id: "user", icon: Blocks, title: "agentCapabilities.group.user", description: "agentCapabilities.group.user.description" },
] satisfies Array<{ id: ToolDistribution; icon: LucideIcon; title: CatalogMessageKey; description: CatalogMessageKey }>;

function distribution(source: ToolSourceDescriptor): ToolDistribution {
  if (!source.distribution) throw new Error("Tool delivery metadata is required");
  return source.distribution;
}

const MCP_TOOL_LABELS: Record<string, CatalogMessageKey> = {
  bitable_v1_appTableRecord_batchCreate: "agentCapabilities.mcp.batchCreate",
  bitable_v1_appTableRecord_search: "agentCapabilities.mcp.searchRecords",
  contact_v3_user_batchGetId: "agentCapabilities.mcp.userIds",
  docx_builtin_import: "agentCapabilities.mcp.importDoc",
  docx_builtin_search: "agentCapabilities.mcp.searchDoc",
  docx_v1_document_rawContent: "agentCapabilities.mcp.readDoc",
  im_v1_chat_search: "agentCapabilities.mcp.searchChat",
  im_v1_message_create: "agentCapabilities.mcp.sendMessage",
};

function toolLabel(
  tool: ToolSchemaView,
  t: (key: CatalogMessageKey) => string,
): string {
  if (tool.source.kind !== "mcp-server") return tool.name;
  const prefix = `mcp__${tool.source.provider}__`;
  const raw = tool.name.startsWith(prefix)
    ? tool.name.slice(prefix.length)
    : tool.name;
  const key =
    tool.source.serviceId === "lark.mcp" ||
    tool.source.provider?.startsWith("lark-")
      ? MCP_TOOL_LABELS[raw]
      : undefined;
  return key
    ? t(key)
    : raw.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function mcpServiceLabel(
  source: ToolSourceDescriptor,
  t: (key: CatalogMessageKey) => string,
): string {
  const label = source.displayName?.trim();
  if (label && label !== source.provider) return label;
  if (source.serviceName) return source.serviceName;
  return t(
    source.provider === "lark" || source.provider?.startsWith("lark-")
      ? "agentCapabilities.mcp.lark"
      : "agentCapabilities.mcp.service",
  );
}

function McpServices({
  tools,
  onSelect,
}: {
  tools: ToolSchemaView[];
  onSelect(tool: ToolSchemaView): void;
}) {
  const { t } = useT();
  const services = new Map<string, ToolSchemaView[]>();
  for (const tool of tools) {
    // Missing provenance must never merge unrelated tools into one fake server.
    const id = tool.source.provider ?? tool.name;
    services.set(id, [...(services.get(id) ?? []), tool]);
  }
  return (
    <section className="border-t border-border/60 first:border-t-0">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <h3 className="text-xs font-semibold">
          {t("agentCapabilities.dsh.source.mcpServer")}
        </h3>
        <span className="text-xs text-muted-foreground">
          {services.size} {t("agentCapabilities.mcp.servers")} · {tools.length}{" "}
          {t("agentCapabilities.mcp.tools")}
        </span>
      </div>
      {[...services].map(([id, items]) => (
        <details key={id} className="group border-t border-border/45">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <Plug className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {mcpServiceLabel(items[0]!.source, t)}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              {items.length} {t("agentCapabilities.mcp.tools")}
            </span>
            <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
          </summary>
          <ul className="border-t border-border/40">
            {items.map((tool) => (
              <li
                key={tool.id ?? tool.name}
                className="border-b border-border/40 last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => onSelect(tool)}
                  className="flex w-full items-center gap-3 py-3 pl-11 pr-4 text-left hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {toolLabel(tool, t)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {tool.description ||
                        t("agentCapabilities.dsh.noDescription")}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}

function sourceConfig(kind: ToolSourceKind) {
  return SOURCES.find((source) => source.id === kind) ?? SOURCES[0]!;
}

const LOAD_MODE_KEYS: Record<
  ToolSourceDescriptor["loadMode"],
  CatalogMessageKey
> = {
  core: "agentCapabilities.dsh.loadMode.core",
  plugin: "agentCapabilities.dsh.loadMode.plugin",
  mcp: "agentCapabilities.dsh.loadMode.mcp",
};

const EXECUTION_TARGET_KEYS: Record<
  ToolSourceDescriptor["executionTarget"],
  CatalogMessageKey
> = {
  "dsh-runtime": "agentCapabilities.dsh.executionTarget.dshRuntime",
  "desktop-service": "agentCapabilities.dsh.executionTarget.desktopService",
  "external-process": "agentCapabilities.dsh.executionTarget.externalProcess",
};

export function DshAgentCapabilitiesPage({
  adapter,
  embedded = false,
  chromeHeightPx,
}: {
  adapter: ToolsDirectoryAdapter;
  embedded?: boolean;
  /** Still needed for the tool-detail drill-in's own back+title header,
   *  which stays local (see the `selectedTool` branch below). */
  chromeHeightPx?: number;
}) {
  const { t } = useT();
  const [inventory, setInventory] = useState<ToolInventory | null>(null);
  const [selectedTool, setSelectedTool] = useState<ToolSchemaView | null>(null);
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
          ? (next.tools.find((item) => (item.id ?? item.name) === (current.id ?? current.name)) ?? null)
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
    const result = new Map<ToolDistribution, number>();
    for (const tool of inventory?.tools ?? []) {
      const group = distribution(tool.source);
      result.set(group, (result.get(group) ?? 0) + 1);
    }
    return result;
  }, [inventory]);

  const grouped = useMemo(() => {
    const result = new Map<ToolDistribution, ToolSchemaView[]>();
    for (const tool of inventory?.tools ?? []) {
      const group = distribution(tool.source);
      if (sourceFilter !== "all" && group !== sourceFilter) continue;
      result.set(group, [
        ...(result.get(group) ?? []),
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
                  {toolLabel(selectedTool, t)}
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
            <dl className={MODEL_SETTINGS_SURFACE_CLASS}>
              <ToolMetadataRow
                label={t("agentCapabilities.mcp.callId")}
                value={selectedTool.name}
                mono
              />
            </dl>
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
                {GROUPS.map((group) => {
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
                        {items.filter((tool) => tool.source.kind !== "mcp-server").map((tool) => (
                          <li
                            className="border-b border-border/40 last:border-b-0"
                            key={tool.id ?? tool.name}
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
                      {items.some((tool) => tool.source.kind === "mcp-server") ? (
                        <McpServices tools={items.filter((tool) => tool.source.kind === "mcp-server")} onSelect={setSelectedTool} />
                      ) : null}
                    </section>
                  );
                })}
              </div>
            )}
          </section>
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
  counts: Map<ToolDistribution, number>;
  total: number;
  onChange(source: SourceFilter): void;
}) {
  const { t } = useT();
  const entries: Array<{
    id: SourceFilter;
    icon: LucideIcon;
    title: CatalogMessageKey;
    count: number;
  }> = [
    {
      id: "all",
      icon: Wrench,
      title: "agentCapabilities.dsh.source.all",
      count: total,
    },
    ...GROUPS.map((source) => ({
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

function ToolSourceSection({ source }: { source: ToolSourceDescriptor }) {
  const { t } = useT();
  const category = sourceConfig(source.kind);
  return (
    <section className={MODEL_SETTINGS_SECTION_CLASS}>
      <ModelSettingsSectionHeader
        title={t("agentCapabilities.dsh.source.detail")}
        description={t("agentCapabilities.dsh.source.detail.description")}
      />
      <dl className={MODEL_SETTINGS_SURFACE_CLASS}>
        <ToolMetadataRow label={t("agentCapabilities.group.label")} value={t(GROUPS.find((group) => group.id === distribution(source))!.title)} />
        <ToolMetadataRow
          label={t("agentCapabilities.dsh.source.category")}
          value={t(category.title)}
        />
        <ToolMetadataRow
          label={t("agentCapabilities.dsh.source.owner")}
          value={source.declaredBy ?? source.name}
        />
        {source.provider ? (
          <ToolMetadataRow
            label={t("agentCapabilities.dsh.source.provider")}
            value={
              source.kind === "mcp-server"
                ? mcpServiceLabel(source, t)
                : source.provider
            }
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
