/**
 * Runtime health settings and lifecycle actions for Hermes Desktop.
 *
 * The page deliberately leads with a health conclusion, then progressively
 * reveals runtime details and lifecycle controls. Each action is colocated
 * with the state it affects: Hermes update belongs to runtime/version status,
 * while gateway restart belongs to gateway/process status. Long updater output
 * lives in the central Logs pane; gateway-restart output stays collapsed here.
 */

import {
  Check,
  Archive,
  BrainCircuit,
  Bug,
  ChevronDown,
  CircleCheck,
  CircleDot,
  Copy,
  Download,
  FileText,
  Gauge,
  HeartPulse,
  Loader2,
  RefreshCw,
  RotateCw,
  Server,
  ShieldCheck,
  Terminal,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type ActionStatusResponse,
  type HermesStatusResponse,
  type LifecycleActionName,
  type MaintenanceActionName,
  getActionStatus,
  getHermesStatus,
  restartHermesGateway,
  runHermesMaintenance,
  updateHermes,
} from "@amiba/core";
import { useT, type TranslateFn } from "@amiba/i18n";

import { Badge, Button, PageContent, cn } from "../primitives";
import { SettingsPaneHeader } from "./SettingsPaneHeader";

const STATUS_POLL_MS = 10_000;
const ACTION_POLL_MS = 1_000;

const RECOVERY_NOTES = [
  "Hermes is installed and supervised by Amiba.",
  "Use Check again; if recovery still fails, restart Amiba and inspect the technical details below.",
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

function StatusLine({
  label,
  children,
  actions,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-11 items-center gap-2 px-4 py-2 sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="min-w-0 text-xs font-medium text-foreground">
        {children}
      </span>
      {actions && (
        <span className="flex flex-wrap items-center gap-1.5 sm:justify-self-end">
          {actions}
        </span>
      )}
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
    <div className="group flex min-h-9 items-center gap-3 py-2">
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
      className="group px-4 py-2.5"
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
        <pre
          data-selection="text"
          className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/45 p-3 font-mono text-[10px] leading-relaxed text-muted-foreground"
        >
          {state.lines.join("\n")}
        </pre>
      )}
    </details>
  );
}

