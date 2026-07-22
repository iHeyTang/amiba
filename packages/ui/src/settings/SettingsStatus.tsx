/**
 * Runtime health dashboard and lifecycle actions for Hermes Desktop.
 *
 * The page deliberately leads with a health conclusion, then progressively
 * reveals runtime details and lifecycle controls. Each action is colocated
 * with the state it affects: Hermes update belongs to runtime/version status,
 * while gateway restart belongs to gateway/process status. Long updater output
 * lives in the central Logs pane; gateway-restart output stays collapsed here.
 */

import {
  Activity,
  Check,
  ChevronDown,
  CircleCheck,
  CircleDot,
  Copy,
  Download,
  FileText,
  Gauge,
  Loader2,
  RefreshCw,
  RotateCw,
  Server,
  Terminal,
  TriangleAlert,
  UsersRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type ActionStatusResponse,
  type HermesStatusResponse,
  type LifecycleActionName,
  getActionStatus,
  getHermesStatus,
  restartHermesGateway,
  updateHermes,
} from "@amiba/core";
import { useT, type TranslateFn } from "@amiba/i18n";

import { Badge, Button, cn } from "../primitives";
import { SettingsPaneHeader } from "./SettingsPaneHeader";

const STATUS_POLL_MS = 10_000;
const ACTION_POLL_MS = 1_000;

const INSTALL_COMMANDS = [
  "hermes plugins install amiba-desktop/amiba-plugin-browser-tools",
  "hermes gateway",
  "amiba-backplane --port 9394",
];

interface ActionRunState {
  running: boolean;
  exitCode: number | null;
  pid: number | null;
  lines: string[];
  error: string | null;
}

const INITIAL_ACTION: ActionRunState = {
  running: false,
  exitCode: null,
  pid: null,
  lines: [],
  error: null,
};

type HealthKind = "healthy" | "offline" | "mismatch";

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function fmtTimestamp(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toLocaleString();
  }
  if (typeof value === "string" && value) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return new Date(n * 1000).toLocaleString();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
  }
  return "—";
}

function SectionHeading({
  title,
  subtitle,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <h3 className="text-sm font-semibold tracking-tight text-foreground">
        {title}
      </h3>
      {subtitle && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {subtitle}
        </p>
      )}
    </div>
  );
}

