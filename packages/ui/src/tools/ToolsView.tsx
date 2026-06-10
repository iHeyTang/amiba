/**
 * Tools workspace — master/detail over the two real lanes:
 *
 *   ┌──────────┬─────────────────────────────────────────────┐
 *   │ ▾ Built-in (N)                                        │
 *   │ ▾ Installed (MCP) (N)                                 │
 *   │ search ↻ │ Detail header / tabs                       │
 *   └──────────┴─────────────────────────────────────────────┘
 *
 * Two lanes only:
 *  - **Built-in** — current ``platform_toolsets.cli`` rows from
 *    ``GET /hermes/tools/toolsets``. Detail pane is the live toolset
 *    view (Overview / Tools / Providers tabs + enable toggle).
 *  - **Installed (MCP)** — user-added MCP servers from
 *    ``mcp_servers`` in ``config.yaml`` via
 *    ``GET /hermes/tools/installed-mcps``. Detail pane shows the
 *    saved-record summary + CLI commands to manage.
 *
 * Discovery of new MCP servers is delegated entirely to the agent
 * (see the bundled ``mcp-discovery`` skill) — there is no marketplace
 * UI here. The agent searches Smithery / Glama / awesome-list when
 * the user asks for a capability the current toolset can't cover.
 */

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Key,
  Loader2,
  Package,
  Plug,
  RefreshCw,
  Search,
  Terminal,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  getHermesInstalledMcps,
  getHermesToolsetDetail,
  getHermesToolsets,
  putHermesToolsetToggle,
  type HermesInstalledMcp,
  type HermesToolItem,
  type HermesToolProvider,
  type HermesToolset,
  type HermesToolsetDetail,
} from "@amiba/core";
import { useT } from "@amiba/i18n";

