import {
  ArrowLeft,
  AudioLines,
  Blocks,
  BrainCircuit,
  ChevronRight,
  CircleAlert,
  Clapperboard,
  Clock3,
  Code2,
  Eye,
  Files,
  Globe2,
  History,
  HousePlug,
  Image,
  Laptop,
  ListTodo,
  Loader2,
  MessageCircle,
  MessageCircleQuestion,
  MonitorUp,
  Music2,
  Network,
  Search,
  Terminal,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getHermesToolsetDetail,
  getHermesToolsets,
  putHermesToolsetToggle,
  type HermesToolset,
  type HermesToolsetDetail,
  type ToolActivitySource,
} from "@amiba/core";
import { useT, type MessageKey } from "@amiba/i18n";

import { useRefetchOnFocus } from "../hooks/useRefetchOnFocus";
import { Button, PageContent, ScrollArea, Switch, cn } from "../primitives";
import { SettingsBrowser } from "../settings/SettingsBrowser";
import { McpToolsTab } from "../settings/McpToolsTab";
import {
  MODEL_SETTINGS_SECTION_CLASS,
  MODEL_SETTINGS_SURFACE_CLASS,
  ModelSettingsSectionHeader,
} from "../settings/ModelSettingsSectionChrome";
import { SettingsPaneHeader } from "../settings/SettingsPaneHeader";
import { ToolsetConfiguration } from "./ToolsetConfiguration";
import { ToolsActivityTab } from "./ToolsActivityTab";

type CapabilityGroupId =
  | "understand"
  | "web"
  | "create"
  | "coordinate"
  | "device"
  | "connect";

interface CapabilityDefinition {
  name: string;
  group: CapabilityGroupId;
  icon: LucideIcon;
  titleKey: MessageKey;
  descriptionKey: MessageKey;
}

interface CapabilityGroupDefinition {
  id: CapabilityGroupId;
  titleKey: MessageKey;
  descriptionKey: MessageKey;
}

const CAPABILITY_GROUPS: CapabilityGroupDefinition[] = [
  {
    id: "understand",
    titleKey: "agentCapabilities.group.understand.title",
    descriptionKey: "agentCapabilities.group.understand.description",
  },
  {
    id: "web",
    titleKey: "agentCapabilities.group.web.title",
    descriptionKey: "agentCapabilities.group.web.description",
  },
  {
    id: "create",
    titleKey: "agentCapabilities.group.create.title",
    descriptionKey: "agentCapabilities.group.create.description",
  },
  {
    id: "coordinate",
    titleKey: "agentCapabilities.group.coordinate.title",
    descriptionKey: "agentCapabilities.group.coordinate.description",
  },
  {
    id: "device",
    titleKey: "agentCapabilities.group.device.title",
    descriptionKey: "agentCapabilities.group.device.description",
  },
  {
    id: "connect",
    titleKey: "agentCapabilities.group.connect.title",
    descriptionKey: "agentCapabilities.group.connect.description",
  },
];

/**
 * Deliberately curated product vocabulary.
 *
 * Internal mechanisms such as todo stay out of this list. Everything here is
 * a durable permission, provider, or supported interaction choice a person
 * can reasonably configure for one Profile.
 */
