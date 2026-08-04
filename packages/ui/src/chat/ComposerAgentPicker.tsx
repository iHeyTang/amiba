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
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  cn,
} from "../primitives";

export interface ComposerAgentPickerProps {
  disabled?: boolean;
  locked?: boolean;
  onChange: (next: AgentExecutionContext) => void;
  value: AgentExecutionContext;
}

export function ComposerAgentPicker({
  disabled = false,
  locked = false,
  onChange,
  value,
}: ComposerAgentPickerProps) {
  const { t } = useT();
  const normalized = normalizeAgentContext(value);
  const [profiles, setProfiles] = useState<HermesProfile[]>([]);
  const [personalities, setPersonalities] = useState<HermesPersonality[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [loadingPersonalities, setLoadingPersonalities] = useState(false);
  const [open, setOpen] = useState(false);
  const [dialogProfileId, setDialogProfileId] = useState(normalized.profileId);
  const [error, setError] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    setLoadingProfiles(true);
    const result = await getHermesProfiles();
    setLoadingProfiles(false);
    if (result.ok) {
      setProfiles(result.profiles);
      setError(null);
    } else {
      setError(result.error || t("sidepanel.agentPicker.loadFailed"));
    }
  }, [t]);

  const loadPersonalities = useCallback(async (profileId: string) => {
    setLoadingPersonalities(true);
    const result = await getHermesPersonalities(profileId);
    setLoadingPersonalities(false);
    setPersonalities(result.ok ? result.personalities : []);
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (!open) return;
    void loadPersonalities(dialogProfileId);
  }, [dialogProfileId, loadPersonalities, open]);

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

  const isSpecialIdentity =
    normalized.profileId !== "default" || Boolean(normalized.personality);
  const showControl = loadingProfiles
    ? isSpecialIdentity
    : profiles.length > 1 || isSpecialIdentity;

  if (!showControl) return null;

  const blocked = disabled || locked;
  const identityLabel = normalized.personality
    ? `${selectedProfile.name} · ${normalized.personality.key}`
    : selectedProfile.name;

  function changeOpen(next: boolean) {
    setOpen(next);
    if (next) setDialogProfileId(normalized.profileId);
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
        title={
          locked
            ? t("sidepanel.agentPicker.locked")
            : t("sidepanel.agentPicker.executionIdentity")
        }
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
          className="block max-w-md gap-0 overflow-hidden rounded-2xl p-0 sm:rounded-2xl"
          hideDefaultClose
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
          <div className="max-h-[min(68vh,30rem)] overflow-y-auto p-2">
            {error ? (
              <p className="px-3 py-2 text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            {profiles.length > 1 ? (
              <section className="pb-2">
                <p className="px-3 pb-1.5 pt-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {t("sidepanel.agentPicker.agent")}
                </p>
                {profiles.map((profile) => (
                  <button
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-secondary"
                    key={profile.name}
                    onClick={() => {
                      setPersonalities([]);
                      setDialogProfileId(profile.name);
                      onChange({ profileId: profile.name });
                    }}
                    type="button"
                  >
                    <Fingerprint className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {profile.name}
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
                  {dialogProfile.name}
                </span>
              </div>
              <button
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-secondary"
                onClick={() => {
                  onChange({ profileId: dialogProfileId });
                  setOpen(false);
                }}
                type="button"
              >
                <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {t("sidepanel.agentPicker.personalityDefault")}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {t("sidepanel.agentPicker.personalityDefaultDescription")}
                  </span>
                </span>
                {!normalized.personality &&
                normalized.profileId === dialogProfileId ? (
                  <Check className="ml-3 h-4 w-4 text-primary" />
                ) : null}
              </button>
              {loadingPersonalities ? (
                <div className="flex h-20 items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                personalities.map((personality) => (
                  <button
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-secondary"
                    key={personality.key}
                    onClick={() => {
                      onChange({
                        profileId: dialogProfileId,
                        personality: {
                          key: personality.key,
                          prompt: personality.prompt,
                        },
                      });
                      setOpen(false);
                    }}
                    type="button"
                  >
                    <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {personality.name || personality.key}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {personality.description || personality.preview}
                      </span>
                    </span>
                    {normalized.profileId === dialogProfileId &&
                    normalized.personality?.key === personality.key ? (
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                    ) : null}
                  </button>
                ))
              )}
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
