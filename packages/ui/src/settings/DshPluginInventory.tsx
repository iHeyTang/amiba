import {
  Boxes,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Download,
  Loader2,
  PackagePlus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { usePluginT, type PluginLanguage } from "@amiba/i18n/plugin";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Button,
  CollectionState,
  Input,
  PageContent,
  ScrollArea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  cn,
} from "../primitives";
import {
  SettingsPageActionButton,
  SettingsPageActions,
  SettingsPageDescription,
} from "./page-chrome";

export type DshPluginFiberPhase =
  | "pending"
  | "loading"
  | "active"
  | "failed"
  | "unloading"
  | null;

export interface DshPluginInventoryEntry {
  entryId: string;
  moduleName: string;
  enabled: boolean;
  fiberPhase: DshPluginFiberPhase;
}

export interface DshPluginInventoryAdapter {
  list(): Promise<{ entries: readonly DshPluginInventoryEntry[] }>;
  management?: DshPluginManagementAdapter;
}

export interface DshInstalledPluginPackage {
  packageName: string;
  requestedSpec: string;
  version?: string;
  bundle: boolean;
  source?: "internal" | "external";
  provider?: "dsh" | "amiba" | "third-party" | "unknown";
  author?: string;
  modules?: readonly string[];
  development?: boolean;
  mutable?: boolean;
}

export interface DshPluginManagementAdapter {
  list(moduleNames?: readonly string[]): Promise<{
    packages: readonly DshInstalledPluginPackage[];
    readOnly?: boolean;
  }>;
  installRegistry(spec: string): Promise<unknown>;
  installArchive(): Promise<unknown | null>;
  remove(packageName: string): Promise<unknown>;
  update(packageName: string): Promise<unknown>;
}

type PluginFilter = "running" | "disabled" | "failed";
type PluginSourceFilter = "all" | "internal" | "external";

function copy(language: PluginLanguage) {
  return language === "zh-CN"
    ? {
        title: "插件",
        description: "查看所有插件包的来源、运行状态和可用操作。",
        registryPlaceholder: "npm 包，例如 @scope/dsh-plugin-example@1.0.0",
        installRegistry: "从 npm 安装",
        installArchive: "安装本地 .tgz",
        readOnly:
          "开发连接期间暂不可安装、更新或移除插件；请先在连接终端按 Ctrl+C 断开。",
        updatePackage: "更新",
        reinstallArchive: "本地来源请重新安装新的 .tgz",
        removePackage: "移除",
        confirmRemove: "确认移除",
        cancel: "取消",
        invalidBundle: "未声明 dsh.bundle.patch",
        restarting: "正在更新 DSH Profile 并重启运行时…",
        search: "搜索模块或 Loader entry",
        refresh: "刷新插件清单",
        all: "全部",
        internal: "内部",
        external: "外部",
        development: "开发连接",
        provider: "提供方",
        source: "来源",
        running: "运行中",
        providers: {
          all: "全部提供方",
          dsh: "DSH 官方",
          amiba: "Amiba",
          "third-party": "第三方",
          unknown: "未知作者",
        },
        failed: "异常",
        enabled: "已启用",
        disabled: "已停用",
        empty: "没有匹配的插件",
        loading: "正在读取 DSH Loader…",
        retry: "重试",
        module: "模块",
        modules: "个模块",
        expand: "展开模块",
        collapse: "收起模块",
        entry: "Entry",
        phase: "生命周期",
        phases: {
          pending: "等待",
          loading: "加载中",
          active: "运行中",
          failed: "失败",
          unloading: "卸载中",
          none: "未挂载",
        },
      }
    : {
        title: "Plugins",
        description:
          "View all plugin packages, their source, runtime status and available actions.",
        registryPlaceholder:
          "npm package, e.g. @scope/dsh-plugin-example@1.0.0",
        installRegistry: "Install from npm",
        installArchive: "Install local .tgz",
        readOnly:
          "Install, update and remove are unavailable during development. Disconnect with Ctrl+C in the connection terminal first.",
        updatePackage: "Update",
        reinstallArchive: "Install a new .tgz to update this local source",
        removePackage: "Remove",
        confirmRemove: "Confirm removal",
        cancel: "Cancel",
        invalidBundle: "Missing dsh.bundle.patch",
        restarting: "Updating the DSH Profile and restarting runtime…",
        search: "Search module or Loader entry",
        refresh: "Refresh plugin inventory",
        all: "All",
        internal: "Internal",
        external: "External",
        development: "Development",
        provider: "Provider",
        source: "Source",
        running: "Running",
        providers: {
          all: "All providers",
          dsh: "DSH official",
          amiba: "Amiba",
          "third-party": "Third party",
          unknown: "Unknown author",
        },
        failed: "Issues",
        enabled: "Enabled",
        disabled: "Disabled",
        empty: "No matching plugins",
        loading: "Reading the DSH Loader…",
        retry: "Retry",
        module: "Module",
        modules: "modules",
        expand: "Expand modules",
        collapse: "Collapse modules",
        entry: "Entry",
        phase: "Lifecycle",
        phases: {
          pending: "Pending",
          loading: "Loading",
          active: "Active",
          failed: "Failed",
          unloading: "Unloading",
          none: "Not mounted",
        },
      };
}