const CAPABILITY_CATALOG: CapabilityDefinition[] = [
  {
    name: "vision",
    group: "understand",
    icon: Eye,
    titleKey: "agentCapabilities.item.vision.title",
    descriptionKey: "agentCapabilities.item.vision.description",
  },
  {
    name: "video",
    group: "understand",
    icon: Video,
    titleKey: "agentCapabilities.item.video.title",
    descriptionKey: "agentCapabilities.item.video.description",
  },
  {
    name: "web",
    group: "web",
    icon: Search,
    titleKey: "agentCapabilities.item.web.title",
    descriptionKey: "agentCapabilities.item.web.description",
  },
  {
    name: "browser",
    group: "web",
    icon: Globe2,
    titleKey: "agentCapabilities.item.browser.title",
    descriptionKey: "agentCapabilities.item.browser.description",
  },
  {
    name: "x_search",
    group: "web",
    icon: MessageCircle,
    titleKey: "agentCapabilities.item.xSearch.title",
    descriptionKey: "agentCapabilities.item.xSearch.description",
  },
  {
    name: "extensions",
    group: "create",
    icon: Blocks,
    titleKey: "agentCapabilities.item.extensions.title",
    descriptionKey: "agentCapabilities.item.extensions.description",
  },
  {
    name: "image_gen",
    group: "create",
    icon: Image,
    titleKey: "agentCapabilities.item.imageGen.title",
    descriptionKey: "agentCapabilities.item.imageGen.description",
  },
  {
    name: "video_gen",
    group: "create",
    icon: MonitorUp,
    titleKey: "agentCapabilities.item.videoGen.title",
    descriptionKey: "agentCapabilities.item.videoGen.description",
  },
  {
    name: "bfl",
    group: "create",
    icon: Clapperboard,
    titleKey: "agentCapabilities.item.bfl.title",
    descriptionKey: "agentCapabilities.item.bfl.description",
  },
  {
    name: "tts",
    group: "create",
    icon: AudioLines,
    titleKey: "agentCapabilities.item.tts.title",
    descriptionKey: "agentCapabilities.item.tts.description",
  },
  {
    name: "kanban",
    group: "coordinate",
    icon: ListTodo,
    titleKey: "agentCapabilities.item.kanban.title",
    descriptionKey: "agentCapabilities.item.kanban.description",
  },
  {
    name: "delegation",
    group: "coordinate",
    icon: Users,
    titleKey: "agentCapabilities.item.delegation.title",
    descriptionKey: "agentCapabilities.item.delegation.description",
  },
  {
    name: "clarify",
    group: "coordinate",
    icon: MessageCircleQuestion,
    titleKey: "agentCapabilities.item.clarify.title",
    descriptionKey: "agentCapabilities.item.clarify.description",
  },
  {
    name: "session_search",
    group: "coordinate",
    icon: Search,
    titleKey: "agentCapabilities.item.sessionSearch.title",
    descriptionKey: "agentCapabilities.item.sessionSearch.description",
  },
  {
    name: "cronjob",
    group: "coordinate",
    icon: Clock3,
    titleKey: "agentCapabilities.item.cronjob.title",
    descriptionKey: "agentCapabilities.item.cronjob.description",
  },
  {
    name: "context_engine",
    group: "coordinate",
    icon: BrainCircuit,
    titleKey: "agentCapabilities.item.contextEngine.title",
    descriptionKey: "agentCapabilities.item.contextEngine.description",
  },
  {
    name: "terminal",
    group: "device",
    icon: Terminal,
    titleKey: "agentCapabilities.item.terminal.title",
    descriptionKey: "agentCapabilities.item.terminal.description",
  },
  {
    name: "file",
    group: "device",
    icon: Files,
    titleKey: "agentCapabilities.item.file.title",
    descriptionKey: "agentCapabilities.item.file.description",
  },
  {
    name: "code_execution",
    group: "device",
    icon: Code2,
    titleKey: "agentCapabilities.item.codeExecution.title",
    descriptionKey: "agentCapabilities.item.codeExecution.description",
  },
  {
    name: "computer_use",
    group: "device",
    icon: Laptop,
    titleKey: "agentCapabilities.item.computerUse.title",
    descriptionKey: "agentCapabilities.item.computerUse.description",
  },
  {
    name: "homeassistant",
    group: "connect",
    icon: HousePlug,
    titleKey: "agentCapabilities.item.homeAssistant.title",
    descriptionKey: "agentCapabilities.item.homeAssistant.description",
  },
  {
    name: "spotify",
    group: "connect",
    icon: Music2,
    titleKey: "agentCapabilities.item.spotify.title",
    descriptionKey: "agentCapabilities.item.spotify.description",
  },
  {
    name: "discord",
    group: "connect",
    icon: MessageCircle,
    titleKey: "agentCapabilities.item.discord.title",
    descriptionKey: "agentCapabilities.item.discord.description",
  },
  {
    name: "discord_admin",
    group: "connect",
    icon: Users,
    titleKey: "agentCapabilities.item.discordAdmin.title",
    descriptionKey: "agentCapabilities.item.discordAdmin.description",
  },
  {
    name: "yuanbao",
    group: "connect",
    icon: MessageCircle,
    titleKey: "agentCapabilities.item.yuanbao.title",
    descriptionKey: "agentCapabilities.item.yuanbao.description",
  },
  {
    name: "a2a",
    group: "connect",
    icon: Network,
    titleKey: "agentCapabilities.item.a2a.title",
    descriptionKey: "agentCapabilities.item.a2a.description",
  },
];

