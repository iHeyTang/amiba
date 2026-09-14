import {
  getAgentPresets,
  normalizeAgentContext,
  type AgentExecutionContext,
  type AgentPreset,
} from "@amiba/app-runtime/core";
import { useT } from "@amiba/i18n";
import { Check, Fingerprint, Info, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
  type DialogOverlayVariant,
} from "../primitives";

import { AgentDetailsDialog } from "../agents/AgentDetailsDialog";

export interface ComposerAgentPickerProps {
  dialogSize?: "default" | "tall";
  disabled?: boolean;
  overlayVariant?: DialogOverlayVariant;
  profileLocked?: boolean;
  onChange: (next: AgentExecutionContext) => void;
  refreshKey?: number;
  value: AgentExecutionContext;
}

export function ComposerAgentPicker({
  dialogSize = "default",
  disabled = false,
  overlayVariant = "dimmed",
  profileLocked = false,
  onChange,
  refreshKey = 0,
  value,
}: ComposerAgentPickerProps) {
  const { t } = useT();
  const normalized = normalizeAgentContext(value);
  const [profiles, setProfiles] = useState<AgentPreset[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [open, setOpen] = useState(false);
  const [lockedHintOpen, setLockedHintOpen] = useState(false);
  const [dialogProfileId, setDialogProfileId] = useState(normalized.profileId);
  const [error, setError] = useState<string | null>(null);
  const currentValueRef = useRef(normalized);
  const profileLoadGenerationRef = useRef(0);
  currentValueRef.current = normalized;

  const loadProfiles = useCallback(async () => {
    const generation = ++profileLoadGenerationRef.current;
    setLoadingProfiles(true);
    setError(null);
    const result = await getAgentPresets();
    if (generation !== profileLoadGenerationRef.current) return;
    if (result.ok) {
      setProfiles(result.profiles);
    } else {
      setProfiles([]);
      setError(result.error || t("sidepanel.agentPicker.loadFailed"));
    }
    setLoadingProfiles(false);
  }, [t]);

  useEffect(() => {
    void loadProfiles();
    return () => {
      profileLoadGenerationRef.current += 1;
    };
  }, [loadProfiles, refreshKey]);

  const selectedProfile = useMemo(
    () =>
      profiles.find((profile) => profile.id === normalized.profileId) ?? {
        name: normalized.profileId,
        description: "",
      },
    [normalized.profileId, profiles],
  );

  const blocked = disabled || loadingProfiles || profileLocked;

  useEffect(() => {
    if (profileLocked) setOpen(false);
    setLockedHintOpen(false);
  }, [profileLocked]);
  const profileDisplayName = (name: string) =>
    name === "default" ? t("sidepanel.agentPicker.defaultProfile") : name;
  const selectedProfileName = profileDisplayName(selectedProfile.name);

  // A selector with no alternative preset adds noise to the composer.
  if (profiles.length <= 1) return null;

  function commitAndClose(profileId: string) {
    const nextValue = normalizeAgentContext({ profileId });
    setDialogProfileId(nextValue.profileId);
    setOpen(false);
    if (nextValue.profileId !== currentValueRef.current.profileId) {
      onChange(nextValue);
    }
  }

  function changeOpen(next: boolean) {
    if (next) {
      if (blocked) return;
      setDialogProfileId(currentValueRef.current.profileId);
      setOpen(true);
      // Quick Ask may mount before managed DSH is ready; opening retries a
      // stale startup failure against the current runtime generation.
      void loadProfiles();
      return;
    }
    setOpen(false);
  }

  const trigger = (
      <button
        aria-label={`${t("sidepanel.agentPicker.executionIdentity")}: ${selectedProfileName}`}
        aria-haspopup={profileLocked ? undefined : "dialog"}
        aria-disabled={profileLocked || undefined}
        className={cn(
          "inline-flex h-7 min-w-0 max-w-[11rem] items-center gap-1.5 rounded-full px-2",
          "text-[11px] font-medium text-muted-foreground transition-colors",
          "enabled:hover:bg-muted/60 enabled:hover:text-foreground focus:outline-none focus-visible:bg-muted/60",
          "disabled:cursor-not-allowed disabled:opacity-55",
        )}
        disabled={disabled || loadingProfiles}
        onClick={() => profileLocked ? setLockedHintOpen(true) : changeOpen(true)}
        title={profileLocked ? undefined : t("sidepanel.agentPicker.executionIdentity")}
        type="button"
      >
        {loadingProfiles && profiles.length === 0 ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Fingerprint className="h-3.5 w-3.5 shrink-0" />
        )}
        <span data-composer-secondary-label className="truncate">{selectedProfileName}</span>
      </button>
  );

  return (
    <>
      {profileLocked ? (
        <TooltipProvider delayDuration={250}>
          <Tooltip open={lockedHintOpen} onOpenChange={setLockedHintOpen}>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent side="top">
              {t("sidepanel.agentPicker.profileLocked")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : trigger}

      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent
          className={cn(
            "flex flex-col gap-0 overflow-hidden p-0",
            dialogSize === "tall"
              ? "h-[min(calc(100vh-2rem),32rem)]"
              : "h-[min(68vh,32rem)]",
          )}
          data-composer-overlay=""
          data-agent-picker-modal="true"
          hideDefaultClose
          overlayVariant={overlayVariant}
          size="compact"
        >
          <DialogTitle className="sr-only">
            {t("sidepanel.agentPicker.executionIdentity")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("sidepanel.agentPicker.executionIdentityDescription")}
          </DialogDescription>
          <div className="border-b border-border/60 px-4 py-3 text-sm font-medium">
            {t("sidepanel.agentPicker.executionIdentity")}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {error ? (
              <p className="px-3 py-2 text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <section>
              <div className="flex items-center gap-2 px-3 pb-1.5 pt-1">
                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {t("sidepanel.agentPicker.agent")}
                </p>
                {profileLocked ? (
                  <span className="text-[10px] text-muted-foreground/65">
                    {t("sidepanel.agentPicker.profileLocked")}
                  </span>
                ) : null}
              </div>
              {profiles.map((profile) => {
                const isCurrent = dialogProfileId === profile.id;
                const name = profileDisplayName(profile.name);
                return (
                  <div key={profile.id} className="group/identity relative rounded-xl hover:bg-secondary focus-within:bg-secondary">
                    <button
                      className="flex w-full items-center gap-3 rounded-xl py-2.5 pl-3 pr-12 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55"
                      aria-current={isCurrent ? "true" : undefined}
                      disabled={profileLocked || !!profile.broken}
                      onClick={() => commitAndClose(profile.id)}
                      type="button"
                    >
                      <Fingerprint className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{name}</span>
                        {profile.description && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{profile.description}</span>}
                      </span>
                    </button>
                    <AgentDetailsDialog
                      profile={profile}
                      name={name}
                      overlayVariant={overlayVariant}
                      trigger={
                        <button
                          type="button"
                          aria-label={t("sidepanel.agentPicker.details.openFor", { name })}
                          title={t("sidepanel.agentPicker.details.openFor", { name })}
                          className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {isCurrent && <Check aria-hidden className="absolute h-4 w-4 text-primary transition-opacity group-hover/identity:opacity-0 group-focus-within/identity:opacity-0 [@media(hover:none)]:opacity-0" />}
                          <Info aria-hidden className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover/identity:opacity-100 group-focus-within/identity:opacity-100 [@media(hover:none)]:opacity-100" />
                        </button>
                      }
                    />
                  </div>
                );
              })}
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