function ServiceUnavailableGate({
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
  const allCommands = RECOVERY_NOTES.join("\n");
  const [copied, setCopied] = useState(false);

  async function copyAll() {
    if (!(await copyToClipboard(allCommands))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  const steps = [
    t("options.status.recovery.step.runtime"),
    t("options.status.recovery.step.backplane"),
    t("options.status.recovery.step.services"),
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
                {t("options.status.recovery.title")}
              </h3>
              <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
                {t("options.status.recovery.description")}
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
            {t("options.status.recovery.retry")}
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
              {t("options.status.recovery.manual")}
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
                  ? "options.status.recovery.copied"
                  : "options.status.recovery.copy",
              )}
            </Button>
          </summary>
          <pre
            data-selection="text"
            className="mt-3 overflow-x-auto rounded-md bg-muted/45 p-3 font-mono text-[10px] leading-relaxed text-muted-foreground"
          >
            {allCommands}
          </pre>
        </details>

        <details className="mt-3 text-[10px] text-muted-foreground">
          <summary className="cursor-pointer">
            {t("options.status.recovery.error")}
          </summary>
          <pre
            data-selection="text"
            className="mt-1 whitespace-pre-wrap break-all"
          >
            {error}
          </pre>
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

function HermesVersionMismatchBanner({
  mismatch,
  t,
}: {
  mismatch: HermesStatusResponse["hermes_version_mismatch"];
  t: TranslateFn;
}) {
  if (!mismatch) return null;
  return (
    <section className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.055] px-4 py-3.5">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="space-y-0.5">
        <h3 className="text-xs font-semibold text-foreground">
          {t("options.status.hermesVersion.title")}
        </h3>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t(
            mismatch.reason === "unverifiable"
              ? "options.status.hermesVersion.unverifiable"
              : "options.status.hermesVersion.unsupported",
            {
              current: mismatch.installed || "unknown",
              required: mismatch.required,
            },
          )}
        </p>
      </div>
    </section>
  );
}

function StatusSkeleton() {
  return (
    <div className="animate-pulse space-y-7">
      <div className="h-16 bg-muted/10" />
      <div className="h-44 bg-muted/10" />
      <div className="h-52 bg-muted/10" />
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
  const [maintenanceName, setMaintenanceName] =
    useState<MaintenanceActionName | null>(null);
  const [maintenanceState, setMaintenanceState] =
    useState<ActionRunState>(INITIAL_ACTION);
  const [triggering, setTriggering] = useState<{ gw: boolean; upd: boolean }>({
    gw: false,
    upd: false,
  });

  const gwAbort = useRef<AbortController | null>(null);
  const updAbort = useRef<AbortController | null>(null);
  const maintenanceAbort = useRef<AbortController | null>(null);

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
      maintenanceAbort.current?.abort();
    };
  }, [pollAction]);

  const triggerMaintenance = useCallback(
    async (name: MaintenanceActionName) => {
      if (maintenanceState.running) return;
      setMaintenanceName(name);
      setMaintenanceState({ ...INITIAL_ACTION, running: true });
      const result = await runHermesMaintenance(name);
      if (!result.ok) {
        setMaintenanceState({
          ...INITIAL_ACTION,
          error: result.error || "spawn failed",
        });
        return;
      }
      setMaintenanceState({
        running: true,
        exitCode: null,
        pid: result.pid ?? null,
        lines: [],
        error: null,
      });
      void pollAction(name, setMaintenanceState, maintenanceAbort);
    },
    [maintenanceState.running, pollAction],
  );

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

  const configVersionMismatch =
    status?.config_version != null &&
    status?.latest_config_version != null &&
    status.config_version !== status.latest_config_version;
  const updateAvailable = status?.update_check?.status === "behind";
  const runtimeManaged = !!status?.runtime_managed;
  const healthKind: HealthKind =
    status?.protocol_mismatch || status?.hermes_version_mismatch
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
      subtitle: status?.hermes_version_mismatch
        ? t("options.status.health.mismatch.hermesVersion")
        : t("options.status.health.mismatch.subtitle"),
      iconClass:
        "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    },
  }[healthKind];
  const HealthIcon = healthConfig.icon;

  let updateSummary = t("options.status.actions.update.unknown");
  if (runtimeManaged) {
    updateSummary = t("options.status.actions.update.managed");
  } else if (status?.update_check?.status === "up_to_date") {
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
      />

      <div className="min-h-0 flex-1 overflow-auto">
        <PageContent bodyClassName="space-y-3" className="pt-3" size="md">
          {statusErr ? (
            <ServiceUnavailableGate
              error={statusErr}
              onRetry={() => void refreshStatus()}
              loading={statusLoading}
              t={t}
            />
          ) : !status ? (
            <StatusSkeleton />
          ) : (
            <>
              {status.hermes_version_mismatch && (
                <HermesVersionMismatchBanner
                  mismatch={status.hermes_version_mismatch}
                  t={t}
                />
              )}
              {status.protocol_mismatch && (
                <ProtocolMismatchBanner
                  mismatch={status.protocol_mismatch}
                  t={t}
                />
              )}

              <div className="space-y-7">
                <section className="flex flex-col gap-3 border-b border-border/70 pb-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border",
                        healthConfig.iconClass,
                      )}
                    >
                      <HealthIcon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold tracking-tight text-foreground">
                        {healthConfig.title}
                      </h3>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                        {healthConfig.subtitle}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <span className="hidden text-[10px] text-muted-foreground md:inline">
                      {t("options.status.lastChecked", {
                        time: lastCheckedLabel,
                      })}
                    </span>
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
                    <span className="font-mono text-[11px] font-semibold text-foreground">
                      Hermes {status.version || "—"}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[10px]"
                      onClick={() =>
                        void refreshStatus({ forceUpdateCheck: true })
                      }
                      disabled={statusLoading}
                    >
                      {statusLoading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      {t("options.status.refresh")}
                    </Button>
                  </div>
                </section>

                <section>
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
                    <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {t("options.status.runtime.title")}
                    </h3>
                  </div>
                  <div className="space-y-0.5">
                    <StatusLine
                      label={t("options.status.runtime.release")}
                      actions={
                        runtimeManaged ? (
                          <Badge variant="secondary" className="text-[9px]">
                            {t("options.status.actions.update.managed")}
                          </Badge>
                        ) : (
                          <>
                            <ActionStateBadge state={updState} t={t} />
                            <Button
                              size="sm"
                              variant={updateAvailable ? "default" : "outline"}
                              className="h-7 px-2.5 text-[10px]"
                              onClick={() => void triggerUpdate()}
                              disabled={updState.running || triggering.upd}
                            >
                              {updState.running || triggering.upd ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Download className="h-3 w-3" />
                              )}
                              {t("options.status.actions.update.button")}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-[10px]"
                              onClick={onViewUpdateLogs}
                              disabled={!onViewUpdateLogs}
                            >
                              <FileText className="h-3 w-3" />
                              {t("options.status.viewUpdateLogs")}
                            </Button>
                          </>
                        )
                      }
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono">
                          {status.version || "—"}
                        </span>
                        {status.release_date && (
                          <span className="font-normal text-muted-foreground">
                            · {status.release_date}
                          </span>
                        )}
                        <Badge
                          variant={updateAvailable ? "warning" : "secondary"}
                          className="text-[9px]"
                        >
                          {updateSummary}
                        </Badge>
                      </span>
                    </StatusLine>
                    <StatusLine
                      label={t("options.status.runtime.configVersion")}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono">
                          {status.config_version ?? "—"}
                        </span>
                        {status.latest_config_version != null && (
                          <Badge
                            variant={
                              configVersionMismatch ? "warning" : "secondary"
                            }
                            className="text-[9px]"
                          >
                            {t("options.status.runtime.latest", {
                              version: status.latest_config_version,
                            })}
                          </Badge>
                        )}
                      </span>
                    </StatusLine>
                    {updState.error && (
                      <p className="mx-4 rounded-md bg-destructive/[0.045] px-3 py-2 text-[11px] text-destructive sm:ml-[8.75rem]">
                        {updState.error}
                      </p>
                    )}
                    <details className="group">
                      <summary className="grid min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-4 py-2 text-[11px] transition hover:bg-muted/20 sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
                        <span className="text-muted-foreground">
                          {t("options.status.runtime.paths")}
                        </span>
                        <span className="min-w-0 truncate font-mono text-[10px] text-foreground">
                          {status.hermes_home || "—"}
                        </span>
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="mt-1 rounded-md bg-muted/[0.16] px-4 py-1.5 sm:pl-[8.75rem]">
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
                  </div>
                </section>

                <section>
                  <div className="mb-2 flex items-center justify-between gap-3 px-1">
                    <span className="flex items-center gap-2">
                      <Server className="h-3.5 w-3.5 text-muted-foreground" />
                      <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        {t("options.status.gateway.title")}
                      </h3>
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {fmtTimestamp(status.gateway_updated_at)}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    <StatusLine
                      label={t("options.status.gateway.state")}
                      actions={
                        <>
                          <ActionStateBadge state={gwState} t={t} />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 text-[10px]"
                            onClick={() => void triggerGateway()}
                            disabled={gwState.running || triggering.gw}
                          >
                            {gwState.running || triggering.gw ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RotateCw className="h-3 w-3" />
                            )}
                            {t("options.status.actions.restart.button")}
                          </Button>
                        </>
                      }
                    >
                      <span className="inline-flex items-center gap-2">
                        <span
                          className={cn(
                            "h-2 w-2 rounded-full",
                            status.gateway_running
                              ? "bg-[hsl(var(--success))]"
                              : "bg-destructive",
                          )}
                        />
                        <span>
                          {t(
                            status.gateway_running
                              ? "options.status.metric.online"
                              : "options.status.metric.offline",
                          )}
                        </span>
                        <span className="font-normal text-muted-foreground">
                          · {status.gateway_state ?? "—"}
                        </span>
                      </span>
                    </StatusLine>
                    <StatusLine label={t("options.status.gateway.pid")}>
                      <span className="font-mono">
                        {status.gateway_pid ?? "—"}
                      </span>
                    </StatusLine>
                    <StatusLine
                      label={t("options.status.runtime.activeSessions")}
                    >
                      {status.active_sessions ?? 0}
                    </StatusLine>
                    <StatusLine label={t("options.status.gateway.platforms")}>
                      {platformNames.length > 0 ? (
                        <span className="flex flex-wrap gap-1">
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
                    </StatusLine>
                    {status.gateway_exit_reason && (
                      <StatusLine label={t("options.status.gateway.lastExit")}>
                        <span className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
                          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="break-words">
                            {status.gateway_exit_reason}
                          </span>
                        </span>
                      </StatusLine>
                    )}
                    <GatewayActionDetails state={gwState} t={t} />
                  </div>
                </section>

                <section>
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <HeartPulse className="h-3.5 w-3.5 text-muted-foreground" />
                    <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Maintenance
                    </h3>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {(
                      [
                        ["doctor", "Doctor", HeartPulse],
                        ["security-audit", "Security", ShieldCheck],
                        ["backup", "Backup", Archive],
                        ["debug-bundle", "Debug bundle", Bug],
                        ["curator", "Curate memory", BrainCircuit],
                      ] as const
                    ).map(([name, label, Icon]) => (
                      <Button
                        className="h-auto min-h-16 flex-col gap-1.5 py-2 text-[10px]"
                        disabled={maintenanceState.running}
                        key={name}
                        onClick={() => void triggerMaintenance(name)}
                        type="button"
                        variant="outline"
                      >
                        {maintenanceState.running &&
                        maintenanceName === name ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Icon className="h-4 w-4" />
                        )}
                        {label}
                      </Button>
                    ))}
                  </div>
                  {maintenanceName &&
                  (maintenanceState.lines.length > 0 ||
                    maintenanceState.error ||
                    maintenanceState.exitCode != null) ? (
                    <details
                      className="mt-2 rounded-lg border border-border/60 bg-muted/15"
                      open={maintenanceState.running}
                    >
                      <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
                        {maintenanceName}
                        {maintenanceState.error
                          ? ` · ${maintenanceState.error}`
                          : maintenanceState.running
                            ? " · running"
                            : ` · exit ${maintenanceState.exitCode ?? 0}`}
                      </summary>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t border-border/50 px-3 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                        {maintenanceState.lines.join("\n")}
                      </pre>
                    </details>
                  ) : null}
                </section>
              </div>
            </>
          )}
        </PageContent>
      </div>
    </div>
  );
}