const CAPABILITY_BY_NAME = new Map(
  CAPABILITY_CATALOG.map((definition) => [definition.name, definition]),
);

export function AgentCapabilitiesPage({
  embedded = false,
  profileId,
  toolActivitySource,
}: {
  embedded?: boolean;
  profileId?: string;
  toolActivitySource?: ToolActivitySource;
}) {
  const { t } = useT();
  const [toolsets, setToolsets] = useState<HermesToolset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [showActivity, setShowActivity] = useState(false);
  const [detail, setDetail] = useState<HermesToolsetDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);
  const requestSeq = useRef(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getHermesToolsets(profileId);
    setLoading(false);
    if (!result.ok) {
      setError(result.error || t("agentCapabilities.loadFailed"));
      return;
    }
    setToolsets(result.toolsets);
  }, [profileId, t]);

  const loadDetail = useCallback(
    async (name: string) => {
      const seq = ++requestSeq.current;
      setDetailLoading(true);
      setDetailError(null);
      const result = await getHermesToolsetDetail(name, profileId);
      if (seq !== requestSeq.current) return;
      setDetailLoading(false);
      if (!result.ok || !result.toolset) {
        setDetailError(result.error || t("tools.detail.loadFailed"));
        return;
      }
      const next = result.toolset;
      setDetail(next);
      setToolsets((current) =>
        current.map((toolset) =>
          toolset.name === next.name
            ? {
                ...toolset,
                enabled: next.enabled,
                available: next.available,
                configured: next.configured,
              }
            : toolset,
        ),
      );
    },
    [profileId, t],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useRefetchOnFocus(() => void refresh());

  useEffect(() => {
    if (!selectedName) {
      requestSeq.current += 1;
      setDetail(null);
      setDetailLoading(false);
      setDetailError(null);
      return;
    }
    void loadDetail(selectedName);
  }, [loadDetail, selectedName]);

  const visibleCapabilities = useMemo(
    () =>
      CAPABILITY_CATALOG.flatMap((definition) => {
        const toolset = toolsets.find((item) => item.name === definition.name);
        return toolset ? [{ definition, toolset }] : [];
      }),
    [toolsets],
  );

  const selectedDefinition = selectedName
    ? (CAPABILITY_BY_NAME.get(selectedName) ?? null)
    : null;

  async function toggleSelected() {
    if (!detail || toggleBusy) return;
    setToggleBusy(true);
    setDetailError(null);
    const result = await putHermesToolsetToggle(
      detail.name,
      !detail.enabled,
      profileId,
    );
    setToggleBusy(false);
    if (!result.ok) {
      setDetailError(result.error || t("tools.toggleFailed"));
      return;
    }
    await Promise.all([refresh(), loadDetail(detail.name)]);
  }

  if (showActivity) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <PageHeader
          icon={History}
          title={t("agentCapabilities.activity.title")}
          description={t("agentCapabilities.activity.description")}
          backLabel={t("agentCapabilities.title")}
          onBack={() => setShowActivity(false)}
        />
        <ToolsActivityTab source={toolActivitySource} />
      </div>
    );
  }

  if (selectedName && selectedDefinition) {
    return (
      <CapabilitySetupView
        definition={selectedDefinition}
        detail={detail?.name === selectedName ? detail : null}
        loading={detailLoading}
        error={detailError}
        toggleBusy={toggleBusy}
        onBack={() => setSelectedName(null)}
        onToggle={() => void toggleSelected()}
        onReload={() => loadDetail(selectedName)}
        profileId={profileId}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {!embedded ? <SettingsPaneHeader /> : null}

      <ScrollArea className="min-h-0 flex-1">
        <PageContent bodyClassName="space-y-8" size="md">
          <section className={MODEL_SETTINGS_SECTION_CLASS}>
            <ModelSettingsSectionHeader
              title={t("agentCapabilities.builtin.title")}
              description={t("agentCapabilities.builtin.description")}
              accessory={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => setShowActivity(true)}
                  aria-label={t("agentCapabilities.activity.action")}
                  title={t("agentCapabilities.activity.action")}
                >
                  <History className="h-4 w-4" />
                </Button>
              }
            />

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {loading && toolsets.length === 0 ? (
              <CapabilityPageSkeleton />
            ) : visibleCapabilities.length === 0 ? (
              <div className={MODEL_SETTINGS_SURFACE_CLASS}>
                <p className="px-4 py-5 text-sm text-muted-foreground">
                  {t("agentCapabilities.empty")}
                </p>
              </div>
            ) : (
              <div
                className={MODEL_SETTINGS_SURFACE_CLASS}
                data-tool-settings-surface
              >
                {CAPABILITY_GROUPS.map((group) => {
                  const items = visibleCapabilities.filter(
                    ({ definition }) => definition.group === group.id,
                  );
                  if (items.length === 0) return null;
                  return (
                    <CapabilityGroup
                      key={group.id}
                      group={group}
                      items={items}
                      onSelect={setSelectedName}
                    />
                  );
                })}
              </div>
            )}
          </section>

          <McpToolsTab profileId={profileId} />
        </PageContent>
      </ScrollArea>
    </div>
  );
}

