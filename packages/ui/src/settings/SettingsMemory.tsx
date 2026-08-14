import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  Button,
  PageContent,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "../primitives";
import {
  getHermesMemoryConfig,
  getHermesMemoryList,
  getHermesToolsetDetail,
  putHermesMemoryProvider,
  putHermesToolsetToggle,
  resetHermesMemory,
  type HermesMemoryConfigResponse,
  type HermesMemoryEntries,
  type HermesMemoryTarget,
} from "@amiba/core";
import { useT, type TranslateFn } from "@amiba/i18n";
import { cn } from "../primitives";
import { OPTIONS_SHELL_HEADER_ROW } from "./optionsPageChrome";
import { SettingsPaneHeader } from "./SettingsPaneHeader";

const BUILT_IN_MEMORY_PROVIDER = "__built_in__";

function targetLabel(t: TranslateFn, target: HermesMemoryTarget): string {
  return target === "user"
    ? t("options.memory.target.user")
    : t("options.memory.target.memory");
}

function targetDesc(t: TranslateFn, target: HermesMemoryTarget): string {
  return target === "user"
    ? t("options.memory.desc.user")
    : t("options.memory.desc.memory");
}

function usageRatio(entry: HermesMemoryEntries): number {
  if (!entry.char_limit) return 0;
  return Math.min(1, entry.char_count / entry.char_limit);
}

function usageColor(ratio: number): string {
  if (ratio >= 0.9) return "bg-destructive";
  if (ratio >= 0.7) return "bg-amber-500";
  return "bg-primary";
}

