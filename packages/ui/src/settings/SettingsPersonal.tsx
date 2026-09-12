import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Info, Shuffle, Upload } from "lucide-react";
import { getPlatform } from "@amiba/app-runtime/platform";
import { useT } from "@amiba/i18n";
import {
  Button,
  Input,
  Label,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from "../primitives";
import { PROFILE_AVATARS } from "../profile/avatars";
import { AVATAR_BATCH_SIZE, nextAvatarBatch } from "../profile/avatar-batch";
import {
  profileAvatarSrc,
  readUploadedAvatar,
  usePersonalProfile,
} from "../profile/profile";

export function SettingsPersonal() {
  const { t } = useT();
  const { profile, ready, loadError, save } = usePersonalProfile();
  const [draft, setDraft] = useState(profile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [avatarBatch, setAvatarBatch] = useState(() =>
    PROFILE_AVATARS.slice(0, AVATAR_BATCH_SIZE),
  );
  const upload = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setDraft(profile);
  }, [profile]);
  const dirty =
    draft.nickname.trim() !== profile.nickname ||
    draft.avatar !== profile.avatar;

  return (
    <div className="max-w-xl space-y-6">
      <div className="flex items-center gap-4">
        <img
          src={profileAvatarSrc(draft.avatar)}
          alt={t("options.personal.avatar")}
          className="h-16 w-16 shrink-0 rounded-full object-cover ring-1 ring-border/40"
        />
        <div className="min-w-0">
          <p className="truncate text-lg font-medium">
            {draft.nickname.trim() || t("options.personal.defaultName")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("options.personal.preview")}
          </p>
        </div>
      </div>
      <form
        className="space-y-6"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!ready || busy || loadError || !dirty) return;
          setBusy(true);
          setError("");
          setSaved(false);
          try {
            setDraft(await save(draft));
            setSaved(true);
          } catch {
            setError(t("options.personal.saveError"));
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset
          disabled={!ready || busy || loadError}
          className="space-y-6 disabled:opacity-60"
        >
          <div className="space-y-2">
            <Label htmlFor="personal-nickname">
              {t("options.personal.nickname")}
            </Label>
            <Input
              id="personal-nickname"
              autoComplete="nickname"
              maxLength={32}
              value={draft.nickname}
              placeholder={t("options.personal.defaultName")}
              onChange={(event) => {
                setDraft({ ...draft, nickname: event.target.value });
                setSaved(false);
              }}
            />
            <p className="text-xs text-muted-foreground">
              {t("options.personal.nicknameHint")}
            </p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span id="personal-avatar-label" className="text-sm font-medium">
                {t("options.personal.avatar")}
              </span>
            </div>
            <div
              role="group"
              aria-labelledby="personal-avatar-label"
              className="grid grid-cols-4 gap-3 sm:grid-cols-6"
            >
              {avatarBatch.map((avatar) => (
                <button
                  key={avatar.id}
                  type="button"
                  aria-label={avatar.name}
                  aria-pressed={draft.avatar === avatar.id}
                  onClick={() => {
                    setDraft({ ...draft, avatar: avatar.id });
                    setSaved(false);
                  }}
                  className={cn(
                    "relative aspect-square rounded-2xl p-1 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    draft.avatar === avatar.id &&
                      "bg-primary/10 ring-2 ring-primary",
                  )}
                >
                  <img
                    src={avatar.src}
                    alt=""
                    className="h-full w-full rounded-xl object-cover"
                  />
                  {draft.avatar === avatar.id && (
                    <span className="absolute -bottom-1 -right-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3">
              <a
                href="https://ipaslogo.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(event) => {
                  event.preventDefault();
                  void getPlatform()
                    .shell.openExternal("https://ipaslogo.com/")
                    .catch(() => setError(t("options.personal.browseError")));
                }}
              >
                {t("options.personal.source")}
                <ExternalLink aria-hidden className="h-3 w-3" />
              </a>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                onClick={() =>
                  setAvatarBatch(
                    nextAvatarBatch(avatarBatch.map((avatar) => avatar.id)),
                  )
                }
              >
                <Shuffle className="h-3.5 w-3.5" />
                {t("options.personal.shuffle")}
              </Button>
            </div>
            <input
              ref={upload}
              aria-label={t("options.personal.upload")}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              tabIndex={-1}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setBusy(true);
                setError("");
                setSaved(false);
                try {
                  const avatar = await readUploadedAvatar(file);
                  setDraft((previous) => ({ ...previous, avatar }));
                } catch {
                  setError(t("options.personal.uploadError"));
                } finally {
                  setBusy(false);
                }
              }}
            />
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => upload.current?.click()}
              >
                <Upload className="mr-2 h-3.5 w-3.5" />
                {t("options.personal.upload")}
              </Button>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("options.personal.uploadRequirements")}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Info aria-hidden className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="max-w-64 leading-relaxed"
                  >
                    {t("options.personal.uploadHint")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
          <div className="flex items-center gap-3 border-t border-border/40 pt-5">
            <Button type="submit" disabled={!dirty}>
              {busy ? t("options.personal.saving") : t("options.personal.save")}
            </Button>
            {saved && (
              <span role="status" className="text-xs text-muted-foreground">
                {t("options.personal.saved")}
              </span>
            )}
          </div>
        </fieldset>
        {(error || loadError) && (
          <p role="alert" className="text-sm text-destructive">
            {error || t("options.personal.loadError")}
          </p>
        )}
      </form>
    </div>
  );
}
