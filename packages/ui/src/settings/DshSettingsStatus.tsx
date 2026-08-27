import {
  Check,
  ChevronDown,
  CircleCheck,
  CircleDot,
  Copy,
  Gauge,
  Loader2,
  RefreshCw,
  RotateCw,
  Server,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useT } from "@amiba/i18n";
import {
  getPlatform,
  type AgentRuntimeStatus,
} from "@amiba/app-runtime/platform";

import { Badge, Button, cn } from "../primitives";
import { SettingsPageDescription } from "./page-chrome";

const POLL_MS = 10_000;

function StatusLine({
  label,
  children,
  actions,
}: {
  label: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-11 items-center gap-2 px-4 py-2 sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="min-w-0 text-xs font-medium text-foreground">
        {children}
      </span>
      {actions ? (
        <span className="flex flex-wrap items-center gap-1.5 sm:justify-self-end">
          {actions}
        </span>
      ) : null}
    </div>
  );
}

function StatusSkeleton() {
  return (
    <div className="animate-pulse space-y-7">
      <div className="h-16 bg-muted/10" />
      <div className="h-44 bg-muted/10" />
      <div className="h-24 bg-muted/10" />
    </div>
  );
}

function PathValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className="min-w-0 flex-1 truncate font-mono text-[10px]"
        title={value}
      >
        {value}
      </span>
      <button
        aria-label="Copy path"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() =>
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1_500);
          })
        }
        type="button"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}

export function DshSettingsStatus() {
  const { t, language } = useT();
  const adapter = getPlatform().agentDiagnostics!;
  const [status, setStatus] = useState<AgentRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await adapter.status());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLastCheckedAt(new Date());
      setLoading(false);
    }
  }, [adapter]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const restart = async () => {
    if (!window.confirm(t("options.status.dsh.restartConfirm"))) return;
    setRestarting(true);
    setError(null);
    try {
      setStatus(await adapter.restart());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRestarting(false);
    }
  };

  const HealthyIcon = status?.healthy ? CircleCheck : TriangleAlert;
  const lastCheckedLabel = lastCheckedAt
    ? lastCheckedAt.toLocaleTimeString(language === "zh-CN" ? "zh-CN" : "en", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";
  return (
    <div className="space-y-7">
      <SettingsPageDescription>
        {t("options.status.dsh.subtitle")}
      </SettingsPageDescription>
      {error && !status ? (
        <section className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-destructive/20 bg-destructive/[0.035] px-6 text-center">
          <TriangleAlert className="h-6 w-6 text-destructive" />
          <h3 className="mt-3 text-sm font-semibold">
            {t("options.status.dsh.unhealthy")}
          </h3>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            {error}
          </p>
          <Button
            className="mt-4"
            disabled={loading}
            onClick={() => void refresh()}
            size="sm"
            variant="outline"
          >
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {t("common.retry")}
          </Button>
        </section>
      ) : !status ? (
        <StatusSkeleton />
      ) : (
        <>
          {error ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          <section className="flex flex-col gap-3 border-b border-border/70 pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border",
                  status?.healthy
                    ? "border-[hsl(var(--success))]/25 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]"
                    : "border-amber-500/25 bg-amber-500/10 text-amber-600",
                )}
              >
                {loading && !status ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <HealthyIcon className="h-4 w-4" />
                )}
              </span>
              <div>
                <h3 className="text-sm font-semibold">
                  {t(
                    status?.healthy
                      ? "options.status.dsh.healthy"
                      : "options.status.dsh.unhealthy",
                  )}
                </h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {status?.error || t("options.status.dsh.managed")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden text-[10px] text-muted-foreground md:inline">
                {t("options.status.dsh.lastChecked", {
                  time: lastCheckedLabel,
                })}
              </span>
              <Badge
                className="gap-1.5 text-[10px]"
                variant={status.healthy ? "success" : "destructive"}
              >
                <CircleDot className="h-3 w-3" />
                {status.state}
              </Badge>
              <Button
                disabled={loading}
                onClick={() => void refresh()}
                size="sm"
                type="button"
                variant="ghost"
              >
                {loading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                {t("common.refresh")}
              </Button>
              <Button
                disabled={restarting}
                onClick={() => void restart()}
                size="sm"
                type="button"
                variant="outline"
              >
                {restarting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RotateCw className="h-3 w-3" />
                )}
                {t("options.status.dsh.restart")}
              </Button>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2 px-1">
              <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {t("options.status.dsh.runtime")}
              </h3>
            </div>
            <div className="space-y-0.5">
              <StatusLine label={t("options.status.dsh.version")}>
                <span className="font-mono">{status.version}</span>
              </StatusLine>
              <StatusLine label={t("options.status.dsh.node")}>
                <span className="font-mono">{status.nodeVersion}</span>
              </StatusLine>
              <StatusLine
                label={t("options.status.dsh.process")}
                actions={
                  <Badge
                    className="text-[9px]"
                    variant={status.healthy ? "success" : "destructive"}
                  >
                    {status.state}
                  </Badge>
                }
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span>{status.pid ? `PID ${status.pid}` : "—"}</span>
                  {status.startedAt ? (
                    <span className="font-normal text-muted-foreground">
                      · {new Date(status.startedAt).toLocaleString()}
                    </span>
                  ) : null}
                </span>
              </StatusLine>
              <StatusLine label={t("options.status.dsh.sessions")}>
                <span className="tabular-nums">
                  {status.liveSessionCount} / {status.sessionCount}
                </span>
              </StatusLine>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2 px-1">
              <Server className="h-3.5 w-3.5 text-muted-foreground" />
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {t("options.status.dsh.paths")}
              </h3>
            </div>
            <details className="group">
              <summary className="grid min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-4 py-2 text-[11px] transition hover:bg-muted/20 sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
                <span className="text-muted-foreground">DSH_HOME</span>
                <span className="min-w-0 truncate font-mono text-[10px] text-foreground">
                  {status.paths.home}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-1 rounded-md bg-muted/[0.16] px-4 py-1.5 sm:pl-[8.75rem]">
                <div className="grid items-center gap-2 py-1.5 sm:grid-cols-[7rem_minmax(0,1fr)]">
                  <span className="text-[10px] text-muted-foreground">
                    DSH_HOME
                  </span>
                  <PathValue value={status.paths.home} />
                </div>
                <div className="grid items-center gap-2 py-1.5 sm:grid-cols-[7rem_minmax(0,1fr)]">
                  <span className="text-[10px] text-muted-foreground">
                    DSH_AGENTS_HOME
                  </span>
                  <PathValue value={status.paths.agentsHome} />
                </div>
                <div className="grid items-center gap-2 py-1.5 sm:grid-cols-[7rem_minmax(0,1fr)]">
                  <span className="text-[10px] text-muted-foreground">
                    {t("options.status.dsh.bundle")}
                  </span>
                  <PathValue value={status.paths.runtimeDir} />
                </div>
              </div>
            </details>
          </section>
        </>
      )}
    </div>
  );
}