import {
  Badge,
  cn,
  ScrollArea,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../primitives";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GroupId = "builtin" | "installedMcps";
type DetailTab = "overview" | "tools" | "providers";

type Selection =
  | { kind: "builtin"; name: string }
  | { kind: "installedMcp"; mcp: HermesInstalledMcp }
  | null;

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function ToolsView() {
  const { t } = useT();

  // ── Built-in toolsets (bundled with hermes-agent) ──────────────────────
  const [toolsets, setToolsets] = useState<HermesToolset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── User-installed MCP servers (config.yaml/mcp_servers) ───────────────
  const [installedMcps, setInstalledMcps] = useState<HermesInstalledMcp[]>([]);
  const [installedMcpsLoading, setInstalledMcpsLoading] = useState(false);

  // ── Selection + sidebar state ──────────────────────────────────────────
  const [selection, setSelection] = useState<Selection>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<GroupId, boolean>>({
    builtin: true,
    installedMcps: true,
  });

  // Per-row pending state — keyed by toolset name so toggling one row
  // doesn't disable switches on other rows mid-flight.
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [toggleError, setToggleError] = useState<string | null>(null);

  // ── Built-in detail pane state ─────────────────────────────────────────
  const [detail, setDetail] = useState<HermesToolsetDetail | null>(null);
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // ── Initial + manual refresh ───────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    setInstalledMcpsLoading(true);
    setError(null);
    const [tools, mcps] = await Promise.all([
      getHermesToolsets(),
      getHermesInstalledMcps(),
    ]);
    setLoading(false);
    setInstalledMcpsLoading(false);
    if (!tools.ok) {
      setError(tools.error || t("tools.loadFailed"));
      setToolsets([]);
    } else {
      setToolsets(tools.toolsets);
    }
    if (mcps.ok) setInstalledMcps(mcps.items);

    // Auto-select first built-in toolset on the very first successful load
    // (or if the previously-selected one disappeared — e.g. a plugin
    // unloaded). installedMcp selections are sticky.
    if (tools.ok) {
      setSelection((prev) => {
        if (
          prev?.kind === "builtin" &&
          tools.toolsets.some((ts) => ts.name === prev.name)
        ) {
          return prev;
        }
        if (prev?.kind === "installedMcp") return prev;
        const first = tools.toolsets[0];
        return first ? { kind: "builtin", name: first.name } : null;
      });
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ── Built-in toolset detail fetch on selection ─────────────────────────
  const detailSeq = useRef(0);
  useEffect(() => {
    if (selection?.kind !== "builtin") {
      setDetail(null);
      setDetailFor(null);
      setDetailError(null);
      return;
    }
    const name = selection.name;
    const seq = ++detailSeq.current;
    setDetailLoading(true);
    setDetailError(null);
    void getHermesToolsetDetail(name).then((r) => {
      if (seq !== detailSeq.current) return;
      setDetailLoading(false);
      if (!r.ok || !r.toolset) {
        setDetailError(r.error || t("tools.detail.loadFailed"));
        return;
      }
      setDetail(r.toolset);
      setDetailFor(r.toolset.name);
    });
  }, [selection, t]);

  // ── Toggle (built-in lane only) ────────────────────────────────────────
  const handleToggle = useCallback(
    async (toolsetName: string, next: boolean) => {
      setPending((prev) => new Set(prev).add(toolsetName));
      setToggleError(null);
      setToolsets((prev) =>
        prev.map((ts) =>
          ts.name === toolsetName
            ? { ...ts, enabled: next, available: next }
            : ts,
        ),
      );
      setDetail((prev) =>
        prev && prev.name === toolsetName
          ? { ...prev, enabled: next, available: next }
          : prev,
      );
      const r = await putHermesToolsetToggle(toolsetName, next);
      setPending((prev) => {
        const out = new Set(prev);
        out.delete(toolsetName);
        return out;
      });
      if (!r.ok) {
        setToolsets((prev) =>
          prev.map((ts) =>
            ts.name === toolsetName
              ? { ...ts, enabled: !next, available: !next }
              : ts,
          ),
        );
        setDetail((prev) =>
          prev && prev.name === toolsetName
            ? { ...prev, enabled: !next, available: !next }
            : prev,
        );
        setToggleError(r.error || t("tools.toggleFailed"));
      }
    },
    [t],
  );

  // ── Search filtering ───────────────────────────────────────────────────
  const q = searchQuery.trim().toLowerCase();
  const filteredBuiltin = useMemo(() => {
    if (!q) return toolsets;
    return toolsets.filter(
      (ts) =>
        ts.name.toLowerCase().includes(q) ||
        ts.label.toLowerCase().includes(q) ||
        ts.description.toLowerCase().includes(q),
    );
  }, [toolsets, q]);
  const filteredInstalledMcps = useMemo(() => {
    if (!q) return installedMcps;
    return installedMcps.filter(
      (m) =>
        m.slug.toLowerCase().includes(q) ||
        m.label.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q),
    );
  }, [installedMcps, q]);

  const toggleGroup = (g: GroupId) =>
    setExpanded((prev) => ({ ...prev, [g]: !prev[g] }));

  const clearSearch = () => setSearchQuery("");

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {(error || toggleError) && (
        <div className="flex shrink-0 items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-5 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{error || toggleError}</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ── Sidebar ───────────────────────────────────────────────── */}
        <aside className="flex min-h-0 w-72 shrink-0 flex-col border-r border-border bg-muted/15">
          <div className="flex shrink-0 items-center gap-1 px-2 py-1.5">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") clearSearch();
                }}
                placeholder={t("tools.search.placeholder")}
                className="h-7 w-full rounded bg-transparent pl-6 pr-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:bg-muted/40 focus:outline-none focus:ring-1 focus:ring-ring/40"
              />
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading || installedMcpsLoading}
              aria-label={t("common.refresh")}
              title={t("common.refresh")}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading || installedMcpsLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col pb-2">
              {/* Built-in group — bundled toolset families. */}
              <SidebarGroup
                id="builtin"
                icon={<Package className="h-3 w-3" />}
                label={t("tools.group.builtin")}
                count={filteredBuiltin.length}
                expanded={expanded.builtin}
                onToggle={() => toggleGroup("builtin")}
              >
                {loading && toolsets.length === 0 ? (
                  <GroupLoading />
                ) : filteredBuiltin.length === 0 ? (
                  <GroupEmpty
                    text={
                      toolsets.length === 0
                        ? t("tools.empty")
                        : t("tools.search.empty")
                    }
                  />
                ) : (
                  <ul>
                    {filteredBuiltin.map((ts) => (
                      <BuiltinRow
                        key={ts.name}
                        toolset={ts}
                        selected={
                          selection?.kind === "builtin" &&
                          selection.name === ts.name
                        }
                        onSelect={() =>
                          setSelection({ kind: "builtin", name: ts.name })
                        }
                      />
                    ))}
                  </ul>
                )}
              </SidebarGroup>

              {/* Installed MCP group — user-added servers. */}
              <SidebarGroup
                id="installedMcps"
                icon={<Plug className="h-3 w-3" />}
                label={t("tools.group.installedMcps")}
                count={filteredInstalledMcps.length}
                expanded={expanded.installedMcps}
                onToggle={() => toggleGroup("installedMcps")}
              >
                {installedMcpsLoading && installedMcps.length === 0 ? (
                  <GroupLoading />
                ) : filteredInstalledMcps.length === 0 ? (
                  <GroupEmpty
                    text={
                      installedMcps.length === 0
                        ? t("tools.installedMcps.empty")
                        : t("tools.search.empty")
                    }
                  />
                ) : (
                  <ul>
                    {filteredInstalledMcps.map((mcp) => (
                      <InstalledMcpRow
                        key={mcp.slug}
                        mcp={mcp}
                        selected={
                          selection?.kind === "installedMcp" &&
                          selection.mcp.slug === mcp.slug
                        }
                        onSelect={() =>
                          setSelection({ kind: "installedMcp", mcp })
                        }
                      />
                    ))}
                  </ul>
                )}
              </SidebarGroup>
            </div>
          </ScrollArea>
        </aside>

        {/* ── Detail pane ─────────────────────────────────────────── */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selection === null ? (
            <EmptyDetail />
          ) : selection.kind === "builtin" ? (
            <BuiltinDetailPane
              name={selection.name}
              detail={
                detail && detailFor === selection.name ? detail : null
              }
              loading={detailLoading && detailFor !== selection.name}
              error={detailError}
              pending={pending.has(selection.name)}
              onToggle={(next) => void handleToggle(selection.name, next)}
            />
          ) : (
            <InstalledMcpDetailPane mcp={selection.mcp} />
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar — groups + rows
// ---------------------------------------------------------------------------

function SidebarGroup({
  icon,
  label,
  count,
  expanded,
  onToggle,
  children,
}: {
  id: GroupId;
  icon: ReactNode;
  label: string;
  count?: number;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border/30 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <span aria-hidden className="text-muted-foreground/70">
          {icon}
        </span>
        <span className="flex-1 text-left">{label}</span>
        {typeof count === "number" && (
          <span className="text-[10px] font-normal text-muted-foreground/60">
            {count}
          </span>
        )}
      </button>
      {expanded && <div className="pb-1">{children}</div>}
    </section>
  );
}

function GroupLoading() {
  const { t } = useT();
  return (
    <div className="flex items-center justify-center py-4 text-[11px] text-muted-foreground">
      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
      {t("common.loading")}
    </div>
  );
}

function GroupEmpty({ text }: { text: string }) {
  return (
    <p className="px-3 py-2 text-[11px] text-muted-foreground/70">{text}</p>
  );
}

function BuiltinRow({
  toolset,
  selected,
  onSelect,
}: {
  toolset: HermesToolset;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useT();
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "group flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors",
          selected
            ? "bg-foreground/10 text-foreground"
            : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
        )}
      >
        {/* Enabled indicator: solid dot when on, hollow ring when off.
            Single pixel of enabled-state — the actual toggle lives in
            the detail header so the sidebar stays a pure navigator. */}
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            toolset.enabled
              ? "bg-emerald-500"
              : "border border-muted-foreground/40",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium">
              {toolset.label || toolset.name}
            </span>
            {!toolset.configured && toolset.enabled && (
              <AlertCircle
                className="h-3 w-3 shrink-0 text-amber-500"
                aria-label={t("tools.badge.notConfigured")}
              />
            )}
          </div>
          {toolset.description && (
            <p className="truncate text-[10px] text-muted-foreground/70">
              {toolset.description}
            </p>
          )}
        </div>
      </button>
    </li>
  );
}

function InstalledMcpRow({
  mcp,
  selected,
  onSelect,
}: {
  mcp: HermesInstalledMcp;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "group flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors",
          selected
            ? "bg-foreground/10 text-foreground"
            : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            mcp.enabled
              ? "bg-emerald-500"
              : "border border-muted-foreground/40",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium">{mcp.label}</span>
            {mcp.transport_kind && (
              <span className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground/70">
                {mcp.transport_kind}
              </span>
            )}
          </div>
          {mcp.description && (
            <p className="truncate text-[10px] text-muted-foreground/70">
              {mcp.description}
            </p>
          )}
        </div>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Detail pane — built-in toolsets
// ---------------------------------------------------------------------------

function EmptyDetail() {
  const { t } = useT();
  return (
    <div className="flex h-full items-center justify-center px-6">
      <p className="max-w-sm text-center text-xs text-muted-foreground">
        {t("tools.detail.placeholder")}
      </p>
    </div>
  );
}

function BuiltinDetailPane({
  name,
  detail,
  loading,
  error,
  pending,
  onToggle,
}: {
  name: string;
  detail: HermesToolsetDetail | null;
  loading: boolean;
  error: string | null;
  pending: boolean;
  onToggle: (next: boolean) => void;
}) {
  const { t } = useT();
  const [tab, setTab] = useState<DetailTab>("overview");

  useEffect(() => {
    setTab("overview");
  }, [name]);

  const hasProviders = !!detail?.has_category;
  useEffect(() => {
    if (tab === "providers" && !hasProviders) setTab("overview");
  }, [tab, hasProviders]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BuiltinDetailHeader
        name={name}
        detail={detail}
        pending={pending}
        onToggle={onToggle}
      />

      {error && (
        <div className="flex shrink-0 items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-5 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
        </div>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as DetailTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-border/60 px-5 py-2">
          <TabsList className="h-7 gap-1 bg-transparent p-0">
            <TabsTrigger
              value="overview"
              className="h-7 rounded px-2 text-[11px] data-[state=active]:bg-muted data-[state=active]:shadow-none"
            >
              {t("tools.detail.tab.overview")}
            </TabsTrigger>
            <TabsTrigger
              value="tools"
              className="h-7 rounded px-2 text-[11px] data-[state=active]:bg-muted data-[state=active]:shadow-none"
            >
              {t("tools.detail.tab.tools")}
              {detail && (
                <span className="ml-1 text-[10px] text-muted-foreground/80">
                  {detail.items.length}
                </span>
              )}
            </TabsTrigger>
            {hasProviders && (
              <TabsTrigger
                value="providers"
                className="h-7 rounded px-2 text-[11px] data-[state=active]:bg-muted data-[state=active]:shadow-none"
              >
                {t("tools.detail.tab.providers")}
                {detail && (
                  <span className="ml-1 text-[10px] text-muted-foreground/80">
                    {detail.providers.length}
                  </span>
                )}
              </TabsTrigger>
            )}
          </TabsList>
          {loading && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <TabsContent value="overview" className="mt-0 px-5 py-4">
            {detail ? <OverviewTab detail={detail} /> : <DetailSkeleton />}
          </TabsContent>
          <TabsContent value="tools" className="mt-0 px-5 py-4">
            {detail ? <ToolsTab items={detail.items} /> : <DetailSkeleton />}
          </TabsContent>
          {hasProviders && (
            <TabsContent value="providers" className="mt-0 px-5 py-4">
              {detail ? (
                <ProvidersTab providers={detail.providers} />
              ) : (
                <DetailSkeleton />
              )}
            </TabsContent>
          )}
        </ScrollArea>
      </Tabs>
    </div>
  );
}

function BuiltinDetailHeader({
  name,
  detail,
  pending,
  onToggle,
}: {
  name: string;
  detail: HermesToolsetDetail | null;
  pending: boolean;
  onToggle: (next: boolean) => void;
}) {
  const { t } = useT();
  const label = detail?.label || name;
  const enabled = detail?.enabled ?? false;
  return (
    <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold tracking-tight">
            {label}
          </h3>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              enabled
                ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-300"
                : "border-border text-muted-foreground",
            )}
          >
            {enabled ? t("common.enabled") : t("common.disabled")}
          </Badge>
          {detail && !detail.configured && enabled && (
            <Badge
              variant="outline"
              className="border-amber-500/40 text-[10px] text-amber-600 dark:text-amber-300"
            >
              {t("tools.badge.notConfigured")}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
          {name}
        </p>
        {detail?.description && (
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
            {detail.description}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        {pending && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          disabled={pending || !detail}
          aria-label={t(
            enabled ? "tools.toggle.disable" : "tools.toggle.enable",
            { name: label },
          )}
        />
      </div>
    </header>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-2 py-2">
      <div className="h-3 w-1/3 animate-pulse rounded bg-muted/60" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-muted/40" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-muted/40" />
    </div>
  );
}

function OverviewTab({ detail }: { detail: HermesToolsetDetail }) {
  const { t } = useT();
  return (
    <div className="space-y-4">
      <DefinitionList
        rows={[
          {
            label: t("tools.detail.overview.status"),
            value: detail.enabled ? (
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-300">
                <CheckCircle2 className="h-3 w-3" />
                {t("common.enabled")}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {t("common.disabled")}
              </span>
            ),
          },
          {
            label: t("tools.detail.overview.configured"),
            value: detail.configured ? (
              <span className="text-emerald-600 dark:text-emerald-300">
                {t("tools.detail.provider.configured")}
              </span>
            ) : (
              <span className="text-amber-600 dark:text-amber-300">
                {t("tools.detail.provider.missingKeys")}
              </span>
            ),
          },
          {
            label: t("tools.detail.overview.toolCount"),
            value: <span>{detail.items.length}</span>,
          },
          {
            label: t("tools.detail.overview.providerCount"),
            value: detail.has_category ? (
              <span>{detail.providers.length}</span>
            ) : (
              <span className="text-muted-foreground/70">
                {t("tools.detail.overview.noProviders")}
              </span>
            ),
          },
        ]}
      />
      <p className="text-[11px] text-muted-foreground/80">
        {t("tools.detail.overview.persistsHint")}
      </p>
    </div>
  );
}

function DefinitionList({
  rows,
}: {
  rows: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="divide-y divide-border/40 rounded-md border border-border/60">
      {rows.map((row, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-4 px-3 py-2 text-[11px]"
        >
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="text-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ToolsTab({ items }: { items: HermesToolItem[] }) {
  const { t } = useT();
  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("tools.detail.tools.empty")}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border/40 rounded-md border border-border/60">
      {items.map((item) => (
        <ToolItemRow key={item.name} item={item} />
      ))}
    </ul>
  );
}

function ToolItemRow({ item }: { item: HermesToolItem }) {
  return (
    <li className="flex items-start gap-3 px-3 py-2">
      {item.emoji ? (
        <span aria-hidden className="text-sm leading-tight">
          {item.emoji}
        </span>
      ) : (
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[12px] text-foreground">
          {item.name}
        </p>
        {item.description && (
          <p className="mt-0.5 line-clamp-3 text-[11px] leading-snug text-muted-foreground">
            {item.description}
          </p>
        )}
      </div>
    </li>
  );
}

function ProvidersTab({ providers }: { providers: HermesToolProvider[] }) {
  const { t } = useT();
  if (providers.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("tools.detail.providers.empty")}
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {providers.map((prov) => (
        <ProviderRow key={prov.name} provider={prov} />
      ))}
    </ul>
  );
}

function ProviderRow({ provider }: { provider: HermesToolProvider }) {
  const { t } = useT();
  const allSet =
    provider.env_vars.length > 0 && provider.env_vars.every((v) => v.is_set);
  const noKeys = provider.env_vars.length === 0;
  return (
    <li className="rounded-md border border-border/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <Key className="h-3 w-3 text-muted-foreground/70" />
        <span className="text-xs font-medium text-foreground">
          {provider.name}
        </span>
        {provider.badge && (
          <Badge variant="outline" className="text-[10px]">
            {provider.badge}
          </Badge>
        )}
        {provider.tag && (
          <span className="text-[10px] text-muted-foreground/70">
            {provider.tag}
          </span>
        )}
        <span className="ml-auto">
          {noKeys ? (
            <Badge
              variant="outline"
              className="border-sky-500/40 text-[10px] text-sky-700 dark:text-sky-300"
            >
              {t("tools.detail.provider.noKeysNeeded")}
            </Badge>
          ) : allSet ? (
            <Badge
              variant="outline"
              className="border-emerald-500/40 text-[10px] text-emerald-600 dark:text-emerald-300"
            >
              {t("tools.detail.provider.configured")}
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-amber-500/40 text-[10px] text-amber-600 dark:text-amber-300"
            >
              {t("tools.detail.provider.missingKeys")}
            </Badge>
          )}
        </span>
      </div>
      {provider.env_vars.length > 0 && (
        <ul className="mt-2 space-y-1">
          {provider.env_vars.map((v) => (
            <li
              key={v.key ?? v.prompt ?? Math.random().toString(36)}
              className="flex items-center justify-between gap-2 text-[11px]"
            >
              <span className="font-mono text-foreground/80">
                {v.key ?? v.prompt}
              </span>
              <span
                className={cn(
                  "shrink-0 text-[10px]",
                  v.is_set
                    ? "text-emerald-600 dark:text-emerald-300"
                    : "text-amber-600 dark:text-amber-300",
                )}
              >
                {v.is_set
                  ? t("tools.detail.envVar.set")
                  : t("tools.detail.envVar.missing")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Detail pane — installed MCP servers
// ---------------------------------------------------------------------------

function InstalledMcpDetailPane({ mcp }: { mcp: HermesInstalledMcp }) {
  const { t } = useT();
  const sourceLabel =
    mcp.source === "curated"
      ? t("tools.installedMcp.curated")
      : t("tools.installedMcp.manual");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <header className="flex shrink-0 items-start gap-4 border-b border-border/60 px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold tracking-tight">
              {mcp.label}
            </h3>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                mcp.enabled
                  ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-300"
                  : "border-border text-muted-foreground",
              )}
            >
              {mcp.enabled ? t("common.enabled") : t("common.disabled")}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {sourceLabel}
            </Badge>
            {mcp.transport_kind && (
              <Badge variant="outline" className="text-[10px]">
                {mcp.transport_kind}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
            {mcp.slug}
          </p>
          {mcp.description && (
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              {mcp.description}
            </p>
          )}
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 px-5 py-4">
          <DefinitionList
            rows={[
              {
                label: t("tools.detail.overview.status"),
                value: mcp.enabled ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" />
                    {t("common.enabled")}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {t("common.disabled")}
                  </span>
                ),
              },
              {
                label: t("tools.installedMcp.source"),
                value: <span>{sourceLabel}</span>,
              },
              ...(mcp.transport_kind
                ? [
                    {
                      label: t("tools.installedMcp.transport"),
                      value: (
                        <span className="font-mono">{mcp.transport_kind}</span>
                      ),
                    },
                  ]
                : []),
            ]}
          />

          <section>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Terminal className="h-3 w-3" />
              {t("tools.installedMcp.cliHeading")}
            </h3>
            <p className="mb-2 text-[11px] leading-snug text-muted-foreground/80">
              {t("tools.installedMcp.cliHint")}
            </p>
            <ul className="space-y-1.5">
              {[
                `hermes mcp test ${mcp.slug}`,
                `hermes mcp configure ${mcp.slug}`,
                `hermes mcp remove ${mcp.slug}`,
              ].map((cmd) => (
                <li
                  key={cmd}
                  className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5"
                >
                  <code className="font-mono text-[11px] text-foreground">
                    {cmd}
                  </code>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