function OverviewPill({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: "default" | "success" | "warning" | "destructive";
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-3 py-2">
      <span
        className={cn(
          "shrink-0 text-muted-foreground",
          tone === "success" && "text-[hsl(var(--success))]",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
          tone === "destructive" && "text-destructive",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 truncate text-[11px] text-muted-foreground">
        {label}
        <span className="ml-1.5 font-semibold text-foreground">{value}</span>
      </span>
    </div>
  );
}

function InfoRow({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-4 border-b border-border/55 py-2 last:border-b-0">
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 text-right text-xs font-medium text-foreground">
        {children}
      </span>
    </div>
  );
}

function PathRow({
  label,
  value,
}: {
  label: React.ReactNode;
  value?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const displayValue = value || "—";

  async function copyValue() {
    if (!value || !(await copyToClipboard(value))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <div className="group flex min-h-9 items-center gap-3 border-b border-border/50 py-2 last:border-b-0">
      <span className="w-20 shrink-0 text-[10px] text-muted-foreground">
        {label}
      </span>
      <p
        className="min-w-0 flex-1 truncate text-right font-mono text-[10px] text-foreground"
        title={displayValue}
      >
        {displayValue}
      </p>
      {value && (
        <button
          type="button"
          onClick={() => void copyValue()}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label={String(label)}
        >
          {copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      )}
    </div>
  );
}

function ActionStateBadge({
  state,
  t,
}: {
  state: ActionRunState;
  t: TranslateFn;
}) {
  if (state.running) {
    return (
      <Badge variant="warning" className="gap-1.5 text-[10px]">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("options.status.actions.running")}
        {state.pid != null ? ` · PID ${state.pid}` : ""}
      </Badge>
    );
  }
  if (state.error) {
    return (
      <Badge variant="destructive" className="text-[10px]">
        {t("options.status.actions.failed")}
      </Badge>
    );
  }
  if (state.exitCode != null && state.exitCode !== 0) {
    return (
      <Badge variant="destructive" className="text-[10px]">
        {`${t("options.status.actions.failed")} · exit ${state.exitCode}`}
      </Badge>
    );
  }
  return null;
}

function GatewayActionDetails({
  state,
  t,
}: {
  state: ActionRunState;
  t: TranslateFn;
}) {
  if (
    !state.running &&
    !state.error &&
    (state.exitCode == null || state.exitCode === 0)
  ) {
    return null;
  }
  return (
    <details
      className="group mt-4 border-t border-border/60 pt-3"
      open={state.running || !!state.error}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[11px] font-medium text-muted-foreground transition hover:text-foreground">
        <span className="flex items-center gap-1.5">
          <Terminal className="h-3.5 w-3.5" />
          {t("options.status.actions.restartOutput")}
        </span>
        <ActionStateBadge state={state} t={t} />
      </summary>
      {state.error && (
        <p className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
          {state.error}
        </p>
      )}
      {state.lines.length > 0 && (
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/45 p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
          {state.lines.join("\n")}
        </pre>
      )}
    </details>
  );
}

function OnboardingGate({
  error,
  onRetry,
  loading,
  t,
}: {
  error: string;
  onRetry: () => void;
  loading: boolean;
  t: TranslateFn;
}) {
  const allCommands = INSTALL_COMMANDS.join("\n");
  const [copied, setCopied] = useState(false);

  async function copyAll() {
    if (!(await copyToClipboard(allCommands))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  const steps = [
    t("options.status.onboarding.step.install"),
    t("options.status.onboarding.step.plugin"),
    t("options.status.onboarding.step.run"),
  ];

  return (
    <section className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-amber-500/[0.045] shadow-sm">
      <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-amber-400/10 blur-3xl" />
      <div className="relative p-6 sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <WifiOff className="h-5 w-5" />
            </span>
            <div className="min-w-0 space-y-1.5">
              <h3 className="text-base font-semibold tracking-tight text-foreground">
                {t("options.status.onboarding.title")}
              </h3>
              <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
                {t("options.status.onboarding.description")}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={onRetry}
            disabled={loading}
            className="shrink-0"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t("options.status.onboarding.retry")}
          </Button>
        </div>

        <div className="mt-6 grid gap-2.5 sm:grid-cols-3">
          {steps.map((step, index) => (
            <div
              key={step}
              className="flex items-start gap-2.5 rounded-lg border border-amber-500/15 bg-background/55 p-3"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                {index + 1}
              </span>
              <span className="text-[11px] leading-relaxed text-foreground/80">
                {step}
              </span>
            </div>
          ))}
        </div>

        <details className="mt-4 rounded-lg border border-border/60 bg-background/60 px-3.5 py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[11px] font-medium text-foreground">
            <span className="flex items-center gap-1.5">
              <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
              {t("options.status.onboarding.manual")}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-2 text-[10px]"
              onClick={(event) => {
                event.preventDefault();
                void copyAll();
              }}
            >
              {copied ? (
                <Check className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              {t(
                copied
                  ? "options.status.onboarding.copied"
                  : "options.status.onboarding.copy",
              )}
            </Button>
          </summary>
          <pre className="mt-3 overflow-x-auto rounded-md bg-muted/45 p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
            {allCommands}
          </pre>
        </details>

        <details className="mt-3 text-[10px] text-muted-foreground">
          <summary className="cursor-pointer">
            {t("options.status.onboarding.error")}
          </summary>
          <pre className="mt-1 whitespace-pre-wrap break-all">{error}</pre>
        </details>
      </div>
    </section>
  );
}

function ProtocolMismatchBanner({
  mismatch,
  t,
}: {
  mismatch: HermesStatusResponse["protocol_mismatch"];
  t: TranslateFn;
}) {
  if (!mismatch) return null;
  const message =
    mismatch.advise === "update-backplane"
      ? t("options.status.protocol.backplane", {
          current: mismatch.backplane,
          expected: mismatch.expected,
        })
      : t("options.status.protocol.client", {
          current: mismatch.backplane,
          expected: mismatch.expected,
        });

  return (
    <section className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.055] px-4 py-3.5">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="space-y-0.5">
        <h3 className="text-xs font-semibold text-foreground">
          {t("options.status.protocol.title")}
        </h3>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {message}
        </p>
      </div>
    </section>
  );
}

function StatusSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-56 rounded-2xl border border-border/60 bg-muted/25" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-80 rounded-xl border border-border/60 bg-muted/20" />
        <div className="h-80 rounded-xl border border-border/60 bg-muted/20" />
      </div>
    </div>
  );
}

export interface SettingsStatusProps {
  /** Opens the central Logs pane with the Hermes update log selected. */
  onViewUpdateLogs?: () => void;
}

export function SettingsStatus({ onViewUpdateLogs }: SettingsStatusProps = {}) {
  const { t, language } = useT();
  const [status, setStatus] = useState<HermesStatusResponse | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);

  const [gwState, setGwState] = useState<ActionRunState>(INITIAL_ACTION);
  const [updState, setUpdState] = useState<ActionRunState>(INITIAL_ACTION);
  const [triggering, setTriggering] = useState<{ gw: boolean; upd: boolean }>({
    gw: false,
    upd: false,
  });

  const gwAbort = useRef<AbortController | null>(null);
  const updAbort = useRef<AbortController | null>(null);

  const refreshStatus = useCallback(
    async (opts?: { forceUpdateCheck?: boolean }) => {
      setStatusLoading(true);
      const r = await getHermesStatus({
        forceUpdateCheck: opts?.forceUpdateCheck,
      });
      if (!r.ok) {
        setStatusErr(r.error || "unknown error");
      } else {
        setStatusErr(null);
        setStatus(r);
      }
      setLastCheckedAt(new Date());
      setStatusLoading(false);
    },
    [],
  );

  useEffect(() => {
    void refreshStatus();
    const id = window.setInterval(() => void refreshStatus(), STATUS_POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshStatus]);

  const pollAction = useCallback(
    async (
      name: LifecycleActionName,
      setState: React.Dispatch<React.SetStateAction<ActionRunState>>,
      abortRef: React.MutableRefObject<AbortController | null>,
    ) => {
      const ctrl = new AbortController();
      abortRef.current?.abort();
      abortRef.current = ctrl;

      while (!ctrl.signal.aborted) {
        const r: ActionStatusResponse = await getActionStatus(
          name,
          200,
          ctrl.signal,
        );
        if (ctrl.signal.aborted) return;
        if (!r.ok) {
          setState((prev) => ({ ...prev, error: r.error || "poll failed" }));
          break;
        }
        setState({
          running: !!r.running,
          exitCode: r.exit_code ?? null,
          pid: r.pid ?? null,
          lines: r.lines ?? [],
          error: null,
        });
        if (!r.running) {
          if (r.exit_code != null) {
            void refreshStatus({
              forceUpdateCheck: name === "hermes-update",
            });
          }
          break;
        }
        await new Promise<void>((resolve) =>
          window.setTimeout(resolve, ACTION_POLL_MS),
        );
      }
    },
    [refreshStatus],
  );

  useEffect(() => {
    void pollAction("gateway-restart", setGwState, gwAbort);
    void pollAction("hermes-update", setUpdState, updAbort);
    return () => {
      gwAbort.current?.abort();
      updAbort.current?.abort();
    };
  }, [pollAction]);

  const triggerGateway = useCallback(async () => {
    setTriggering((current) => ({ ...current, gw: true }));
    const r = await restartHermesGateway();
    setTriggering((current) => ({ ...current, gw: false }));
    if (!r.ok) {
      setGwState((current) => ({
        ...current,
        error: r.error || "spawn failed",
      }));
      return;
    }
    setGwState({
      running: true,
      exitCode: null,
      pid: r.pid ?? null,
      lines: [],
      error: null,
    });
    void pollAction("gateway-restart", setGwState, gwAbort);
  }, [pollAction]);

  const triggerUpdate = useCallback(async () => {
    setTriggering((current) => ({ ...current, upd: true }));
    const r = await updateHermes();
    setTriggering((current) => ({ ...current, upd: false }));
    if (!r.ok) {
      setUpdState((current) => ({
        ...current,
        error: r.error || "spawn failed",
      }));
      return;
    }
    setUpdState({
      running: true,
      exitCode: null,
      pid: r.pid ?? null,
      lines: [],
      error: null,
    });
    void pollAction("hermes-update", setUpdState, updAbort);
  }, [pollAction]);

  const versionMismatch =
    status?.config_version != null &&
    status?.latest_config_version != null &&
    status.config_version !== status.latest_config_version;
  const updateAvailable = status?.update_check?.status === "behind";
  const healthKind: HealthKind = status?.protocol_mismatch
    ? "mismatch"
    : status?.gateway_running
      ? "healthy"
      : "offline";
  const platformNames = Object.keys(status?.gateway_platforms ?? {});
  const lastCheckedLabel = lastCheckedAt
    ? lastCheckedAt.toLocaleTimeString(language === "zh-CN" ? "zh-CN" : "en", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  const healthConfig = {
    healthy: {
      icon: CircleCheck,
      title: t("options.status.health.healthy.title"),
      subtitle: t("options.status.health.healthy.subtitle"),
      iconClass:
        "border-[hsl(var(--success))]/25 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]",
    },
    offline: {
      icon: WifiOff,
      title: t("options.status.health.offline.title"),
      subtitle: t("options.status.health.offline.subtitle"),
      iconClass: "border-destructive/20 bg-destructive/10 text-destructive",
    },
    mismatch: {
      icon: TriangleAlert,
      title: t("options.status.health.mismatch.title"),
      subtitle: t("options.status.health.mismatch.subtitle"),
      iconClass:
        "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    },
  }[healthKind];
  const HealthIcon = healthConfig.icon;

  let updateSummary = t("options.status.actions.update.unknown");
  if (status?.update_check?.status === "up_to_date") {
    updateSummary = t("options.status.actions.update.latest");
  } else if (updateAvailable) {
    const commits = status?.update_check?.commits_behind;
    updateSummary =
      typeof commits === "number" && commits > 0
        ? t("options.status.actions.update.behind", { count: commits })
        : t("options.status.actions.update.available");
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SettingsPaneHeader
        title={t("options.status.title")}
        subtitle={t("options.status.subtitle")}
      >
        <div className="flex items-center gap-3">
          <span className="hidden text-[10px] text-muted-foreground sm:inline">
            {t("options.status.lastChecked", { time: lastCheckedLabel })}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => void refreshStatus({ forceUpdateCheck: true })}
            disabled={statusLoading}
          >
            {statusLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t("options.status.refresh")}
          </Button>
        </div>
      </SettingsPaneHeader>

      <div className="min-h-0 flex-1 overflow-auto px-6 pb-8 pt-3">
        <div className="mx-auto w-full max-w-6xl space-y-4">
          {statusErr ? (
            <OnboardingGate
              error={statusErr}
              onRetry={() => void refreshStatus()}
              loading={statusLoading}
              t={t}
            />
          ) : !status ? (
            <StatusSkeleton />
          ) : (
            <>
              <section className="relative overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
                <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-primary/[0.07] blur-3xl" />
                <div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
                        healthConfig.iconClass,
                      )}
                    >
                      <HealthIcon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold tracking-tight text-foreground">
                          {healthConfig.title}
                        </h3>
                        {updateAvailable && (
                          <Badge variant="warning" className="text-[10px]">
                            {t("options.status.metric.updateAvailable")}
                          </Badge>
                        )}
                      </div>
                      <p className="max-w-lg text-[11px] leading-relaxed text-muted-foreground">
                        {healthConfig.subtitle}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <OverviewPill
                      icon={
                        status.gateway_running ? (
                          <Wifi className="h-3.5 w-3.5" />
                        ) : (
                          <WifiOff className="h-3.5 w-3.5" />
                        )
                      }
                      label={t("options.status.metric.gateway")}
                      value={t(
                        status.gateway_running
                          ? "options.status.metric.online"
                          : "options.status.metric.offline",
                      )}
                      tone={status.gateway_running ? "success" : "destructive"}
                    />
                    <OverviewPill
                      icon={<UsersRound className="h-3.5 w-3.5" />}
                      label={t("options.status.metric.sessions")}
                      value={status.active_sessions ?? 0}
                    />
                    <OverviewPill
                      icon={<Activity className="h-3.5 w-3.5" />}
                      label="Hermes"
                      value={status.version || "—"}
                    />
                  </div>
                </div>
              </section>

              {status.protocol_mismatch && (
                <ProtocolMismatchBanner
                  mismatch={status.protocol_mismatch}
                  t={t}
                />
              )}

              <div className="grid gap-3 lg:grid-cols-2">
                <section className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
                  <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3.5">
                    <div className="flex items-start gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Gauge className="h-4 w-4" />
                      </span>
                      <SectionHeading
                        title={t("options.status.runtime.title")}
                        subtitle={t("options.status.runtime.subtitle")}
                      />
                    </div>
                    {updateAvailable && (
                      <Badge variant="warning" className="shrink-0 text-[9px]">
                        {t("options.status.actions.update.available")}
                      </Badge>
                    )}
                  </div>
                  <div className="px-4 py-1.5">
                    <InfoRow label={t("options.status.runtime.release")}>
                      <span>{status.version || "—"}</span>
                      {status.release_date && (
                        <span className="ml-1.5 font-normal text-muted-foreground">
                          · {status.release_date}
                        </span>
                      )}
                    </InfoRow>
                    <InfoRow label={t("options.status.runtime.configVersion")}>
                      <span className="inline-flex items-center justify-end gap-1.5">
                        <span className="font-mono">
                          {status.config_version ?? "—"}
                        </span>
                        {status.latest_config_version != null && (
                          <Badge
                            variant={versionMismatch ? "warning" : "secondary"}
                            className="text-[9px]"
                          >
                            {t("options.status.runtime.latest", {
                              version: status.latest_config_version,
                            })}
                          </Badge>
                        )}
                      </span>
                    </InfoRow>
                    <InfoRow label={t("options.status.runtime.activeSessions")}>
                      {status.active_sessions ?? 0}
                    </InfoRow>
                  </div>
                  <div
                    className={cn(
                      "border-t border-border/60 px-4 py-3",
                      updateAvailable && "bg-amber-500/[0.035]",
                    )}
                  >
                    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                            updateAvailable
                              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </span>
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <p className="truncate text-[11px] font-medium text-foreground">
                            {updateSummary}
                          </p>
                          <ActionStateBadge state={updState} t={t} />
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                        <Button
                          size="sm"
                          variant={updateAvailable ? "default" : "outline"}
                          className="h-8"
                          onClick={() => void triggerUpdate()}
                          disabled={updState.running || triggering.upd}
                        >
                          {updState.running || triggering.upd ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                          {t("options.status.actions.update.button")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8"
                          onClick={onViewUpdateLogs}
                          disabled={!onViewUpdateLogs}
                        >
                          <FileText className="h-3.5 w-3.5" />
                          {t("options.status.viewUpdateLogs")}
                        </Button>
                      </div>
                    </div>
                    {updState.error && (
                      <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                        {updState.error}
                      </p>
                    )}
                  </div>
                  <details className="group border-t border-border/60">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[11px] font-medium text-muted-foreground transition hover:bg-muted/25 hover:text-foreground">
                      <span className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5" />
                        {t("options.status.runtime.paths")}
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="border-t border-border/50 px-4 py-1.5">
                      <PathRow
                        label={t("options.status.runtime.hermesHome")}
                        value={status.hermes_home}
                      />
                      <PathRow
                        label={t("options.status.runtime.configPath")}
                        value={status.config_path}
                      />
                      <PathRow
                        label={t("options.status.runtime.envPath")}
                        value={status.env_path}
                      />
                    </div>
                  </details>
                </section>

                <section className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
                  <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3.5">
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                          status.gateway_running
                            ? "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]"
                            : "bg-destructive/10 text-destructive",
                        )}
                      >
                        <Server className="h-4 w-4" />
                      </span>
                      <SectionHeading
                        title={t("options.status.gateway.title")}
                        subtitle={t("options.status.gateway.subtitle")}
                      />
                    </div>
                    <Badge
                      variant={
                        status.gateway_running ? "success" : "destructive"
                      }
                      className="gap-1.5 text-[10px]"
                    >
                      <CircleDot className="h-3 w-3" />
                      {t(
                        status.gateway_running
                          ? "options.status.metric.online"
                          : "options.status.metric.offline",
                      )}
                    </Badge>
                  </div>
                  <div className="px-4 py-1.5">
                    <InfoRow label={t("options.status.gateway.state")}>
                      {status.gateway_state ?? "—"}
                    </InfoRow>
                    <InfoRow label={t("options.status.gateway.pid")}>
                      <span className="font-mono">
                        {status.gateway_pid ?? "—"}
                      </span>
                    </InfoRow>
                    <InfoRow label={t("options.status.gateway.updatedAt")}>
                      {fmtTimestamp(status.gateway_updated_at)}
                    </InfoRow>
                    <InfoRow label={t("options.status.gateway.platforms")}>
                      {platformNames.length > 0 ? (
                        <span className="flex flex-wrap justify-end gap-1">
                          {platformNames.map((name) => (
                            <Badge
                              key={name}
                              variant="secondary"
                              className="text-[9px]"
                            >
                              {name}
                            </Badge>
                          ))}
                        </span>
                      ) : (
                        <span className="font-normal text-muted-foreground">
                          {t("options.status.gateway.noPlatforms")}
                        </span>
                      )}
                    </InfoRow>
                  </div>
                  {status.gateway_exit_reason && (
                    <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/[0.045] px-3 py-2.5">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                      <div className="min-w-0">
                        <p className="text-[10px] font-medium text-destructive">
                          {t("options.status.gateway.lastExit")}
                        </p>
                        <p className="mt-0.5 break-words text-[11px] text-muted-foreground">
                          {status.gateway_exit_reason}
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="border-t border-border/60 px-4 py-3">
                    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                          <RotateCw className="h-3.5 w-3.5" />
                        </span>
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <p className="text-[11px] font-medium text-foreground">
                            {t("options.status.actions.restart.title")}
                          </p>
                          <ActionStateBadge state={gwState} t={t} />
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 shrink-0"
                        onClick={() => void triggerGateway()}
                        disabled={gwState.running || triggering.gw}
                      >
                        {gwState.running || triggering.gw ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCw className="h-3.5 w-3.5" />
                        )}
                        {t("options.status.actions.restart.button")}
                      </Button>
                    </div>
                    <GatewayActionDetails state={gwState} t={t} />
                  </div>
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
