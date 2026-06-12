import {
  Activity,
  AtSign,
  Bot,
  Boxes,
  BrainCircuit,
  Clock,
  Code2,
  FilePlus2,
  FileText,
  Globe,
  Home,
  Mic,
  Palette,
  RadioTower,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ExtensionWebView, useExtensionSettings } from "@amiba/extension-host/renderer";
import { resolveExtensionIcon } from "../chat/ActivityBar";

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
  ScrollArea,
} from "../primitives";

import type { OptionsCapabilities, UserScriptSummary } from "./capabilities";
import { HermesModelConfigTab } from "./HermesModelConfigTab";
import { OPTIONS_SHELL_HEADER_ROW } from "./optionsPageChrome";
import { ScriptEditor } from "./ScriptEditor";
import { ScriptList } from "./ScriptList";
import { SettingsCron } from "./SettingsCron";
import { SettingsGateway } from "./SettingsGateway";
import { SettingsLogs } from "./SettingsLogs";
import { SettingsMemory } from "./SettingsMemory";
import { SettingsPaneHeader, SettingsPaneProvider } from "./SettingsPaneHeader";
import { AgentTaskProvider } from "./agent-task";
import { MentionSourcesTab } from "./MentionSourcesTab";
import { SettingsExtensions } from "./SettingsExtensions";
import { SettingsBrowser } from "./SettingsBrowser";
import { SettingsPreferences } from "./SettingsPreferences";
import { SettingsStatus } from "./SettingsStatus";
import { SettingsVoice } from "./SettingsVoice";

/**
 * Sidebar order (two groups):
 *   Extension:  Preference → Userscripts (hidden when userscripts capability absent)
 *   Hermes:     Gateway → Models → Memory → Voice → Cron → Logs
 *
 * Skills and extension-provided features have been promoted to extensions —
 * top-level destinations on the chat surface's activity bar.
 */
const ALL_TABS = [
  "status",
  "preference",
  "scripts",
  "gateway",
  "models",
  "memory",
  "voice",
  "cron",
  "logs",
  "extensions",
  "mention-sources",
  "browser",
] as const;
type CoreTab = (typeof ALL_TABS)[number];
/** MainTab is widened to string so extension tab IDs are also accepted. */
type MainTab = CoreTab | (string & {});

const TAB_SET = new Set<string>(ALL_TABS);

function isCoreTab(tab: MainTab): tab is CoreTab {
  return (ALL_TABS as readonly string[]).includes(tab)
}

