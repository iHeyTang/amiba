import {
  getHermesPersonalities,
  getHermesProfiles,
  normalizeAgentContext,
  type AgentExecutionContext,
  type HermesPersonality,
  type HermesProfile,
} from "@amiba/core";
import { useT } from "@amiba/i18n";
import { Check, Fingerprint, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  cn,
  type DialogOverlayVariant,
} from "../primitives";

export interface ComposerAgentPickerProps {
  dialogSize?: "default" | "tall";
  disabled?: boolean;
  overlayVariant?: DialogOverlayVariant;
  profileLocked?: boolean;
  onChange: (next: AgentExecutionContext) => void;
  refreshKey?: number;
  value: AgentExecutionContext;
}

function isSameAgentContext(
  left: AgentExecutionContext,
  right: AgentExecutionContext,
) {
  return (
    left.profileId === right.profileId &&
    left.personality?.key === right.personality?.key &&
    left.personality?.prompt === right.personality?.prompt
  );
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
  const [profiles, setProfiles] = useState<HermesProfile[]>([]);
  const [personalitiesByProfile, setPersonalitiesByProfile] = useState<
    Record<string, HermesPersonality[]>
  >({});
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [open, setOpen] = useState(false);
  const [dialogProfileId, setDialogProfileId] = useState(normalized.profileId);
  const [dialogValue, setDialogValue] =
    useState<AgentExecutionContext>(normalized);
  const [error, setError] = useState<string | null>(null);
  const currentValueRef = useRef(normalized);
  const dialogValueRef = useRef(normalized);
  const profileLoadGenerationRef = useRef(0);
  currentValueRef.current = normalized;

  const loadProfiles = useCallback(async () => {
    const generation = ++profileLoadGenerationRef.current;
    setLoadingProfiles(true);
    setError(null);
    const result = await getHermesProfiles();
    if (generation !== profileLoadGenerationRef.current) return;
    if (result.ok) {
      if (result.profiles.length <= 1) {
        // A selector with no alternative adds noise to the composer and can
        // briefly flash while Quick Ask is restoring its cached controls.
        // Keep the control unmounted until there is an actual Profile choice.
        setProfiles(result.profiles);
        setPersonalitiesByProfile({});
        setError(null);
        setLoadingProfiles(false);
        return;
      }

      // Prepare every Profile before exposing the picker. Switching inside an
      // open dialog must be a synchronous view change: clearing the list and
      // waiting on the backplane made the entire dialog visibly flash.
      const personalityEntries = await Promise.all(
        result.profiles.map(async (profile) => {
          const personalityResult = await getHermesPersonalities(profile.name);
          return [
            profile.name,
            personalityResult.ok ? personalityResult.personalities : [],
          ] as const;
        }),
      );
      if (generation !== profileLoadGenerationRef.current) return;
      setProfiles(result.profiles);
      setPersonalitiesByProfile(Object.fromEntries(personalityEntries));
      setError(null);
    } else {
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
      profiles.find((profile) => profile.name === normalized.profileId) ?? {
        name: normalized.profileId,
        description: "",
      },
    [normalized.profileId, profiles],
  );
  const dialogProfile = useMemo(
    () =>
      profiles.find((profile) => profile.name === dialogProfileId) ?? {
        name: dialogProfileId,
        description: "",
      },
    [dialogProfileId, profiles],
  );

  const blocked = disabled || loadingProfiles;
  const profileDisplayName = (name: string) =>
    name === "default" ? t("sidepanel.agentPicker.defaultProfile") : name;
  const selectedProfileName = profileDisplayName(selectedProfile.name);
  const identityLabel = normalized.personality
    ? `${selectedProfileName} · ${normalized.personality.key}`
    : selectedProfileName;
  const personalities = personalitiesByProfile[dialogProfileId] ?? [];

  // Loading, failed, empty and single-Profile states all have no meaningful
  // choice to expose. A later refresh can still mount the control if another
  // Profile becomes available.
  if (profiles.length <= 1) return null;

  function updateDialogValue(next: AgentExecutionContext) {
    const nextValue = normalizeAgentContext(next);
    dialogValueRef.current = nextValue;
    setDialogValue(nextValue);
    setDialogProfileId(nextValue.profileId);
  }

  function commitAndClose(next: AgentExecutionContext) {
    const nextValue = normalizeAgentContext(next);
    dialogValueRef.current = nextValue;
    setDialogValue(nextValue);
    setOpen(false);
    if (!isSameAgentContext(nextValue, currentValueRef.current)) {
      onChange(nextValue);
    }
  }

  function changeOpen(next: boolean) {
    if (next) {
      updateDialogValue(currentValueRef.current);
      setOpen(true);
      // Quick Ask is pre-created before the local backplane is guaranteed to
      // be ready. A failed mount-time request must not become a permanent,
      // renderer-local error: opening the modal retries against current state.
      if (error || profiles.length === 0) void loadProfiles();
    } else {
      setOpen(false);
      const nextValue = dialogValueRef.current;
      if (!isSameAgentContext(nextValue, currentValueRef.current)) {
        onChange(nextValue);
      }
    }
  }

  return (
    <>
      <button
        aria-label={`${t("sidepanel.agentPicker.executionIdentity")}: ${identityLabel}`}
        aria-haspopup="dialog"
        className={cn(
          "inline-flex h-7 min-w-0 max-w-[11rem] items-center gap-1.5 rounded-full px-2",
          "text-[11px] font-medium text-muted-foreground transition-colors",
          "hover:bg-muted/60 hover:text-foreground focus:outline-none focus-visible:bg-muted/60",
          "disabled:cursor-not-allowed disabled:opacity-55",
        )}
        disabled={blocked}
        onClick={() => changeOpen(true)}
        title={t("sidepanel.agentPicker.executionIdentity")}
        type="button"
      >
        {loadingProfiles && profiles.length === 0 ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Fingerprint className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">{identityLabel}</span>
      </button>

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
            {loadingProfiles && profiles.length === 0 ? (
              <div className="flex h-20 items-center justify-center">
                <Loader2
                  aria-label={t("common.loading")}
                  className="h-4 w-4 animate-spin text-muted-foreground"
                />
              </div>
            ) : error ? (
              <p className="px-3 py-2 text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            {!loadingProfiles || profiles.length > 0 ? (
              <>
                {profiles.length > 1 ? (
                  <section className="pb-2">
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
                    {profiles.map((profile) => (
                      <button
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent"
                        disabled={profileLocked}
                        key={profile.name}
                        onClick={() => {
                          updateDialogValue({ profileId: profile.name });
                        }}
                        type="button"
                      >
                        <Fingerprint className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {profileDisplayName(profile.name)}
                          </span>
                          {profile.description ? (
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                              {profile.description}
                            </span>
                          ) : null}
                        </span>
                        {dialogProfileId === profile.name ? (
                          <Check className="h-4 w-4 shrink-0 text-primary" />
                        ) : null}
                      </button>
                    ))}
                  </section>
                ) : null}

                <section
                  className={cn(
                    profiles.length > 1 && "border-t border-border/50 pt-2",
                  )}
                >
                  <div className="flex items-center gap-2 px-3 pb-1.5 pt-1">
                    <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      {t("sidepanel.agentPicker.personality")}
                    </p>
                    <span className="truncate text-[10px] text-muted-foreground/65">
                      {profileDisplayName(dialogProfile.name)}
                    </span>
                  </div>
                  <button
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-secondary"
                    onClick={() => {
                      commitAndClose({ profileId: dialogProfileId });
                    }}
                    type="button"
                  >
                    <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {t("sidepanel.agentPicker.personalityDefault")}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {t(
                          "sidepanel.agentPicker.personalityDefaultDescription",
                        )}
                      </span>
                    </span>
                    {!dialogValue.personality &&
                    dialogValue.profileId === dialogProfileId ? (
                      <Check className="ml-3 h-4 w-4 text-primary" />
                    ) : null}
                  </button>
                  {personalities.map((personality) => (
                    <button
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-secondary"
                      key={personality.key}
                      onClick={() => {
                        commitAndClose({
                          profileId: dialogProfileId,
                          personality: {
                            key: personality.key,
                            prompt: personality.prompt,
                          },
                        });
                      }}
                      type="button"
                    >
                      <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-sm font-medium">
                            {personality.name || personality.key}
                          </span>
                          {personality.builtin && !personality.overridden ? (
                            <span className="shrink-0 text-[9px] text-muted-foreground/75">
                              {t("common.builtin")}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {personality.description || personality.preview}
                        </span>
                      </span>
                      {dialogValue.profileId === dialogProfileId &&
                      dialogValue.personality?.key === personality.key ? (
                        <Check className="h-4 w-4 shrink-0 text-primary" />
                      ) : null}
                    </button>
                  ))}
                </section>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
