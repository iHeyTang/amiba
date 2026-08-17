import { FileText, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useT } from "@amiba/i18n";
import {
  getPlatform,
  type AgentRuntimeLogEntry,
  type AgentRuntimeLogLevel,
} from "@amiba/app-runtime/platform";

import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  cn,
} from "../primitives";
import { SettingsPageActions, SettingsPageDescription } from "./page-chrome";

const LEVELS: Array<AgentRuntimeLogLevel | "all"> = [
  "all",
  "debug",
  "info",
  "warning",
  "error",
];
const STREAMS: Array<AgentRuntimeLogEntry["stream"] | "all"> = [
  "all",
  "system",
  "stdout",
  "stderr",
];
const LIMITS = [50, 100, 200, 500, 1000] as const;

const COLORS: Record<AgentRuntimeLogLevel, string> = {
  debug: "text-muted-foreground",
  info: "text-foreground",
  warning: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
};

export function DshSettingsLogs() {
  const { t } = useT();
  const adapter = getPlatform().agentDiagnostics!;
  const [entries, setEntries] = useState<AgentRuntimeLogEntry[]>([]);
  const [level, setLevel] = useState<AgentRuntimeLogLevel | "all">("all");
  const [stream, setStream] = useState<AgentRuntimeLogEntry["stream"] | "all">(
    "all",
  );
  const [limit, setLimit] = useState<(typeof LIMITS)[number]>(200);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adapter.logs({
        limit,
        level,
        stream,
        search: debouncedSearch || undefined,
      });
      setEntries(result.entries);
      setError(null);
      window.requestAnimationFrame(() => {
        if (scrollRef.current)
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [adapter, debouncedSearch, level, limit, stream]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(id);
  }, [autoRefresh, refresh]);

  return (
    <div className="space-y-4">
      <SettingsPageActions>
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex items-center gap-2">
            <Label
              className="cursor-pointer text-[11px] text-muted-foreground"
              htmlFor="dsh-logs-auto-refresh"
            >
              {t("options.logs.autoRefresh")}
            </Label>
            <Switch
              checked={autoRefresh}
              id="dsh-logs-auto-refresh"
              onCheckedChange={setAutoRefresh}
            />
            {autoRefresh ? (
              <Badge className="gap-1 text-[10px]" variant="success">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                {t("options.logs.live")}
              </Badge>
            ) : null}
          </div>
          <Button
            className="h-8 gap-1.5 text-xs"
            disabled={loading}
            onClick={() => void refresh()}
            size="sm"
            type="button"
            variant="outline"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t("common.refresh")}
          </Button>
        </div>
      </SettingsPageActions>

      <SettingsPageDescription>
        {t("options.logs.dsh.subtitle")}
      </SettingsPageDescription>

      <div className="flex flex-wrap items-end gap-3">
        <DshFilter label={t("options.logs.level.label")}>
          <Select
            onValueChange={(value) => setLevel(value as typeof level)}
            value={level}
          >
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEVELS.map((value) => (
                <SelectItem className="text-xs" key={value} value={value}>
                  {value.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </DshFilter>
        <DshFilter label={t("options.logs.dsh.stream")}>
          <Select
            onValueChange={(value) => setStream(value as typeof stream)}
            value={stream}
          >
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STREAMS.map((value) => (
                <SelectItem className="text-xs" key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </DshFilter>
        <DshFilter label={t("options.logs.lines.label")}>
          <Select
            onValueChange={(value) => setLimit(Number(value) as typeof limit)}
            value={String(limit)}
          >
            <SelectTrigger className="h-8 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIMITS.map((value) => (
                <SelectItem
                  className="text-xs"
                  key={value}
                  value={String(value)}
                >
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </DshFilter>
        <DshFilter grow label={t("options.logs.search.label")}>
          <Input
            className="h-8 text-xs"
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("options.logs.search.placeholder")}
            value={search}
          />
        </DshFilter>
      </div>

      <section className="overflow-hidden rounded-md border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2 text-xs">
          <span className="flex items-center gap-2 font-mono">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            dsh-runtime.log
          </span>
          <span className="text-[10px] text-muted-foreground">
            {t("options.logs.lineCount", { count: entries.length })}
          </span>
        </header>
        {error ? (
          <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}
        <div
          className="min-h-[400px] max-h-[calc(100vh-280px)] overflow-auto p-3 font-mono text-[11px] leading-5"
          data-selection="text"
          ref={scrollRef}
        >
          {entries.length === 0 && !loading && !error ? (
            <p className="py-8 text-center text-muted-foreground">
              {t("options.logs.empty")}
            </p>
          ) : null}
          {entries.map((entry) => (
            <div
              className={cn(
                COLORS[entry.level],
                "whitespace-pre-wrap break-words rounded px-1 hover:bg-muted/40",
              )}
              key={entry.seq}
            >
              <span className="text-muted-foreground/65">
                {new Date(entry.ts).toISOString()} [{entry.level.toUpperCase()}]
                [{entry.stream}]{" "}
              </span>
              {entry.message}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function DshFilter({
  label,
  children,
  grow,
}: {
  label: string;
  children: React.ReactNode;
  grow?: boolean;
}) {
  return (
    <div
      className={cn("flex flex-col gap-1", grow && "min-w-0 flex-1 basis-48")}
    >
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}
