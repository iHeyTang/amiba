import {
  getAgentPresets,
  normalizeAgentContext,
  type AgentExecutionContext,
  type AgentPreset,
} from "@amiba/app-runtime/core";
import { useT } from "@amiba/i18n";
import { Check, Fingerprint, Loader2 } from "lucide-react";
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
      profiles.find((profile) => profile.name === normalized.profileId) ?? {
        name: normalized.profileId,
        description: "",
      },
    [normalized.profileId, profiles],
  );

  const blocked = disabled || loadingProfiles;
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
      setDialogProfileId(currentValueRef.current.profileId);
      setOpen(true);
      // Quick Ask may mount before managed DSH is ready; opening retries a
      // stale startup failure against the current runtime generation.
      if (error || profiles.length === 0) void loadProfiles();
      return;
    }
    setOpen(false);
  }

  return (
    <>
      <button
        aria-label={`${t("sidepanel.agentPicker.executionIdentity")}: ${selectedProfileName}`}
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
        <span className="truncate">{selectedProfileName}</span>
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
              {profiles.map((profile) => (
                <button
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent"
                  disabled={profileLocked}
                  key={profile.name}
                  onClick={() => commitAndClose(profile.name)}
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
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