function MemoryBlock({ entry }: { entry: HermesMemoryEntries }) {
  const { t } = useT();
  const ratio = usageRatio(entry);
  const color = usageColor(ratio);

  return (
    <section className="space-y-3 rounded-md border border-border bg-card p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">
            {targetLabel(t, entry.target)}
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {targetDesc(t, entry.target)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs tabular-nums text-muted-foreground">
            {t("options.memory.chars", {
              count: entry.char_count.toLocaleString(),
              limit: entry.char_limit.toLocaleString(),
            })}
          </p>
          <p className="text-[10px] text-muted-foreground/70">
            {t("options.memory.entries", { count: entry.entries.length })}
          </p>
        </div>
      </header>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full transition-all", color)}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>

      {entry.path && (
        <p
          data-selection="text"
          className="truncate font-mono text-[10px] text-muted-foreground/70"
          title={entry.path}
        >
          {entry.path}
        </p>
      )}

      {entry.error ? (
        <p className="text-xs text-destructive">{entry.error}</p>
      ) : entry.entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("options.memory.empty")}
        </p>
      ) : (
        <ol className="space-y-2">
          {entry.entries.map((rec, i) => (
            <li
              key={i}
              className={cn(
                "rounded border p-3 text-xs leading-relaxed",
                rec.flagged
                  ? "border-destructive/40 bg-destructive/[0.04]"
                  : "border-border/60 bg-muted/30",
              )}
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5 tabular-nums">
                  #{i + 1}
                </span>
                <span className="tabular-nums">
                  {t("options.memory.charsLen", { count: rec.text.length })}
                </span>
                {rec.flagged && (
                  <span
                    title={t("options.memory.flagTooltip", {
                      flag: rec.flagged,
                    })}
                    className="rounded bg-destructive/15 px-1.5 py-0.5 font-medium text-destructive"
                  >
                    ⚠ {rec.flagged}
                  </span>
                )}
              </div>
              <p
                data-selection="text"
                className="whitespace-pre-wrap break-words"
              >
                {rec.text}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Profile-scoped memory access, provider choice, and curated-memory view. */
export function SettingsMemory({
  embedded = false,
  profileId,
}: {
  embedded?: boolean;
  profileId?: string;
} = {}) {
  const { t } = useT();
  const [items, setItems] = useState<HermesMemoryEntries[]>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [config, setConfig] = useState<HermesMemoryConfigResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [r, capability, memoryConfig] = await Promise.all([
      getHermesMemoryList(profileId),
      getHermesToolsetDetail("memory", profileId),
      getHermesMemoryConfig(profileId),
    ]);
    setLoading(false);
    if (!r.ok) {
      setError(r.error || t("options.memory.failedToLoad"));
      setItems([]);
      return;
    }
    setItems(r.targets);
    if (capability.ok && capability.toolset) {
      setEnabled(capability.toolset.enabled);
    }
    if (memoryConfig.ok) setConfig(memoryConfig);
  }, [profileId, t]);

  const toggleMemory = useCallback(
    async (next: boolean) => {
      if (saving) return;
      setSaving(true);
      setError(null);
      const result = await putHermesToolsetToggle("memory", next, profileId);
      setSaving(false);
      if (!result.ok) {
        setError(result.error || t("options.memory.config.saveFailed"));
        return;
      }
      setEnabled(next);
    },
    [profileId, saving, t],
  );

  const changeProvider = useCallback(
    async (value: string) => {
      if (saving) return;
      const provider = value === BUILT_IN_MEMORY_PROVIDER ? "" : value;
      setSaving(true);
      setError(null);
      const result = await putHermesMemoryProvider(provider, profileId);
      setSaving(false);
      if (!result.ok) {
        setError(result.error || t("options.memory.config.saveFailed"));
        return;
      }
      setConfig((current) =>
        current
          ? { ...current, provider: result.provider ?? provider }
          : current,
      );
    },
    [profileId, saving, t],
  );

  const reset = useCallback(async () => {
    if (
      !confirm(
        "Clear all curated memory for this profile? This cannot be undone.",
      )
    )
      return;
    setLoading(true);
    setError(null);
    const result = await resetHermesMemory("all", profileId);
    setLoading(false);
    if (!result.ok) setError(result.error || "Failed to reset memory");
    else await refresh();
  }, [profileId, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {!embedded ? (
        <SettingsPaneHeader
          title={t("options.memory.title")}
          subtitle={t("options.memory.subtitle")}
          subtitleTooltip={t("options.memory.subtitle.tooltip")}
        >
          <Button
            className="h-8 shrink-0 gap-1.5 text-xs text-destructive hover:text-destructive"
            disabled={
              loading || items.every((item) => item.entries.length === 0)
            }
            onClick={() => void reset()}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Reset
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5 text-xs"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t("options.memory.refresh")}
          </Button>
        </SettingsPaneHeader>
      ) : null}

      <ScrollArea className="min-h-0 flex-1">
        <PageContent
          bodyClassName="space-y-4"
          className={embedded ? "pt-4" : undefined}
          size="md"
        >
          {embedded ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {t("options.memory.subtitle")}
              </p>
              <Button
                aria-label={t("options.memory.refresh")}
                className="h-7 w-7 rounded-full"
                disabled={loading}
                onClick={() => void refresh()}
                size="icon"
                type="button"
                variant="ghost"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                aria-label="Reset memory"
                className="h-7 w-7 rounded-full text-destructive hover:text-destructive"
                disabled={
                  loading || items.every((item) => item.entries.length === 0)
                }
                onClick={() => void reset()}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : null}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <section className="rounded-md border border-border/60 bg-muted/10">
            <div className="flex items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium">
                  {t("options.memory.config.title")}
                </h3>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {t("options.memory.config.description")}
                </p>
              </div>
              <Switch
                aria-label={t("options.memory.config.toggle")}
                checked={enabled === true}
                disabled={loading || saving || enabled === null}
                onCheckedChange={(next) => void toggleMemory(next)}
              />
            </div>
            {config && config.providers.length > 0 ? (
              <div className="grid items-center gap-2 border-t border-border/50 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_240px]">
                <div>
                  <p className="text-xs font-medium">
                    {t("options.memory.config.provider")}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {t("options.memory.config.providerDescription")}
                  </p>
                </div>
                <Select
                  disabled={saving || enabled !== true}
                  onValueChange={(value) => void changeProvider(value)}
                  value={config.provider || BUILT_IN_MEMORY_PROVIDER}
                >
                  <SelectTrigger className="h-8 shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {config.providers.map((provider) => (
                      <SelectItem
                        disabled={!provider.available}
                        key={provider.name || BUILT_IN_MEMORY_PROVIDER}
                        value={provider.name || BUILT_IN_MEMORY_PROVIDER}
                      >
                        {provider.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </section>
          {items.map((entry) => (
            <MemoryBlock key={entry.target} entry={entry} />
          ))}
        </PageContent>
      </ScrollArea>
    </div>
  );
}
