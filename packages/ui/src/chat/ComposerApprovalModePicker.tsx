import {
  getHermesApprovalMode,
  setHermesApprovalMode,
  type HermesApprovalMode,
} from "@amiba/core";
import { useT } from "@amiba/i18n";
import { Check, Hand, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger, cn } from "../primitives";

export interface ComposerApprovalModePickerProps {
  disabled?: boolean;
  profileId?: string;
  refreshKey?: number;
}

const MODES: HermesApprovalMode[] = ["manual", "smart", "off"];

export function ComposerApprovalModePicker({
  disabled = false,
  profileId,
  refreshKey = 0,
}: ComposerApprovalModePickerProps) {
  const { t } = useT();
  const tRef = useRef(t);
  const operationGenerationRef = useRef(0);
  tRef.current = t;
  const requestedProfile = profileId?.trim().toLowerCase() || "default";
  const [mode, setMode] = useState<HermesApprovalMode | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (resetMode = false, silent = false) => {
      const generation = ++operationGenerationRef.current;
      if (!silent) setLoading(true);
      setError(null);
      if (resetMode) setMode(null);
      const result = await getHermesApprovalMode(requestedProfile);
      if (generation !== operationGenerationRef.current) return;
      if (result.ok) {
        setMode(result.mode);
        setError(null);
      } else {
        setError(
          result.error || tRef.current("sidepanel.approvalMode.loadFailed"),
        );
      }
      if (!silent) setLoading(false);
    },
    [requestedProfile],
  );

  useLayoutEffect(() => {
    setOpen(false);
    setSaving(false);
    void load(true);
    return () => {
      operationGenerationRef.current += 1;
    };
  }, [load, refreshKey, requestedProfile]);

  const label = mode
    ? t(`sidepanel.approvalMode.${mode}`)
    : t("sidepanel.approvalMode.label");

  const CurrentIcon = useMemo(() => {
    if (mode === "manual") return Hand;
    if (mode === "off") return ShieldAlert;
    return ShieldCheck;
  }, [mode]);

  async function selectMode(next: HermesApprovalMode) {
    if (saving || next === mode) {
      setOpen(false);
      return;
    }
    const generation = ++operationGenerationRef.current;
    setSaving(true);
    setError(null);
    const result = await setHermesApprovalMode(next, requestedProfile);
    if (generation !== operationGenerationRef.current) return;
    setSaving(false);
    if (result.ok) {
      setMode(result.mode);
      setOpen(false);
    } else {
      setError(result.error || t("sidepanel.approvalMode.saveFailed"));
    }
  }

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (next) {
      // Revalidate in the background without replacing the stable button
      // icon/label with a one-frame loading state. Host refreshes still use
      // the visible loader when no cached value exists.
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
            mode === "off" &&
              "text-amber-600 hover:text-amber-600 dark:text-amber-400",
          )}
          disabled={disabled || saving || (loading && mode === null)}
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
        aria-label={t("sidepanel.approvalMode.question")}
        role="menu"
        side="top"
        size="lg"
      >
        <div className="px-2.5 pb-1.5 pt-1">
          <span className="text-[10px] leading-4 text-muted-foreground">
            {t("sidepanel.approvalMode.question")}
          </span>
        </div>

        {error ? (
          <button
            aria-live="polite"
            className="mx-1 mb-1 w-[calc(100%-0.5rem)] rounded-lg bg-destructive/10 px-2.5 py-2 text-left text-[11px] text-destructive"
            onClick={() => void load(mode === null)}
            type="button"
          >
            {error}
          </button>
        ) : null}

        <div className="space-y-0.5">
          {MODES.map((candidate) => {
            const Icon =
              candidate === "manual"
                ? Hand
                : candidate === "off"
                  ? ShieldAlert
                  : ShieldCheck;
            const warning = candidate === "off";
            return (
              <button
                aria-checked={mode === candidate}
                className={cn(
                  "group flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left",
                  "transition-colors duration-150 hover:bg-muted/70 focus:outline-none focus-visible:bg-muted/70",
                )}
                disabled={saving || loading || mode === null || Boolean(error)}
                key={candidate}
                onClick={() => void selectMode(candidate)}
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
                    {t(`sidepanel.approvalMode.${candidate}`)}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 block truncate text-[11px] leading-4 text-muted-foreground",
                      warning && "text-amber-700/80 dark:text-amber-300/70",
                    )}
                  >
                    {t(`sidepanel.approvalMode.${candidate}Description`)}
                  </span>
                </span>
                {mode === candidate ? (
                  <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                ) : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