function shortModuleName(moduleName: string): string {
  const segments = moduleName.split("/");
  return segments.at(-1) || moduleName;
}

function isRegistryDependencySpec(spec: string): boolean {
  const normalized = spec.trim();
  return (
    Boolean(normalized) &&
    !/^(?:file:|link:|workspace:|git(?:\+[^:]+)?:|github:|https?:|\.{0,2}[/\\]|[/\\])/iu.test(
      normalized,
    )
  );
}

function phaseClass(phase: DshPluginFiberPhase): string {
  if (phase === "active") return "bg-[hsl(var(--success))]";
  if (phase === "failed") return "bg-destructive";
  if (phase === "loading" || phase === "pending") return "bg-amber-500";
  return "bg-muted-foreground/45";
}

function phaseLabel(
  phase: DshPluginFiberPhase,
  labels: ReturnType<typeof copy>,
): string {
  return labels.phases[phase ?? "none"];
}

export function DshPluginInventoryView({
  adapter,
  active = true,
  panel,
}: {
  adapter: DshPluginInventoryAdapter;
  active?: boolean;
  panel?: { id: string; labelledBy: string };
}) {
  const { language } = usePluginT();
  const labels = copy(language);
  const [entries, setEntries] = useState<readonly DshPluginInventoryEntry[]>(
    [],
  );
  const [packages, setPackages] = useState<
    readonly DshInstalledPluginPackage[]
  >([]);
  const [query, setQuery] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [registrySpec, setRegistrySpec] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [providerFilter, setProviderFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState<PluginSourceFilter>("all");
  const [filter, setFilter] = useState<PluginFilter>("running");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutationError] = useState<string | null>(() =>
    sessionStorage.getItem("amiba:dsh-plugin-error"),
  );
  const [operation, setOperation] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  useEffect(() => {
    sessionStorage.removeItem("amiba:dsh-plugin-error");
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snapshot = await adapter.list();
      const managed = await (adapter.management?.list(
        snapshot.entries.map((entry) => entry.moduleName),
      ) ?? Promise.resolve({ packages: [], readOnly: false }));
      setEntries(snapshot.entries);
      setPackages(managed.packages);
      setReadOnly(managed.readOnly ?? false);
    } catch (cause) {
      setEntries([]);
      setPackages([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [adapter]);

  const mutate = useCallback(
    async (name: string, callback: () => Promise<unknown | null>) => {
      setOperation(name);
      setError(null);
      try {
        const result = await callback();
        if (result === null) {
          setOperation(null);
          return;
        }
        window.location.reload();
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        sessionStorage.setItem("amiba:dsh-plugin-error", message);
        window.location.reload();
      }
    },
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = useMemo(() => {
    const grouped = new Map<
      string,
      {
        moduleName: string;
        entries: DshPluginInventoryEntry[];
        item?: DshInstalledPluginPackage;
      }
    >();
    for (const entry of entries) {
      const packageName =
        packages.find((item) => item.modules?.includes(entry.moduleName))
          ?.packageName ??
        (entry.moduleName === "cordis:include"
          ? "@deepseek-ai/dsh-app-boot"
          : entry.moduleName
              .split("/")
              .slice(0, entry.moduleName.startsWith("@") ? 2 : 1)
              .join("/"));
      const row = grouped.get(packageName) ?? {
        moduleName: packageName,
        entries: [],
      };
      row.entries.push(entry);
      grouped.set(packageName, row);
    }
    for (const item of packages) {
      const row = grouped.get(item.packageName) ?? {
        moduleName: item.packageName,
        entries: [],
      };
      grouped.set(item.packageName, { ...row, item });
    }
    return [...grouped.values()].map((row) => ({
      ...row,
      provider: row.item?.provider ?? "unknown",
      source: row.item?.source ?? (row.item ? "external" : "internal"),
      entryId: row.entries.map((entry) => entry.entryId).join(", "),
      enabled:
        row.entries.length === 0 || row.entries.some((entry) => entry.enabled),
      fiberPhase:
        (["failed", "loading", "pending", "unloading", "active"] as const).find(
          (phase) =>
            row.entries.some(
              (entry) => entry.enabled && entry.fiberPhase === phase,
            ),
        ) ?? null,
    }));
  }, [entries, packages]);
  // Scope both the list and status counts by the same source/provider/search.
  const scopedRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return rows.filter((entry) => {
      if (
        (sourceFilter !== "all" && entry.source !== sourceFilter) ||
        (providerFilter !== "all" && entry.provider !== providerFilter)
      )
        return false;
      return (
        !needle ||
        `${entry.moduleName} ${entry.entryId} ${entry.entries.map((module) => module.moduleName).join(" ")} ${entry.item?.author ?? ""}`
          .toLocaleLowerCase()
          .includes(needle)
      );
    });
  }, [rows, sourceFilter, query, providerFilter]);
  // Disabled packages have no enabled entries. Pending/loading modules remain
  // in the enabled runtime group, while a failed enabled module takes priority.
  const statusOf = (entry: (typeof rows)[number]): PluginFilter =>
    !entry.enabled
      ? "disabled"
      : entry.fiberPhase === "failed"
        ? "failed"
        : "running";
  const counts = { running: 0, disabled: 0, failed: 0 };
  for (const entry of scopedRows) counts[statusOf(entry)]++;
  const filtered = scopedRows.filter((entry) => statusOf(entry) === filter);

  const filters: Array<{ id: PluginFilter; label: string }> = [
    { id: "running", label: labels.running },
    { id: "disabled", label: labels.disabled },
    { id: "failed", label: labels.failed },
  ];

  return (
    <ScrollArea
      className={cn("min-h-0 flex-1", !active && "hidden")}
      hidden={!active || undefined}
      {...(panel
        ? {
            id: panel.id,
            role: "tabpanel",
            "aria-labelledby": panel.labelledBy,
            tabIndex: 0,
          }
        : {})}
    >
      <PageContent size="lg">
        {active && (
          <SettingsPageActions>
            <SettingsPageActionButton
              aria-label={labels.refresh}
              disabled={loading}
              icon
              onClick={() => void refresh()}
              title={labels.refresh}
              variant="ghost"
            >
              <RefreshCw className={cn(loading && "animate-spin")} />
            </SettingsPageActionButton>
          </SettingsPageActions>
        )}
        <SettingsPageDescription className="mb-5 max-w-2xl">
          {labels.description}
        </SettingsPageDescription>

        {adapter.management ? (
          <div className="mb-5 space-y-3 rounded-lg border border-border/60 bg-muted/15 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={labels.registryPlaceholder}
                className="h-8 min-w-64 flex-1 text-xs"
                disabled={operation !== null || readOnly}
                onChange={(event) => setRegistrySpec(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    registrySpec.trim() &&
                    operation === null &&
                    !readOnly
                  ) {
                    void mutate("registry", () =>
                      adapter.management!.installRegistry(registrySpec.trim()),
                    );
                  }
                }}
                placeholder={labels.registryPlaceholder}
                value={registrySpec}
              />
              <Button
                className="h-8 gap-1.5 text-xs"
                disabled={
                  !registrySpec.trim() || operation !== null || readOnly
                }
                onClick={() =>
                  void mutate("registry", () =>
                    adapter.management!.installRegistry(registrySpec.trim()),
                  )
                }
                size="sm"
              >
                {operation === "registry" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {labels.installRegistry}
              </Button>
              <Button
                className="h-8 gap-1.5 text-xs"
                disabled={operation !== null || readOnly}
                onClick={() =>
                  void mutate("archive", () =>
                    adapter.management!.installArchive(),
                  )
                }
                size="sm"
                variant="outline"
              >
                {operation === "archive" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PackagePlus className="h-3.5 w-3.5" />
                )}
                {labels.installArchive}
              </Button>
            </div>

            {readOnly && (
              <p className="text-xs text-muted-foreground">{labels.readOnly}</p>
            )}
            {operation ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {labels.restarting}
              </p>
            ) : null}
          </div>
        ) : null}

        {mutationError ? (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 whitespace-pre-wrap break-words">
              {mutationError}
            </span>
          </div>
        ) : null}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={labels.search}
              className="h-8 pl-8 text-xs"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={labels.search}
              value={query}
            />
          </div>
          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger
              aria-label={labels.provider}
              className="h-8 w-32 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(labels.providers).map(([value, label]) => (
                <SelectItem className="text-xs" key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={sourceFilter}
            onValueChange={(value) =>
              setSourceFilter(value as PluginSourceFilter)
            }
          >
            <SelectTrigger
              aria-label={labels.source}
              className="h-8 w-24 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["all", "internal", "external"] as const).map((value) => (
                <SelectItem className="text-xs" key={value} value={value}>
                  {labels[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center rounded-md bg-muted/45 p-0.5">
            {filters.map((item) => (
              <button
                aria-pressed={filter === item.id}
                className={cn(
                  "h-7 rounded px-2.5 text-xs transition-colors",
                  filter === item.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                key={item.id}
                onClick={() => setFilter(item.id)}
                type="button"
              >
                {item.label}
                <span className="ml-1.5 tabular-nums opacity-60">
                  {counts[item.id]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {loading && entries.length === 0 ? (
          <CollectionState icon={<Loader2 className="animate-spin" />}>
            {labels.loading}
          </CollectionState>
        ) : error ? (
          <CollectionState icon={<CircleAlert />}>{error}</CollectionState>
        ) : filtered.length === 0 ? (
          <CollectionState icon={<Boxes />}>{labels.empty}</CollectionState>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border/60 bg-background">
            {filtered.map((entry, index) => (
              <div
                className={cn(
                  "grid grid-cols-[minmax(0,1.4fr)_minmax(9rem,0.8fr)_7rem] items-center gap-4 px-4 py-3",
                  index > 0 && "border-t border-border/50",
                )}
                key={entry.moduleName}
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        entry.enabled
                          ? phaseClass(entry.fiberPhase)
                          : "bg-muted-foreground/25",
                      )}
                    />
                    <button
                      type="button"
                      disabled={!entry.entries.length}
                      aria-expanded={expanded.has(entry.moduleName)}
                      aria-label={`${expanded.has(entry.moduleName) ? labels.collapse : labels.expand} ${entry.moduleName}`}
                      className="flex min-w-0 items-center gap-1 text-left text-sm font-medium"
                      onClick={() =>
                        setExpanded((previous) => {
                          const next = new Set(previous);
                          if (next.has(entry.moduleName))
                            next.delete(entry.moduleName);
                          else next.add(entry.moduleName);
                          return next;
                        })
                      }
                    >
                      {expanded.has(entry.moduleName) ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="truncate">
                        {shortModuleName(entry.moduleName)}
                      </span>
                    </button>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {labels[entry.source as "internal" | "external"]}
                    </span>
                    <span
                      title={entry.item?.author}
                      className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    >
                      {labels.providers[entry.provider]}
                      {entry.provider === "third-party" && entry.item?.author
                        ? ` · ${entry.item.author}`
                        : ""}
                    </span>
                    {entry.item?.development && (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {labels.development}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate pl-3.5 font-mono text-[10px] text-muted-foreground/75">
                    {entry.moduleName}
                  </p>
                </div>
                <div className="min-w-0">
                  {entry.item && (
                    <p
                      title={entry.item.requestedSpec}
                      className="truncate text-[10px] text-muted-foreground"
                    >
                      {entry.item.version ?? entry.item.requestedSpec}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {entry.entries.length} {labels.modules}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60">
                    {labels.phase}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-xs",
                      entry.fiberPhase === "failed"
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {entry.enabled
                      ? phaseLabel(entry.fiberPhase, labels)
                      : labels.disabled}
                  </p>
                </div>
                {expanded.has(entry.moduleName) && (
                  <div className="col-span-full space-y-2 border-t border-border/40 pt-3 pl-5">
                    {entry.entries.map((module) => (
                      <div
                        key={module.entryId}
                        className="flex min-w-0 items-center justify-between gap-4 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="break-all font-mono">
                            {module.moduleName}
                          </p>
                          <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
                            {module.entryId}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "shrink-0",
                            module.fiberPhase === "failed"
                              ? "text-destructive"
                              : "text-muted-foreground",
                          )}
                        >
                          {module.enabled
                            ? phaseLabel(module.fiberPhase, labels)
                            : labels.disabled}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {entry.item &&
                entry.source === "external" &&
                entry.item.mutable !== false &&
                !readOnly &&
                !entry.item.development &&
                adapter.management
                  ? (() => {
                      const item = entry.item;
                      return (
                        <div className="col-span-full flex justify-end">
                          {" "}
                          {confirmRemove === item.packageName ? (
                            <div className="flex items-center gap-1">
                              <Button
                                aria-label={labels.cancel}
                                className="h-7 w-7"
                                disabled={operation !== null || readOnly}
                                onClick={() => setConfirmRemove(null)}
                                size="icon"
                                variant="ghost"
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                className="h-7 text-[11px]"
                                disabled={operation !== null || readOnly}
                                onClick={() =>
                                  void mutate(
                                    `remove:${item.packageName}`,
                                    () =>
                                      adapter.management!.remove(
                                        item.packageName,
                                      ),
                                  )
                                }
                                size="sm"
                                variant="destructive"
                              >
                                {operation === `remove:${item.packageName}` ? (
                                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                ) : null}
                                {labels.confirmRemove}
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <Button
                                aria-label={`${labels.updatePackage} ${item.packageName}`}
                                className="h-7 text-[11px]"
                                disabled={
                                  operation !== null ||
                                  readOnly ||
                                  !item.bundle ||
                                  !isRegistryDependencySpec(item.requestedSpec)
                                }
                                onClick={() =>
                                  void mutate(
                                    `update:${item.packageName}`,
                                    () =>
                                      adapter.management!.update(
                                        item.packageName,
                                      ),
                                  )
                                }
                                size="sm"
                                title={
                                  isRegistryDependencySpec(item.requestedSpec)
                                    ? labels.updatePackage
                                    : labels.reinstallArchive
                                }
                                variant="ghost"
                              >
                                {operation === `update:${item.packageName}` ? (
                                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                                )}
                                {labels.updatePackage}
                              </Button>
                              <Button
                                aria-label={`${labels.removePackage} ${item.packageName}`}
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                disabled={operation !== null || readOnly}
                                onClick={() =>
                                  setConfirmRemove(item.packageName)
                                }
                                size="icon"
                                variant="ghost"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })()
                  : null}
              </div>
            ))}
          </div>
        )}
      </PageContent>
    </ScrollArea>
  );
}
