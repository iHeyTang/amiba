import {
  getPermissionPreset,
  setPermissionPreset,
  type PermissionPresetResult,
} from "@amiba/app-runtime/core";
import { useT } from "@amiba/i18n";
import { Check, Hand, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger, cn } from "../primitives";

export interface ComposerApprovalModePickerProps {
  disabled?: boolean;
  /** A missing/unmaterialized DSH session edits the future-session default. */
  sessionId?: string;
  refreshKey?: number;
}

type SuccessfulResult = Extract<PermissionPresetResult, { ok: true }>;

function presetIcon(preset: string) {
  if (preset === "read-only") return Hand;
  if (preset === "danger-full-access") return ShieldAlert;
  return ShieldCheck;
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function ComposerApprovalModePicker({
  disabled = false,
  sessionId,
  refreshKey = 0,
}: ComposerApprovalModePickerProps) {
  const { t } = useT();
  const tRef = useRef(t);
  const operationGenerationRef = useRef(0);
  tRef.current = t;
  const [state, setState] = useState<SuccessfulResult | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dangerPending, setDangerPending] = useState(false);
  const [dangerAcknowledged, setDangerAcknowledged] = useState(false);

  const labelFor = useCallback(
    (preset: string, advertisedName?: string) => {
      if (preset === "read-only") return t("sidepanel.permissionPreset.readOnly");
      if (preset === "workspace-write") {
        return t("sidepanel.permissionPreset.workspaceWrite");
      }
      if (preset === "danger-full-access") {
        return t("sidepanel.permissionPreset.fullAccess");
      }
      return advertisedName?.trim() || titleCase(preset);
    },
    [t],
  );

  const descriptionFor = useCallback(
    (preset: string, advertised?: string) => {
      if (advertised?.trim()) return advertised;
      if (preset === "read-only") {
        return t("sidepanel.permissionPreset.readOnlyDescription");
      }
      if (preset === "workspace-write") {
        return t("sidepanel.permissionPreset.workspaceWriteDescription");
      }
      if (preset === "danger-full-access") {
        return t("sidepanel.permissionPreset.fullAccessDescription");
      }
      return t("sidepanel.permissionPreset.customDescription");
    },
    [t],
  );

  const load = useCallback(
    async (reset = false, silent = false) => {
      const generation = ++operationGenerationRef.current;
      if (!silent) setLoading(true);
      setError(null);
      if (reset) setState(null);
      const result = await getPermissionPreset(sessionId);
      if (generation !== operationGenerationRef.current) return;
      if (result.ok) {
        setState(result);
        setError(null);
      } else {
        setError(
          result.error || tRef.current("sidepanel.approvalMode.loadFailed"),
        );
      }
      if (!silent) setLoading(false);
    },
    [sessionId],
  );

  useLayoutEffect(() => {
    setOpen(false);
    setSaving(false);
    setDangerPending(false);
    setDangerAcknowledged(false);
    void load(true);
    return () => {
      operationGenerationRef.current += 1;
    };
  }, [load, refreshKey]);

  const label = state
    ? labelFor(
        state.preset,
        state.options.find((option) => option.value === state.preset)?.name,
      )
    : t("sidepanel.approvalMode.label");
  const CurrentIcon = useMemo(
    () => presetIcon(state?.preset ?? "workspace-write"),
    [state?.preset],
  );

  async function commitPreset(next: string) {
    if (saving || next === state?.preset) {
      setOpen(false);
      return;
    }
    const generation = ++operationGenerationRef.current;
    setSaving(true);
    setError(null);
    const result = await setPermissionPreset(next, sessionId, state?.revision);
    if (generation !== operationGenerationRef.current) return;
    setSaving(false);
    if (result.ok) {
      setState(result);
      setDangerPending(false);
      setDangerAcknowledged(false);
      setOpen(false);
    } else {
      setError(result.error || t("sidepanel.approvalMode.saveFailed"));
    }
  }

  function selectPreset(next: string) {
    if (next === "danger-full-access" && state?.preset !== next) {
      setDangerPending(true);
      setDangerAcknowledged(false);
      return;
    }
    void commitPreset(next);
  }

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setDangerPending(false);
      setDangerAcknowledged(false);
    } else {
      void load(false, true);
    }
  };

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <button
          aria-expanded={open}
          aria-haspopup="menu"
          aria-invalid={Boolean(error)}
          aria-label={`${t("sidepanel.approvalMode.label")}: ${label}`}
          className={cn(
            "inline-flex h-7 min-w-0 max-w-[11rem] items-center gap-1.5 rounded-full px-2",
            "text-[11px] font-medium text-muted-foreground transition-colors duration-150",
            "hover:bg-muted/60 hover:text-foreground focus:outline-none focus-visible:bg-muted/60",
            "disabled:cursor-not-allowed disabled:opacity-50",
            state?.preset === "danger-full-access" &&
              "text-amber-600 hover:text-amber-600 dark:text-amber-400",
          )}
          disabled={
            disabled || saving || (loading && state === null) || !state?.writable
          }
          type="button"
        >
          {loading || saving ? (
            <Loader2
              aria-hidden
              className="h-3.5 w-3.5 shrink-0 animate-spin"
            />
          ) : (
            <CurrentIcon aria-hidden className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate">{label}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        aria-label={t("sidepanel.permissionPreset.question")}
        role="menu"
        side="top"
        size="lg"
      >
        <div className="px-2.5 pb-1.5 pt-1">
          <span className="text-[10px] leading-4 text-muted-foreground">
            {t("sidepanel.permissionPreset.question")}
          </span>
        </div>

        {error ? (
          <button
            aria-live="polite"
            className="mx-1 mb-1 w-[calc(100%-0.5rem)] rounded-lg bg-destructive/10 px-2.5 py-2 text-left text-[11px] text-destructive"
            onClick={() => void load(state === null)}
            type="button"
          >
            {error}
          </button>
        ) : null}

        <div className="space-y-0.5">
          {(state?.options ?? []).map((option) => {
            const Icon = presetIcon(option.value);
            const warning = option.value === "danger-full-access";
            return (
              <button
                aria-checked={state?.preset === option.value}
                className={cn(
                  "group flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left",
                  "transition-colors duration-150 hover:bg-muted/70 focus:outline-none focus-visible:bg-muted/70",
                )}
                disabled={saving || loading || !state || Boolean(error)}
                key={option.value}
                onClick={() => selectPreset(option.value)}
                role="menuitemradio"
                type="button"
              >
                <Icon
                  aria-hidden
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground",
                    warning && "text-amber-600 dark:text-amber-400",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-xs font-medium",
                      warning && "text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {labelFor(option.value, option.name)}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 block text-[11px] leading-4 text-muted-foreground",
                      warning && "text-amber-700/80 dark:text-amber-300/70",
                    )}
                  >
                    {descriptionFor(option.value, option.description)}
                  </span>
                </span>
                {state?.preset === option.value ? (
                  <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                ) : null}
              </button>
            );
          })}
        </div>

        {dangerPending ? (
          <div className="mx-1 mt-1 rounded-xl border border-amber-500/30 bg-amber-500/8 p-2.5">
            <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-4 text-amber-800 dark:text-amber-200">
              <input
                checked={dangerAcknowledged}
                className="mt-0.5"
                onChange={(event) =>
                  setDangerAcknowledged(event.currentTarget.checked)
                }
                type="checkbox"
              />
              <span>{t("sidepanel.permissionPreset.fullAccessAcknowledge")}</span>
            </label>
            <div className="mt-2 flex justify-end gap-1.5">
              <button
                className="rounded-lg px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted"
                onClick={() => setDangerPending(false)}
                type="button"
              >
                {t("common.cancel")}
              </button>
              <button
                className="rounded-lg bg-amber-600 px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-45"
                disabled={!dangerAcknowledged || saving}
                onClick={() => void commitPreset("danger-full-access")}
                type="button"
              >
                {t("sidepanel.permissionPreset.enableFullAccess")}
              </button>
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