function PageHeader({
  icon: Icon,
  title,
  description,
  actions,
  backLabel,
  onBack,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actions?: React.ReactNode;
  backLabel?: string;
  onBack?: () => void;
}) {
  return (
    <header className="shrink-0 border-b border-border/60">
      <PageContent
        bodyClassName="flex items-center gap-3"
        className="px-7 py-4"
        padding="none"
        size="md"
      >
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            aria-label={backLabel}
            title={backLabel}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold tracking-tight">{title}</h1>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-1">{actions}</div>
        )}
      </PageContent>
    </header>
  );
}

function CapabilityGroup({
  group,
  items,
  onSelect,
}: {
  group: CapabilityGroupDefinition;
  items: Array<{
    definition: CapabilityDefinition;
    toolset: HermesToolset;
  }>;
  onSelect: (name: string) => void;
}) {
  const { t } = useT();
  return (
    <section
      className="border-t border-border/60 first:border-t-0"
      data-tool-group
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 bg-muted/[0.035] px-4 py-2.5">
        <h3 className="text-xs font-semibold text-foreground">
          {t(group.titleKey)}
        </h3>
        <p className="text-[11px] text-muted-foreground">
          {t(group.descriptionKey)}
        </p>
      </div>
      <ul className="border-t border-border/45">
        {items.map(({ definition, toolset }) => (
          <CapabilityRow
            key={definition.name}
            definition={definition}
            toolset={toolset}
            onSelect={() => onSelect(definition.name)}
          />
        ))}
      </ul>
    </section>
  );
}

