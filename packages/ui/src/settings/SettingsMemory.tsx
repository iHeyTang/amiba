import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useT } from "@amiba/i18n";
import {
  getPlatform,
  type AgentMemoryTarget,
  type AgentMemoryTargetView,
} from "@amiba/app-runtime/platform";

import { Button, PageContent, ScrollArea, cn } from "../primitives";
import {
  SettingsPageActionButton,
  SettingsPageActions,
  SettingsPageDescription,
} from "./page-chrome";

function usageRatio(entry: AgentMemoryTargetView): number {
  return entry.charLimit ? Math.min(1, entry.charCount / entry.charLimit) : 0;
}

function MemoryBlock({ entry }: { entry: AgentMemoryTargetView }) {
  const { t } = useT();
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
            {entry.target === "user"
              ? t("options.memory.dsh.target.user")
              : t("options.memory.dsh.target.memory")}
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {entry.target === "user"
              ? t("options.memory.desc.user")
              : t("options.memory.desc.memory")}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs tabular-nums text-muted-foreground">
            {t("options.memory.chars", {
              count: entry.charCount.toLocaleString(),
              limit: entry.charLimit.toLocaleString(),
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

      <p
        className="truncate font-mono text-[10px] text-muted-foreground/70"
        data-selection="text"
        title={entry.path}
      >
        {entry.path}
      </p>

      {entry.entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("options.memory.empty")}
        </p>
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
                  {t("options.memory.charsLen", { count: record.text.length })}
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

export function SettingsMemory({
  embedded = false,
  profileId,
  headerActionsHost,
}: {
  embedded?: boolean;
  profileId?: string;
  headerActionsHost?: () => HTMLElement | null;
} = {}) {
  const { t } = useT();
  const adapter = getPlatform().agentMemory!;
  const [items, setItems] = useState<AgentMemoryTargetView[]>([]);
  const [preset, setPreset] = useState(profileId ?? "default");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adapter.list(profileId);
      setPreset(result.preset);
      setItems(result.targets);
    } catch (cause) {
      setItems([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [adapter, profileId]);

  const reset = useCallback(
    async (target: AgentMemoryTarget | "all" = "all") => {
      if (!confirm(t("options.memory.dsh.resetConfirm"))) return;
      setLoading(true);
      setError(null);
      try {
        await adapter.reset(profileId, target);
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      }
    },
    [adapter, profileId, refresh, t],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resetDisabled =
    loading || items.every((item) => item.entries.length === 0);
  const actions = embedded ? (
    <>
      <Button
        aria-label={t("options.memory.dsh.reset")}
        className="h-8 shrink-0 gap-1.5 text-xs text-destructive hover:text-destructive"
        disabled={resetDisabled}
        onClick={() => void reset()}
        size="icon"
        type="button"
        variant="ghost"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
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
    </>
  ) : (
    /* Section-hosted head keeps a single refresh icon (matches the plugin
     * inventory page); reset stays available in the embedded workspace. */
    <SettingsPageActionButton
      aria-label={t("options.memory.refresh")}
      disabled={loading}
      icon
      onClick={() => void refresh()}
      title={t("options.memory.refresh")}
      type="button"
      variant="ghost"
    >
      {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
    </SettingsPageActionButton>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {!embedded ? (
        <SettingsPageActions host={headerActionsHost}>
          {actions}
        </SettingsPageActions>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        <PageContent
          bodyClassName="space-y-4"
          className={embedded ? "pt-4" : "pt-3"}
          size="md"
        >
          {!embedded ? (
            <SettingsPageDescription>
              {t("options.memory.dsh.subtitle")}
            </SettingsPageDescription>
          ) : null}
          {embedded ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {t("options.memory.dsh.subtitle")}
              </p>
              <div className="flex items-center gap-1">{actions}</div>
            </div>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <section className="rounded-md border border-border/60 bg-muted/10">
            <div className="flex items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium">
                  {t("options.memory.dsh.pluginTitle")}
                </h3>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {t("options.memory.dsh.pluginDescription")}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                {t("options.memory.dsh.active")}
              </span>
            </div>
            <div className="grid items-center gap-2 border-t border-border/50 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_240px]">
              <div>
                <p className="text-xs font-medium">
                  {t("options.memory.dsh.preset")}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {t("options.memory.dsh.presetDescription")}
                </p>
              </div>
              <div className="truncate rounded-md border border-input bg-background px-3 py-2 font-mono text-xs">
                {preset}
              </div>
            </div>
          </section>
          {items.map((entry) => (
            <MemoryBlock entry={entry} key={entry.target} />
          ))}
        </PageContent>
      </ScrollArea>
    </div>
  );
}
