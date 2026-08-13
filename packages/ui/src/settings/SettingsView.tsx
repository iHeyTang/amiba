import {
  Activity,
  Bot,
  Boxes,
  BrainCircuit,
  Cable,
  ChevronDown,
  ChevronRight,
  Code2,
  FilePlus2,
  FileText,
  Fingerprint,
  GitMerge,
  Globe,
  Home,
  Keyboard,
  Mic,
  MessagesSquare,
  Palette,
  RefreshCw,
  UserRound,
  Wallet,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getPlatform } from "@amiba/platform";
import type { ToolActivitySource } from "@amiba/core";

import {
  ExtensionWebView,
  useExtensionSettings,
} from "@amiba/extension-host/renderer";
import { resolveExtensionIcon } from "../chat/Sidebar";

import { useT } from "@amiba/i18n";
import { useResolvedTheme } from "../theme";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  AmibaLogo,
  Input,
  Label,
  PageContent,
  ScrollArea,
} from "../primitives";

import type { OptionsCapabilities, UserScriptSummary } from "./capabilities";
import { HermesModelConfigTab } from "./HermesModelConfigTab";
import { OPTIONS_SHELL_HEADER_ROW } from "./optionsPageChrome";
import { ScriptEditor } from "./ScriptEditor";
import { ScriptList } from "./ScriptList";
import { SettingsLogs, type SettingsLogSource } from "./SettingsLogs";
import { SettingsMemory } from "./SettingsMemory";
import { SettingsMessaging } from "./SettingsMessaging";
import { SettingsAgents } from "./SettingsAgents";
import { SettingsAssistantBehavior } from "./AgentBehaviorEditor";
import { SettingsPaneHeader, SettingsPaneProvider } from "./SettingsPaneHeader";
import { AgentTaskProvider } from "./agent-task";
import { SettingsAppearance, SettingsShortcuts } from "./SettingsPreferences";
import { SettingsStatus } from "./SettingsStatus";
import { SettingsVoice } from "./SettingsVoice";
import { TokensPage, ToolsPage } from "../usage";
import {
  NavigationGroupLabel,
  NavigationRow,
} from "../navigation/NavigationRow";
import { APP_SIDEBAR_DEFAULT_WIDTH } from "../navigation/sidebar-layout";

/**
 * Settings follows the product's real concepts rather than an "advanced"
 * catch-all:
 *   General:     Appearance → Shortcuts → Voice → Usage
 *   Assistant:   Behavior & identity → Models & services
 *                → Multi-model collaboration → Tools → Memory
 *   Applets:      Userscripts → contributed panes
 *   Advanced:    Agent workspaces (including per-agent model collaboration)
 *                → Status → Connection → Logs
 */
const ALL_TABS = [
  "status",
  "appearance",
  "shortcuts",
  "scripts",
  "behavior",
  "models",
  "multi-model-collaboration",
  "connection",
  "agents",
  "tokens",
  "tools",
  "memory",
  "messaging",
  "voice",
  "logs",
] as const;

/**
 * Panes that were merged away keep their old hash ids working:
 *   gateway → connection, browser → tools (rail entry),
 * Capability extensions moved to the main workspace and no longer alias to a
 * settings pane.
 */
const TAB_ALIASES: Record<string, (typeof ALL_TABS)[number]> = {
  gateway: "connection",
  "model-orchestration": "multi-model-collaboration",
  "virtual-capabilities": "multi-model-collaboration",
  browser: "tools",
};
type CoreTab = (typeof ALL_TABS)[number];
/** MainTab is widened to string so extension tab IDs are also accepted. */
type MainTab = CoreTab | (string & {});

const TAB_SET = new Set<string>(ALL_TABS);

function isAdvancedSettingsTab(tab: MainTab): boolean {
  return (
    tab === "agents" ||
    tab === "status" ||
    tab === "connection" ||
    tab === "logs"
  );
}

