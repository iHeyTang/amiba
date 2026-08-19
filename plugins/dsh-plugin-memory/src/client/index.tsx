import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import {
  cn,
  PageContent,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsPageActionButton,
  SettingsPageActions,
  SettingsPageDescription,
  usePluginT,
  type PluginLanguage,
} from "@amiba/ui/plugin";
import { Brain, Loader2, RefreshCw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import type {
  AmibaMemorySnapshot,
  AmibaMemoryTargetView,
} from "../memory-store.js";
import { AMIBA_MEMORY_REMOTE } from "../remote.js";

export const name = "amiba-memory-ui";
export const inject = ["slots", "remote"];

const SECTION_ID = "memory";
const DEFAULT_PRESET = "standard";

const ZH = {
  active: "已启用",
  assistantDescription: "助手对环境、项目和工具的观察。",
  assistantMemory: "助手记忆",
  chars: (count: number, limit: number) =>
    `${count.toLocaleString()} / ${limit.toLocaleString()} 字符`,
  charsLen: (count: number) => `${count.toLocaleString()} 字符`,
  empty: "（暂无记忆条目）",
  entries: (count: number) => `${count.toLocaleString()} 条`,
  nav: "记忆",
  pluginDescription:
    "记忆工具、安全扫描、持久化与模型上下文注入全部运行在 DSH Cordis 组合内。",
  pluginTitle: "DSH 长期记忆插件",
  preset: "记忆作用域",
  presetDescription: "每个 DSH Agent Preset 拥有独立的长期记忆集合。",
  presetSwitcherLabel: "切换记忆作用域",
  refresh: "刷新",
  subtitle: "由原生 DSH 插件提供、按 Preset 隔离的长期记忆",
  subtitleTooltip: "DSH 会话历史与压缩属于会话记忆，和跨会话长期记忆相互独立。",
  title: "记忆",
  userDescription: "助手记录的用户偏好与协作习惯。",
  userProfile: "用户画像",
};

const EN: typeof ZH = {
  active: "Active",
  assistantDescription:
    "The assistant's observations about environments, projects, and tools.",
  assistantMemory: "Assistant memory",
  chars: (count, limit) =>
    `${count.toLocaleString()} / ${limit.toLocaleString()} chars`,
  charsLen: (count) => `${count.toLocaleString()} chars`,
  empty: "(No memory entries yet)",
  entries: (count) => `${count.toLocaleString()} entries`,
  nav: "Memory",
  pluginDescription:
    "Memory tools, safety scanning, persistence, and model context all run inside the DSH Cordis composition.",
  pluginTitle: "DSH long-term memory plugin",
  preset: "Memory scope",
  presetDescription:
    "Each DSH agent preset keeps an independent long-term memory collection.",
  presetSwitcherLabel: "Switch memory scope",
  refresh: "Refresh",
  subtitle: "Preset-scoped long-term memory supplied by a native DSH plugin",
  subtitleTooltip:
    "DSH session history and compaction remain separate from cross-session memory.",
  title: "Memory",
  userDescription:
    "User preferences and collaboration habits noted by the assistant.",
  userProfile: "User profile",
};

function labels(language?: PluginLanguage): typeof ZH {
  const resolved =
    language ??
    (document.documentElement.lang.toLowerCase().startsWith("zh")
      ? "zh-CN"
      : "en");
  return resolved === "zh-CN" ? ZH : EN;
}

function usageRatio(entry: AmibaMemoryTargetView): number {
  return entry.charLimit ? Math.min(1, entry.charCount / entry.charLimit) : 0;
}

function MemoryBlock({
  copy,
  entry,
}: {
  copy: typeof ZH;
  entry: AmibaMemoryTargetView;
}): ReactNode {
  const ratio = usageRatio(entry);
  const color =
    ratio >= 0.9
      ? "bg-destructive"
      : ratio >= 0.7
        ? "bg-amber-500"
        : "bg-primary";
  return (
    <section className="space-y-3 rounded-md border border-border bg-card p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">
            {entry.target === "user" ? copy.userProfile : copy.assistantMemory}
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {entry.target === "user"
              ? copy.userDescription
              : copy.assistantDescription}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs tabular-nums text-muted-foreground">
            {copy.chars(entry.charCount, entry.charLimit)}
          </p>
          <p className="text-[10px] text-muted-foreground/70">
            {copy.entries(entry.entries.length)}
          </p>
        </div>
      </header>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full transition-all", color)}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
      <p
        className="truncate font-mono text-[10px] text-muted-foreground/70"
        data-selection="text"
        title={entry.path}
      >
        {entry.path}
      </p>
      {entry.entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{copy.empty}</p>
      ) : (
        <ol className="space-y-2">
          {entry.entries.map((record, index) => (
            <li
              className={cn(
                "rounded border p-3 text-xs leading-relaxed",
                record.flagged
                  ? "border-destructive/40 bg-destructive/[0.04]"
                  : "border-border/60 bg-muted/30",
              )}
              key={record.id}
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5 tabular-nums">
                  #{index + 1}
                </span>
                <span className="tabular-nums">
                  {copy.charsLen(record.text.length)}
                </span>
                {record.flagged ? (
                  <span className="rounded bg-destructive/15 px-1.5 py-0.5 font-medium text-destructive">
                    ⚠ {record.flagged}
                  </span>
                ) : null}
              </div>
              <p
                className="whitespace-pre-wrap break-words"
                data-selection="text"
              >
                {record.text}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

type MemoryRemote = ClientContext["remote"]["amibaMemory"];

/**
 * Shared memory body: the settings-section registration (top-level Settings,
 * carries the preset switcher) and the preset-detail registration (one tab
 * per agent preset, scoped by `profileId`) both render this, differing only
 * in which preset they read and whether they own the page's header actions.
 */
function MemoryView({
  embedded = false,
  listMemory,
  preset,
  presetControl,
}: {
  embedded?: boolean;
  listMemory: MemoryRemote["list"];
  preset: string;
  /** Interactive replacement for the read-only preset value cell — only the
   *  top-level settings section supplies one; preset-detail tabs are already
   *  scoped by their tab, so they keep the plain read-out. */
  presetControl?: ReactNode;
}): ReactNode {
  const { language } = usePluginT();
  const copy = labels(language);
  const [snapshot, setSnapshot] = useState<AmibaMemorySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listMemory(preset);
      if (!result.ok) throw new Error(result.error.message);
      setSnapshot(result.value);
    } catch (cause) {
      setSnapshot(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [listMemory, preset]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const items = snapshot?.targets ?? [];
  const refreshButton = (
    <SettingsPageActionButton
      aria-label={copy.refresh}
      disabled={loading}
      icon
      onClick={() => void refresh()}
      title={copy.refresh}
      type="button"
      variant="ghost"
    >
      {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
    </SettingsPageActionButton>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {embedded ? null : (
        <SettingsPageActions>{refreshButton}</SettingsPageActions>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <PageContent
          bodyClassName="space-y-4"
          className={embedded ? "pt-4" : undefined}
          size="md"
        >
          {embedded ? (
            <div className="flex items-center justify-between gap-3">
              <SettingsPageDescription>{copy.subtitle}</SettingsPageDescription>
              <div className="flex items-center gap-1">{refreshButton}</div>
            </div>
          ) : (
            <SettingsPageDescription>{copy.subtitle}</SettingsPageDescription>
          )}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <section className="rounded-md border border-border/60 bg-muted/10">
            <div className="flex items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium">{copy.pluginTitle}</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {copy.pluginDescription}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                {copy.active}
              </span>
            </div>
            <div className="grid items-center gap-2 border-t border-border/50 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_240px]">
              <div>
                <p className="text-xs font-medium">{copy.preset}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {copy.presetDescription}
                </p>
              </div>
              {presetControl ?? (
                <div className="truncate rounded-md border border-input bg-background px-3 py-2 font-mono text-xs">
                  {snapshot?.preset ?? preset}
                </div>
              )}
            </div>
          </section>
          {items.map((entry) => (
            <MemoryBlock copy={copy} entry={entry} key={entry.target} />
          ))}
        </PageContent>
      </ScrollArea>
    </div>
  );
}

type MemorySectionProps = PropsRuntime<"settings.section"> & {
  listMemory: MemoryRemote["list"];
  listPresets: MemoryRemote["presets"];
};

/** Top-level Settings section: adds the preset switcher driving which
 *  preset's memory `MemoryView` displays. */
function MemorySettings({
  listMemory,
  listPresets,
}: MemorySectionProps): ReactNode {
  const { language } = usePluginT();
  const copy = labels(language);
  const [presetOptions, setPresetOptions] = useState<string[]>([
    DEFAULT_PRESET,
  ]);
  const [preset, setPreset] = useState(DEFAULT_PRESET);
  const [presetsLoading, setPresetsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await listPresets();
        if (cancelled || !result.ok || result.value.length === 0) return;
        setPresetOptions(result.value);
        setPreset((current) =>
          result.value.includes(current)
            ? current
            : result.value.includes(DEFAULT_PRESET)
              ? DEFAULT_PRESET
              : (result.value[0] ?? DEFAULT_PRESET),
        );
      } catch (cause) {
        // A rejected transport degrades to the default preset — the same
        // remote is queried right after by `MemoryView`'s list call, whose
        // visible `error` state reports the failure to the user. Log so the
        // switcher's silent fallback stays diagnosable.
        console.warn("[amiba-memory] preset list failed:", cause);
      } finally {
        if (!cancelled) setPresetsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listPresets]);

  return (
    <MemoryView
      listMemory={listMemory}
      preset={preset}
      presetControl={
        <Select
          disabled={presetsLoading}
          onValueChange={setPreset}
          value={preset}
        >
          <SelectTrigger
            aria-label={copy.presetSwitcherLabel}
            className="h-9 font-mono text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {presetOptions.map((id) => (
              <SelectItem key={id} value={id}>
                {id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}

type MemoryPresetSectionProps = PropsRuntime<"amiba.agentPreset.section"> & {
  listMemory: MemoryRemote["list"];
};

/** Preset-detail tab (M1 `amiba.agentPreset.section`): the same view,
 *  scoped to the owning preset instead of a user-driven switcher. */
function MemoryPresetSection({
  listMemory,
  profileId,
}: MemoryPresetSectionProps): ReactElement {
  return <MemoryView embedded listMemory={listMemory} preset={profileId} />;
}

/** Register the Settings section and the preset-detail section from Memory's
 *  Client half — both read the same `remote.amibaMemory` face. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(AMIBA_MEMORY_REMOTE);
  // Mounting contributes `remote.amibaMemory`; Cordis still requires consumers
  // to declare that dynamically-created service before reading it. Keeping the
  // UI registrations in a dependent fiber also guarantees both entries
  // disappear together if the Remote face is ever retracted.
  const sectionFiber = ctx.inject(
    ["slots", "remote.amibaMemory"],
    (injectedCtx) => {
      const remote = injectedCtx.remote.amibaMemory;
      const listMemory: MemoryRemote["list"] = (preset) => remote.list(preset);
      const listPresets: MemoryRemote["presets"] = () => remote.presets();
      const disposeSection = injectedCtx.slots.inject(
        "settings.section",
        () =>
          injectedCtx.slots.register(
            {
              name: "settings.section",
              id: SECTION_ID,
              order: 300,
              label: () => labels().nav,
              inject: () => ({ listMemory, listPresets, navIcon: () => <Brain /> }),
            },
            MemorySettings,
          ),
      );
      const disposePresetSection = injectedCtx.slots.inject(
        "amiba.agentPreset.section",
        () =>
          injectedCtx.slots.register(
            {
              name: "amiba.agentPreset.section",
              id: SECTION_ID,
              order: 300,
              label: () => labels().nav,
              inject: () => ({ listMemory }),
            },
            MemoryPresetSection,
          ),
      );
      return () => {
        disposePresetSection();
        disposeSection();
      };
    },
  );
  await sectionFiber;
  return async () => {
    await sectionFiber.dispose();
    await disposeRemote();
  };
}
