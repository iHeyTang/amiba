import {
  Boxes,
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
  cn,
} from "../primitives";
import { SettingsPageActions, SettingsPageDescription } from "./page-chrome";

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
}

export interface DshPluginManagementAdapter {
  list(): Promise<{ packages: readonly DshInstalledPluginPackage[] }>;
  installRegistry(spec: string): Promise<unknown>;
  installArchive(): Promise<unknown | null>;
  remove(packageName: string): Promise<unknown>;
  update(packageName: string): Promise<unknown>;
}

type PluginFilter = "all" | "amiba" | "dsh" | "failed";

function copy(language: PluginLanguage) {
  return language === "zh-CN"
    ? {
        title: "插件",
        description:
          "安装与运行都遵循 DSH Profile/Loader。下方状态来自当前 Loader，不维护另一套 Extension 注册表。",
        registryPlaceholder: "npm 包，例如 @scope/dsh-plugin-example@1.0.0",
        installRegistry: "从 npm 安装",
        installArchive: "安装本地 .tgz",
        installedPackages: "外部 DSH 包",
        noInstalledPackages: "尚未安装外部 DSH 包",
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
        amiba: "Amiba",
        dsh: "DSH",
        failed: "异常",
        enabled: "已启用",
        disabled: "已停用",
        empty: "没有匹配的插件",
        loading: "正在读取 DSH Loader…",
        retry: "重试",
        module: "模块",
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
          "Installation and runtime both follow the DSH Profile/Loader. Live state below comes from Loader, never a second Extension registry.",
        registryPlaceholder:
          "npm package, e.g. @scope/dsh-plugin-example@1.0.0",
        installRegistry: "Install from npm",
        installArchive: "Install local .tgz",
        installedPackages: "External DSH packages",
        noInstalledPackages: "No external DSH packages installed",
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
        amiba: "Amiba",
        dsh: "DSH",
        failed: "Issues",
        enabled: "Enabled",
        disabled: "Disabled",
        empty: "No matching plugins",
        loading: "Reading the DSH Loader…",
        retry: "Retry",
        module: "Module",
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
  headerActionsHost,
}: {
  adapter: DshPluginInventoryAdapter;
  headerActionsHost?: () => HTMLElement | null;
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
  const [registrySpec, setRegistrySpec] = useState("");
  const [filter, setFilter] = useState<PluginFilter>("all");
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
      const [snapshot, managed] = await Promise.all([
        adapter.list(),
        adapter.management?.list() ?? Promise.resolve({ packages: [] }),
      ]);
      setEntries(snapshot.entries);
      setPackages(managed.packages);
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

  const counts = useMemo(
    () => ({
      all: entries.length,
      amiba: entries.filter((entry) => entry.moduleName.startsWith("@amiba/"))
        .length,
      dsh: entries.filter((entry) =>
        entry.moduleName.startsWith("@deepseek-ai/"),
      ).length,
      failed: entries.filter(
        (entry) => entry.enabled && entry.fiberPhase === "failed",
      ).length,
    }),
    [entries],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return entries.filter((entry) => {
      const inFilter =
        filter === "all" ||
        (filter === "amiba" && entry.moduleName.startsWith("@amiba/")) ||
        (filter === "dsh" && entry.moduleName.startsWith("@deepseek-ai/")) ||
        (filter === "failed" && entry.enabled && entry.fiberPhase === "failed");
      if (!inFilter) return false;
      return (
        !needle ||
        `${entry.moduleName} ${entry.entryId}`
          .toLocaleLowerCase()
          .includes(needle)
      );
    });
  }, [entries, filter, query]);

  const filters: Array<{ id: PluginFilter; label: string }> = [
    { id: "all", label: labels.all },
    { id: "amiba", label: labels.amiba },
    { id: "dsh", label: labels.dsh },
    { id: "failed", label: labels.failed },
  ];

  return (
    <ScrollArea className="min-h-0 flex-1">
      <PageContent size="lg">
        <SettingsPageActions host={headerActionsHost}>
          <Button
            aria-label={labels.refresh}
            className="h-8 w-8 shrink-0"
            disabled={loading}
            onClick={() => void refresh()}
            size="icon"
            title={labels.refresh}
            variant="ghost"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </SettingsPageActions>
        <SettingsPageDescription className="mb-5 max-w-2xl">
          {labels.description}
        </SettingsPageDescription>

        {adapter.management ? (
          <div className="mb-5 space-y-3 rounded-lg border border-border/60 bg-muted/15 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={labels.registryPlaceholder}
                className="h-8 min-w-64 flex-1 text-xs"
                disabled={operation !== null}
                onChange={(event) => setRegistrySpec(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    registrySpec.trim() &&
                    operation === null
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
                disabled={!registrySpec.trim() || operation !== null}
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
                disabled={operation !== null}
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

            <div>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
                {labels.installedPackages}
              </p>
              {packages.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {labels.noInstalledPackages}
                </p>
              ) : (
                <div className="overflow-hidden rounded-md border border-border/50 bg-background">
                  {packages.map((item, index) => (
                    <div
                      className={cn(
                        "flex min-h-12 items-center gap-3 px-3 py-2",
                        index > 0 && "border-t border-border/45",
                      )}
                      key={item.packageName}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">
                          {item.packageName}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/70">
                          {item.version ?? item.requestedSpec}
                          {!item.bundle ? ` · ${labels.invalidBundle}` : ""}
                        </p>
                      </div>
                      {confirmRemove === item.packageName ? (
                        <div className="flex items-center gap-1">
                          <Button
                            aria-label={labels.cancel}
                            className="h-7 w-7"
                            disabled={operation !== null}
                            onClick={() => setConfirmRemove(null)}
                            size="icon"
                            variant="ghost"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            className="h-7 text-[11px]"
                            disabled={operation !== null}
                            onClick={() =>
                              void mutate(`remove:${item.packageName}`, () =>
                                adapter.management!.remove(item.packageName),
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
                              !item.bundle ||
                              !isRegistryDependencySpec(item.requestedSpec)
                            }
                            onClick={() =>
                              void mutate(`update:${item.packageName}`, () =>
                                adapter.management!.update(item.packageName),
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
                            disabled={operation !== null}
                            onClick={() => setConfirmRemove(item.packageName)}
                            size="icon"
                            variant="ghost"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
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
                key={entry.entryId}
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
                    <span className="truncate text-sm font-medium">
                      {shortModuleName(entry.moduleName)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate pl-3.5 font-mono text-[10px] text-muted-foreground/75">
                    {entry.moduleName}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60">
                    {labels.entry}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {entry.entryId}
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
              </div>
            ))}
          </div>
        )}
      </PageContent>
    </ScrollArea>
  );
}