function mainTabFromLocation(): MainTab {
  const raw =
    typeof window !== "undefined"
      ? window.location.hash.replace(/^#/, "").split("?")[0]
      : "";
  if (raw && TAB_SET.has(raw)) {
    return raw as MainTab;
  }
  if (raw && TAB_ALIASES[raw]) {
    return TAB_ALIASES[raw];
  }
  if (raw === "settings") {
    return "preference";
  }
  if (raw === "hermes-model") {
    return "models";
  }
  return "appearance";
}

function logSourceFromLocation(): SettingsLogSource {
  if (typeof window === "undefined") return "agent";
  const query = window.location.hash.replace(/^#/, "").split("?")[1];
  const source = new URLSearchParams(query ?? "").get("source");
  if (
    source === "errors" ||
    source === "gateway" ||
    source === "hermes-update"
  ) {
    return source;
  }
  return "agent";
}

function logsHash(source: SettingsLogSource): string {
  return source === "agent" ? "#logs" : `#logs?source=${source}`;
}

export interface SettingsViewProps {
  /**
   * Extension supplies userscripts + bridge implementations; desktop omits.
   * When `userscripts` is absent, the "Scripts" tab hides entirely.
   * When `bridge` is absent, SettingsGateway's "refresh bridge" call no-ops.
   */
  capabilities?: OptionsCapabilities;
  /**
   * Optional — when provided, the sidebar's top-left Hermes logo + title
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
   * Desktop-injected source for the local tool-activity ledger (backs
   * the Tools pane's Activity view). Hosts without a main-process
   * recorder omit it and the view shows its empty state.
   */
  toolActivitySource?: ToolActivitySource;
}

export function SettingsView({
  capabilities = {},
  onGoHome,
  sidebarHeaderLeftInset = 0,
  sidebarHeaderHeightPx = 40,
  sidebarHeaderClassName,
  paneHeaderClassName,
  paneHeaderChromeHeightPx,
  toolActivitySource,
}: SettingsViewProps = {}) {
  useResolvedTheme();
  const { t } = useT();

  const showScriptsTab = !!capabilities.userscripts;
  const isDesktop = getPlatform().kind === "desktop";
  const extensionSettings = useExtensionSettings();

  const [mainTab, setMainTab] = useState<MainTab>(() => {
    const fromHash = mainTabFromLocation();
    // Don't land on scripts tab if the capability isn't available.
    if (fromHash === "scripts" && !showScriptsTab) return "appearance";
    return fromHash;
  });
  const [logsSource, setLogsSource] = useState<SettingsLogSource>(() =>
    logSourceFromLocation(),
  );
  const [advancedOpen, setAdvancedOpen] = useState(() => {
    return isAdvancedSettingsTab(mainTabFromLocation());
  });

  const [scripts, setScripts] = useState<UserScriptSummary[]>([]);
  const [editing, setEditing] = useState<UserScriptSummary | null>(null);
  const [editingSource, setEditingSource] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [installUrl, setInstallUrl] = useState("");
  const [installOpen, setInstallOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userscripts = capabilities.userscripts;

  const refresh = useCallback(async () => {
    if (!userscripts) return;
    const r = await userscripts.list();
    if (Array.isArray(r.scripts)) setScripts(r.scripts);
  }, [userscripts]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onHash = () => {
      const t = mainTabFromLocation();
      if (t === "logs") setLogsSource(logSourceFromLocation());
      if (t === "scripts" && !showScriptsTab) setMainTab("appearance");
      else setMainTab(t);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [showScriptsTab]);

  useEffect(() => {
    setAdvancedOpen(isAdvancedSettingsTab(mainTab));
  }, [mainTab]);

  function toggleAdvancedSettings() {
    setAdvancedOpen((value) => !value);
  }

  function onMainTabChange(v: string) {
    // Accept core tabs, featured-feature IDs, extension tab IDs (not in
    // TAB_SET), or fall back to "status".
    const isExtensionTab = extensionSettings.some((s) => s.extensionId === v);
    const next: MainTab =
      TAB_SET.has(v) || isExtensionTab ? v : (TAB_ALIASES[v] ?? "appearance");
    if (next === "scripts" && !showScriptsTab) return;
    setMainTab(next);
    if (!isAdvancedSettingsTab(next)) setAdvancedOpen(false);
    const base = window.location.pathname + window.location.search;
    if (next === "scripts") {
      window.history.replaceState(null, "", base);
    } else {
      window.history.replaceState(
        null,
        "",
        next === "logs" ? `${base}${logsHash(logsSource)}` : `${base}#${next}`,
      );
    }
  }

  function showLogs(source: SettingsLogSource) {
    setLogsSource(source);
    setMainTab("logs");
    const base = window.location.pathname + window.location.search;
    window.history.replaceState(null, "", `${base}${logsHash(source)}`);
  }

  function onLogSourceChange(source: SettingsLogSource) {
    setLogsSource(source);
    const base = window.location.pathname + window.location.search;
    window.history.replaceState(null, "", `${base}${logsHash(source)}`);
  }

  async function onToggle(id: string, enabled: boolean) {
    if (!userscripts) return;
    await userscripts.setEnabled(id, enabled);
    void refresh();
  }

  async function onRemove(id: string) {
    if (!userscripts) return;
    if (!confirm(t("options.scripts.removeConfirm"))) return;
    await userscripts.remove(id);
    void refresh();
  }

  async function onEdit(id: string) {
    if (!userscripts) return;
    const r = await userscripts.get(id);
    if (r.script) {
      setEditing(r.script);
      setEditingSource(r.script.source);
    }
  }

  async function onSaveEdit(source: string) {
    if (!userscripts || !editing) return;
    setBusy(true);
    try {
      const r = await userscripts.save({ id: editing.id, source });
      if (!r.ok) throw new Error(r.error || "save failed");
      setEditing(null);
      setEditingSource("");
      void refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onCreateNew(source: string) {
    if (!userscripts) return;
    setBusy(true);
    setError(null);
    try {
      const r = await userscripts.installFromSource(source);
      if (!r.ok) throw new Error(r.error || "create failed");
      setCreating(false);
      void refresh();
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function onInstallFromUrl() {
    if (!userscripts) return;
    if (!installUrl.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await userscripts.installFromUrl(installUrl.trim());
      if (!r.ok) throw new Error(r.error || "install failed");
      setInstallOpen(false);
      setInstallUrl("");
      void refresh();
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsPaneProvider
      className={paneHeaderClassName}
      chromeHeightPx={paneHeaderChromeHeightPx}
    >
      <AgentTaskProvider
        value={capabilities.startAgentTask}
        managedApps={capabilities.managedApps}
      >
        <div className="flex h-screen min-h-0 w-full overflow-hidden bg-background text-foreground">
          <aside
            data-testid="settings-sidebar"
            className="flex min-h-0 shrink-0 flex-col bg-muted/30"
            style={{ width: APP_SIDEBAR_DEFAULT_WIDTH }}
          >
            {onGoHome ? (
              /*
               * Desktop sidebar chrome remains a passive drag region. The
               * actual Home destination belongs to the navigation list below,
               * where it behaves like every other sidebar destination.
               */
              <div
                className={`shrink-0 ${sidebarHeaderClassName ?? ""}`}
                style={{
                  height: sidebarHeaderHeightPx,
                  paddingLeft: Math.max(sidebarHeaderLeftInset, 12),
                }}
              />
            ) : (
              <div className={`${OPTIONS_SHELL_HEADER_ROW} gap-2.5 px-3`}>
                <AmibaLogo size={28} className="shrink-0" />
                <p className="truncate text-sm font-semibold tracking-tight">
                  {t("app.title")}
                </p>
              </div>
            )}
            <ScrollArea className="min-h-0 flex-1">
              <nav className="flex flex-col gap-0.5 p-2">
                {onGoHome ? (
                  <NavBtn
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
                <NavBtn
                  icon={<Palette className="h-4 w-4 shrink-0 opacity-70" />}
                  label={t("options.nav.appearance")}
                  active={mainTab === "appearance"}
                  onClick={() => onMainTabChange("appearance")}
                />
                {isDesktop && (
                  <NavBtn
                    icon={<Keyboard className="h-4 w-4 shrink-0 opacity-70" />}
                    label={t("options.nav.shortcuts")}
                    active={mainTab === "shortcuts"}
                    onClick={() => onMainTabChange("shortcuts")}
                  />
                )}
                <NavBtn
                  icon={<Mic className="h-4 w-4 shrink-0 opacity-70" />}
                  label={t("options.nav.voice")}
                  active={mainTab === "voice"}
                  onClick={() => onMainTabChange("voice")}
                />
                <NavBtn
                  icon={<Wallet className="h-4 w-4 shrink-0 opacity-70" />}
                  label={t("options.nav.tokens")}
                  active={mainTab === "tokens"}
                  onClick={() => onMainTabChange("tokens")}
                />

                {/* ── Assistant — everyday behavior and model defaults ── */}
                <NavigationGroupLabel className="mt-2">
                  {t("options.nav.section.agent")}
                </NavigationGroupLabel>
                <NavBtn
                  icon={<Fingerprint className="h-4 w-4 shrink-0 opacity-70" />}
                  label={t("options.agents.section.behavior")}
                  active={mainTab === "behavior"}
                  onClick={() => onMainTabChange("behavior")}
                />
                <NavBtn
                  icon={<Bot className="h-4 w-4 shrink-0 opacity-70" />}
                  label={t("options.models.config.navTitle")}
                  active={mainTab === "models"}
                  onClick={() => onMainTabChange("models")}
                />
                <NavBtn
                  icon={<GitMerge className="h-4 w-4 shrink-0 opacity-70" />}
                  label={t("options.models.virtual.navTitle")}
                  active={mainTab === "multi-model-collaboration"}
                  onClick={() => onMainTabChange("multi-model-collaboration")}
                />
                <NavBtn
                  icon={<Wrench className="h-4 w-4 shrink-0 opacity-70" />}
                  label={t("options.nav.tools")}
                  active={mainTab === "tools"}
                  onClick={() => onMainTabChange("tools")}
                />
                <NavBtn
                  icon={
                    <BrainCircuit className="h-4 w-4 shrink-0 opacity-70" />
                  }
                  label={t("options.nav.memory")}
                  active={mainTab === "memory"}
                  onClick={() => onMainTabChange("memory")}
                />
                <NavBtn
                  icon={
                    <MessagesSquare className="h-4 w-4 shrink-0 opacity-70" />
                  }
                  label={t("options.nav.messaging")}
                  active={mainTab === "messaging"}
                  onClick={() => onMainTabChange("messaging")}
                />

                {showScriptsTab || extensionSettings.length > 0 ? (
                  <>
                    <NavigationGroupLabel className="mt-2">
                      {t("options.nav.section.extensions")}
                    </NavigationGroupLabel>
                    {showScriptsTab ? (
                      <NavBtn
                        icon={<Code2 className="h-4 w-4 shrink-0 opacity-70" />}
                        label={t("options.nav.scripts")}
                        active={mainTab === "scripts"}
                        onClick={() => onMainTabChange("scripts")}
                      />
                    ) : null}
                    {extensionSettings.map((s) => (
                      <NavBtn
                        key={s.extensionId}
                        icon={
                          (s.icon ? resolveExtensionIcon(s.icon) : null) ?? (
                            <Boxes className="h-4 w-4 shrink-0 opacity-70" />
                          )
                        }
                        label={s.label}
                        active={mainTab === s.extensionId}
                        onClick={() => onMainTabChange(s.extensionId)}
                      />
                    ))}
                  </>
                ) : null}

                {/* ── Advanced — hidden until a user needs scoped agents ── */}
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
                    <NavBtn
                      icon={
                        <UserRound className="h-4 w-4 shrink-0 opacity-70" />
                      }
                      label={t("options.nav.agents")}
                      active={mainTab === "agents"}
                      onClick={() => onMainTabChange("agents")}
                    />
                    <NavBtn
                      icon={
                        <Activity className="h-4 w-4 shrink-0 opacity-70" />
                      }
                      label={t("options.nav.status")}
                      active={mainTab === "status"}
                      onClick={() => onMainTabChange("status")}
                    />
                    <NavBtn
                      icon={<Cable className="h-4 w-4 shrink-0 opacity-70" />}
                      label={t("options.models.connection.navTitle")}
                      active={mainTab === "connection"}
                      onClick={() => onMainTabChange("connection")}
                    />
                    <NavBtn
                      icon={
                        <FileText className="h-4 w-4 shrink-0 opacity-70" />
                      }
                      label={t("options.nav.logs")}
                      active={mainTab === "logs"}
                      onClick={() => onMainTabChange("logs")}
                    />
                  </div>
                ) : null}
              </nav>
            </ScrollArea>
            <div className="px-3 py-2">
              <p className="text-[10px] text-muted-foreground/60">v0.3.0</p>
            </div>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            {mainTab === "behavior" ? (
              <SettingsAssistantBehavior />
            ) : mainTab === "models" ? (
              <HermesModelConfigTab
                bridge={capabilities.bridge}
                selectedProfileId="default"
                view="models"
              />
            ) : mainTab === "multi-model-collaboration" ? (
              <HermesModelConfigTab
                bridge={capabilities.bridge}
                selectedProfileId="default"
                view="multi-model-collaboration"
              />
            ) : mainTab === "connection" ? (
              <HermesModelConfigTab
                bridge={capabilities.bridge}
                view="connection"
              />
            ) : mainTab === "agents" ? (
              <SettingsAgents bridge={capabilities.bridge} />
            ) : mainTab === "tokens" ? (
              <TokensPage />
            ) : mainTab === "tools" ? (
              <ToolsPage
                profileId="default"
                toolActivitySource={toolActivitySource}
              />
            ) : mainTab === "memory" ? (
              <SettingsMemory profileId="default" />
            ) : mainTab === "messaging" ? (
              <SettingsMessaging profileId="default" />
            ) : mainTab === "voice" ? (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <SettingsPaneHeader
                  title={t("options.voice.title")}
                  subtitle={t("options.voice.description")}
                />
                <ScrollArea className="min-h-0 flex-1">
                  <PageContent size="md">
                    <SettingsVoice />
                  </PageContent>
                </ScrollArea>
              </div>
            ) : mainTab === "status" ? (
              <SettingsStatus
                onViewUpdateLogs={() => showLogs("hermes-update")}
              />
            ) : mainTab === "logs" ? (
              <SettingsLogs
                source={logsSource}
                onSourceChange={onLogSourceChange}
              />
            ) : (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {mainTab === "scripts" && userscripts ? (
                  <>
                    <SettingsPaneHeader
                      title={t("options.scripts.title")}
                      subtitle={t("options.scripts.subtitle")}
                    />
                    <ScrollArea className="min-h-0 flex-1">
                      <PageContent bodyClassName="space-y-4" size="md">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            onClick={() => setCreating(true)}
                            disabled={busy}
                          >
                            <FilePlus2 className="mr-1" />
                            {t("options.scripts.new")}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setInstallOpen(true)}
                            disabled={busy}
                          >
                            <Globe className="mr-1" />
                            {t("options.scripts.installFromUrl")}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => void refresh()}
                            disabled={busy}
                          >
                            <RefreshCw className="mr-1" />
                            {t("common.refresh")}
                          </Button>
                          {error && (
                            <span className="text-xs text-destructive">
                              {error}
                            </span>
                          )}
                        </div>

                        {editing ? (
                          <ScriptEditor
                            title={t("options.scripts.editor.editTitle", {
                              name:
                                (editing.meta as { name?: string }).name ??
                                "(unnamed)",
                            })}
                            initialSource={editingSource}
                            onSave={onSaveEdit}
                            onCancel={() => {
                              setEditing(null);
                              setEditingSource("");
                            }}
                            busy={busy}
                          />
                        ) : creating ? (
                          <ScriptEditor
                            title={t("options.scripts.editor.newTitle")}
                            initialSource=""
                            onSave={onCreateNew}
                            onCancel={() => setCreating(false)}
                            busy={busy}
                          />
                        ) : (
                          <ScriptList
                            scripts={scripts.map((s) => {
                              const m = s.meta as {
                                name?: string;
                                version?: string;
                                match?: string[];
                                runAt?: string;
                              };
                              return {
                                id: s.id,
                                meta: {
                                  name: m.name ?? "(unnamed)",
                                  version: m.version,
                                  match: m.match ?? [],
                                  runAt: m.runAt ?? "document-idle",
                                },
                                enabled: s.enabled,
                                updatedAt: s.updatedAt,
                                lastError: s.lastError,
                              };
                            })}
                            onEdit={(id) => void onEdit(id)}
                            onRemove={(id) => void onRemove(id)}
                            onToggle={(id, enabled) =>
                              void onToggle(id, enabled)
                            }
                          />
                        )}
                      </PageContent>
                    </ScrollArea>
                  </>
                ) : mainTab === "appearance" ? (
                  <SettingsAppearance />
                ) : mainTab === "shortcuts" ? (
                  <SettingsShortcuts />
                ) : (
                  (() => {
                    // Extension-contributed settings tab — render via WebView.
                    // The settings tab id IS the extensionId.
                    const extSetting = extensionSettings.find(
                      (s) => s.extensionId === mainTab,
                    );
                    if (extSetting) {
                      return (
                        <ExtensionWebView
                          src={extSetting.viewUrl}
                          className="h-full w-full"
                        />
                      );
                    }
                    return null;
                  })()
                )}
              </div>
            )}
          </main>

          {showScriptsTab && (
            <Dialog open={installOpen} onOpenChange={setInstallOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {t("options.scripts.installDialog.title")}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="installUrl">
                    {t("options.scripts.installDialog.label")}
                  </Label>
                  <Input
                    id="installUrl"
                    value={installUrl}
                    onChange={(e) => setInstallUrl(e.target.value)}
                    placeholder="https://example.com/some-userscript.user.js"
                  />
                  {error && <p className="text-xs text-destructive">{error}</p>}
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setInstallOpen(false)}
                    disabled={busy}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    onClick={() => void onInstallFromUrl()}
                    disabled={busy}
                  >
                    {busy
                      ? t("common.installing")
                      : t("options.scripts.installDialog.install")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </AgentTaskProvider>
    </SettingsPaneProvider>
  );
}

function NavBtn({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <NavigationRow
      onClick={onClick}
      icon={icon}
      label={label}
      active={active}
    />
  );
}