function CapabilityRow({
  definition,
  toolset,
  onSelect,
}: {
  definition: CapabilityDefinition;
  toolset: HermesToolset;
  onSelect: () => void;
}) {
  const { t } = useT();
  const Icon = definition.icon;
  return (
    <li className="border-b border-border/40 last:border-b-0">
      <button
        type="button"
        onClick={onSelect}
        className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/20"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/55 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            {t(definition.titleKey)}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {t(definition.descriptionKey)}
          </span>
        </span>
        <CapabilityStatus toolset={toolset} />
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
      </button>
    </li>
  );
}

function CapabilityStatus({ toolset }: { toolset: HermesToolset }) {
  const { t } = useT();
  const kind = !toolset.enabled
    ? "off"
    : toolset.configured
      ? "ready"
      : "attention";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 text-xs",
        kind === "ready"
          ? "text-emerald-600 dark:text-emerald-300"
          : kind === "attention"
            ? "text-amber-600 dark:text-amber-300"
            : "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          kind === "ready"
            ? "bg-emerald-500"
            : kind === "attention"
              ? "bg-amber-500"
              : "border border-muted-foreground/50",
        )}
      />
      {t(
        kind === "ready"
          ? "agentCapabilities.status.ready"
          : kind === "attention"
            ? "agentCapabilities.status.attention"
            : "agentCapabilities.status.off",
      )}
    </span>
  );
}

function CapabilitySetupView({
  definition,
  detail,
  loading,
  error,
  toggleBusy,
  onBack,
  onToggle,
  onReload,
  profileId,
}: {
  definition: CapabilityDefinition;
  detail: HermesToolsetDetail | null;
  loading: boolean;
  error: string | null;
  toggleBusy: boolean;
  onBack: () => void;
  onToggle: () => void;
  onReload: () => Promise<void> | void;
  profileId?: string;
}) {
  const { t } = useT();
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <PageHeader
        icon={definition.icon}
        title={t(definition.titleKey)}
        description={t(definition.descriptionKey)}
        backLabel={t("agentCapabilities.back")}
        onBack={onBack}
        actions={
          detail ? (
            <Switch
              checked={detail.enabled}
              disabled={toggleBusy}
              onCheckedChange={onToggle}
              aria-label={t("agentCapabilities.enabledForAssistant")}
              title={t("agentCapabilities.enabledForAssistant")}
            />
          ) : null
        }
      />
      <ScrollArea className="min-h-0 flex-1">
        <PageContent className="py-5" size="md">
          {loading && !detail ? (
            <CapabilitySetupSkeleton />
          ) : error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : detail ? (
            <div className="space-y-6" data-tool-detail-content>
              <ToolsetConfiguration
                detail={detail}
                onChanged={onReload}
                profileId={profileId}
              />
              {detail.name === "browser" && (
                <SettingsBrowser embedded profileId={profileId} />
              )}
            </div>
          ) : null}
        </PageContent>
      </ScrollArea>
    </div>
  );
}

function CapabilityPageSkeleton() {
  return (
    <div className={MODEL_SETTINGS_SURFACE_CLASS}>
      {[2, 3, 3].map((rows, index) => (
        <div key={index} className="border-t border-border/60 first:border-t-0">
          <div className="flex h-9 items-center border-b border-border/45 bg-muted/[0.035] px-4">
            <div className="h-3 w-28 animate-pulse rounded bg-muted/70" />
          </div>
          <div>
            {Array.from({ length: rows }).map((_, row) => (
              <div
                key={row}
                className="flex items-center gap-3 border-b border-border/40 px-4 py-3 last:border-b-0"
              >
                <div className="h-8 w-8 animate-pulse rounded-md bg-muted/70" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-28 animate-pulse rounded bg-muted/70" />
                  <div className="h-2.5 w-52 animate-pulse rounded bg-muted/50" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CapabilitySetupSkeleton() {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="h-4 w-32 animate-pulse rounded bg-muted/70" />
        <div className="h-10 animate-pulse rounded bg-muted/50" />
        <div className="h-10 animate-pulse rounded bg-muted/50" />
      </div>
    </div>
  );
}