function mainTabFromLocation(): MainTab {
  const raw =
    typeof window !== "undefined"
      ? window.location.hash.replace(/^#/, "").split("?")[0]
      : "";
  if (raw && TAB_SET.has(raw)) {
    return raw as MainTab;
  }
  if (raw === "settings") {
    return "preference";
  }
  if (raw === "hermes-model") {
    return "models";
  }
  return "status";
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
}

export function SettingsView({
  capabilities = {},
  onGoHome,
  sidebarHeaderLeftInset = 0,
  sidebarHeaderHeightPx = 24,
  sidebarHeaderClassName,
  paneHeaderClassName,
  paneHeaderChromeHeightPx,
}: SettingsViewProps = {}) {
  useResolvedTheme();
  const { t } = useT();

  const showScriptsTab = !!capabilities.userscripts;
  const extensionSettings = useExtensionSettings();

  const [mainTab, setMainTab] = useState<MainTab>(() => {
    const fromHash = mainTabFromLocation();
    // Don't land on scripts tab if the capability isn't available.
    if (fromHash === "scripts" && !showScriptsTab) return "status";
    return fromHash;
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
      if (t === "scripts" && !showScriptsTab) setMainTab("status");
      else setMainTab(t);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [showScriptsTab]);

  function onMainTabChange(v: string) {
    // Accept core tabs, featured-feature IDs, extension tab IDs (not in
    // TAB_SET), or fall back to "status".
    const isExtensionTab = extensionSettings.some((s) => s.extensionId === v);
    const next: MainTab =
      TAB_SET.has(v) || isExtensionTab ? v : "status";
    if (next === "scripts" && !showScriptsTab) return;
    setMainTab(next);
    const base = window.location.pathname + window.location.search;
    if (next === "scripts") {
      window.history.replaceState(null, "", base);
    } else {
      window.history.replaceState(null, "", `${base}#${next}`);
    }
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
    <AgentTaskProvider value={capabilities.startAgentTask}>
    <div className="flex h-screen min-h-0 w-full overflow-hidden bg-background text-foreground">
      <aside className="flex min-h-0 w-60 shrink-0 flex-col bg-muted/30">
        {onGoHome ? (
          /*
           * Desktop sidebar header — the row's height is whatever the
           * host passes. On desktop that's 44px so this centred h-6
           * Home button (centre y=22) shares its baseline with the
           * macOS traffic-light cluster pinned at (20, 14). The Home
           * button is pinned to the right of the row; the left half is
           * passive drag area (and on macOS hosts the traffic lights).
           */
          <div
            className={`flex shrink-0 items-center justify-end pr-2 ${sidebarHeaderClassName ?? ""}`}
            style={{
              height: sidebarHeaderHeightPx,
              paddingLeft: Math.max(sidebarHeaderLeftInset, 12),
            }}>
            <button
              type="button"
              onClick={onGoHome}
              title="Back to Home"
              aria-label="Back to Home"
              className="app-no-drag inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
              <Home className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className={`${OPTIONS_SHELL_HEADER_ROW} gap-2.5 px-3`}>
            <AmibaLogo size={28} className="shrink-0" />
            <p className="truncate text-sm font-semibold tracking-tight">{t("app.title")}</p>
          </div>
        )}
        <ScrollArea className="min-h-0 flex-1">
          <nav className="flex flex-col gap-0.5 p-2">
            <div className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
              {t("options.nav.section.core")}
            </div>
            <NavBtn icon={<Activity className="h-4 w-4 shrink-0 opacity-70" />} label={t("options.nav.status")} active={mainTab === "status"} onClick={() => onMainTabChange("status")} />
            <NavBtn icon={<Palette className="h-4 w-4 shrink-0 opacity-70" />} label={t("options.nav.preference")} active={mainTab === "preference"} onClick={() => onMainTabChange("preference")} />
            {showScriptsTab && (
              <NavBtn icon={<Code2 className="h-4 w-4 shrink-0 opacity-70" />} label={t("options.nav.scripts")} active={mainTab === "scripts"} onClick={() => onMainTabChange("scripts")} />
            )}
            <NavBtn icon={<RadioTower className="h-4 w-4 shrink-0 opacity-70" />} label={t("options.nav.gateway")} active={mainTab === "gateway"} onClick={() => onMainTabChange("gateway")} />
            <NavBtn icon={<Bot className="h-4 w-4 shrink-0 opacity-70" />} label={t("options.nav.models")} active={mainTab === "models"} onClick={() => onMainTabChange("models")} />
            <NavBtn icon={<BrainCircuit className="h-4 w-4 shrink-0 opacity-70" />} label={t("options.nav.memory")} active={mainTab === "memory"} onClick={() => onMainTabChange("memory")} />
            <NavBtn icon={<Mic className="h-4 w-4 shrink-0 opacity-70" />} label={t("options.nav.voice")} active={mainTab === "voice"} onClick={() => onMainTabChange("voice")} />
            <NavBtn icon={<Clock className="h-4 w-4 shrink-0 opacity-70" />} label={t("options.nav.cron")} active={mainTab === "cron"} onClick={() => onMainTabChange("cron")} />
            <NavBtn icon={<FileText className="h-4 w-4 shrink-0 opacity-70" />} label={t("options.nav.logs")} active={mainTab === "logs"} onClick={() => onMainTabChange("logs")} />
            <NavBtn icon={<Boxes className="h-4 w-4 shrink-0 opacity-70" />} label={t("options.nav.extensions")} active={mainTab === "extensions"} onClick={() => onMainTabChange("extensions")} />
            <NavBtn icon={<AtSign className="h-4 w-4 shrink-0 opacity-70" />} label={t("options.nav.mentionSources")} active={mainTab === "mention-sources"} onClick={() => onMainTabChange("mention-sources")} />
            <NavBtn icon={<Globe className="h-4 w-4 shrink-0 opacity-70" />} label={t("options.feature.browser.title")} active={mainTab === "browser"} onClick={() => onMainTabChange("browser")} />
            {extensionSettings.length > 0 && (
              <>
                <div className="mt-2 px-2 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                  {t("options.nav.section.extensions")}
                </div>
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
            )}
          </nav>
        </ScrollArea>
        <div className="px-3 py-2">
          <p className="text-[10px] text-muted-foreground/60">v0.3.0</p>
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {mainTab === "browser" ? (
          <SettingsBrowser />
        ) : mainTab === "models" ? (
          <HermesModelConfigTab />
        ) : mainTab === "memory" ? (
          <SettingsMemory />
        ) : mainTab === "voice" ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <SettingsPaneHeader
              title={t("options.voice.title")}
              subtitle={t("options.voice.description")}
            />
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-6">
                <SettingsVoice />
              </div>
            </ScrollArea>
          </div>
        ) : mainTab === "cron" ? (
          <SettingsCron />
        ) : mainTab === "status" ? (
          <SettingsStatus />
        ) : mainTab === "logs" ? (
          <SettingsLogs />
        ) : mainTab === "mention-sources" ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <SettingsPaneHeader title={t("options.nav.mentionSources")} />
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-6">
                <MentionSourcesTab />
              </div>
            </ScrollArea>
          </div>
        ) : mainTab === "extensions" ? (
          <SettingsExtensions />
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {mainTab === "scripts" && userscripts ? (
              <>
                <SettingsPaneHeader
                  title={t("options.scripts.title")}
                  subtitle={t("options.scripts.subtitle")}
                />
                <ScrollArea className="min-h-0 flex-1">
                  <div className="space-y-4 p-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button onClick={() => setCreating(true)} disabled={busy}>
                        <FilePlus2 className="mr-1" />
                        {t("options.scripts.new")}
                      </Button>
                      <Button variant="outline" onClick={() => setInstallOpen(true)} disabled={busy}>
                        <Globe className="mr-1" />
                        {t("options.scripts.installFromUrl")}
                      </Button>
                      <Button variant="ghost" onClick={() => void refresh()} disabled={busy}>
                        <RefreshCw className="mr-1" />
                        {t("common.refresh")}
                      </Button>
                      {error && <span className="text-xs text-destructive">{error}</span>}
                    </div>

                    {editing ? (
                      <ScriptEditor
                        title={t("options.scripts.editor.editTitle", {
                          name: (editing.meta as { name?: string }).name ?? "(unnamed)",
                        })}
                        initialSource={editingSource}
                        onSave={onSaveEdit}
                        onCancel={() => {
                          setEditing(null)
                          setEditingSource("")
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
                            name?: string
                            version?: string
                            match?: string[]
                            runAt?: string
                          }
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
                          }
                        })}
                        onEdit={(id) => void onEdit(id)}
                        onRemove={(id) => void onRemove(id)}
                        onToggle={(id, enabled) => void onToggle(id, enabled)}
                      />
                    )}
                  </div>
                </ScrollArea>
              </>
            ) : mainTab === "preference" ? (
              <SettingsPreferences />
            ) : isCoreTab(mainTab) ? (
              <>
                <SettingsPaneHeader
                  title={t("options.gateway.title")}
                  subtitle={t("options.gateway.subtitle")}
                  subtitleTooltip={t("options.gateway.subtitle.tooltip")}
                />
                <ScrollArea className="min-h-0 flex-1">
                  <div className="p-6">
                    <SettingsGateway bridge={capabilities.bridge} />
                  </div>
                </ScrollArea>
              </>
            ) : (() => {
              // Extension-contributed settings tab — render via WebView.
              // The settings tab id IS the extensionId.
              const extSetting = extensionSettings.find((s) => s.extensionId === mainTab);
              if (extSetting) {
                return <ExtensionWebView src={extSetting.viewUrl} className="h-full w-full" />;
              }
              return null;
            })()}
          </div>
        )}
      </main>

      {showScriptsTab && (
        <Dialog open={installOpen} onOpenChange={setInstallOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("options.scripts.installDialog.title")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="installUrl">{t("options.scripts.installDialog.label")}</Label>
              <Input
                id="installUrl"
                value={installUrl}
                onChange={(e) => setInstallUrl(e.target.value)}
                placeholder="https://example.com/some-userscript.user.js"
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setInstallOpen(false)} disabled={busy}>
                {t("common.cancel")}
              </Button>
              <Button onClick={() => void onInstallFromUrl()} disabled={busy}>
                {busy ? t("common.installing") : t("options.scripts.installDialog.install")}
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
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      className="w-full justify-start gap-2 font-normal"
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
  );
}
