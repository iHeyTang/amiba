import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ChevronRight,
  ChevronsUpDown,
  CircleAlert,
  CircleCheckBig,
  CloudDownload,
  ExternalLink,
  Github,
  Info,
  LoaderCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { type AppUpdateState, getPlatform } from "@amiba/app-runtime/platform";
import { useT } from "@amiba/i18n";
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
} from "../primitives";
import { APP_VERSION } from "../app-version";
import { SettingsTriggerContent } from "../settings/SettingsTriggerContent";
import { profileAvatarSrc, usePersonalProfile } from "./profile";

export function ProfileMenu({
  wide = true,
  settingsOpen = false,
  settingsTrigger,
  onOpenSettings,
}: {
  wide?: boolean;
  settingsOpen?: boolean;
  settingsTrigger?: (owner: { wide: boolean }) => ReactNode;
  onOpenSettings: (tab?: string) => void;
}) {
  const { t } = useT();
  const { profile } = usePersonalProfile();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [update, setUpdate] = useState<AppUpdateState>({ status: "disabled", currentVersion: APP_VERSION });
  const updater = getPlatform().appUpdates;
  const updateError = (error: unknown) => setUpdate(state => ({ ...state, status: "error", error: String(error) }));
  useEffect(() => {
    if (!updater) return;
    let alive = true;
    let receivedEvent = false;
    const off = updater.onChanged(state => { receivedEvent = true; if (alive) setUpdate(state); });
    void updater.getState().then(state => { if (alive && !receivedEvent) setUpdate(state); }).catch(error => { if (alive) updateError(error); });
    return () => { alive = false; off(); };
  }, [updater]);
  const checkUpdates = () => { void updater?.check().catch(updateError); };
  const openingDialog = useRef(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const name = profile.nickname || t("options.personal.defaultName");
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const shortcut = isMac ? "⌘," : "Ctrl+,";
  useEffect(() => {
    if (settingsOpen) setOpen(false);
  }, [settingsOpen]);
  const navigate = (tab?: string) => {
    openingDialog.current = true;
    setOpen(false);
    onOpenSettings(tab);
  };
  const row =
    "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[13px] transition-colors hover:bg-accent/70 focus-visible:bg-accent focus-visible:outline-none";

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setNotice("");
        }}
      >
        <PopoverTrigger asChild>
          <button
            ref={menuTrigger}
            type="button"
            data-testid="sidebar-item-personal"
            aria-label={t("options.personal.menu")}
            aria-haspopup="menu"
            title={name}
            className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/70 data-[state=open]:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <img
              src={profileAvatarSrc(profile.avatar)}
              alt=""
              className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-border/30"
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[13px] font-medium",
                !wide && "sr-only",
              )}
            >
              {name}
            </span>
            {wide && (
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          size="sm"
          padding="sm"
          role="menu"
          aria-label={t("options.personal.menu")}
          className="w-72 max-w-[calc(100vw-24px)]"
          onCloseAutoFocus={(event) => {
            if (openingDialog.current) event.preventDefault();
            openingDialog.current = false;
          }}
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
              return;
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]',
              ),
            );
            const current = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (current +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      items.length) %
                    items.length;
            event.preventDefault();
            items[next]?.focus();
          }}
        >
          <button
            type="button"
            role="menuitem"
            aria-label={t("options.nav.personal")}
            onClick={() => navigate("personal")}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-accent/70 focus-visible:bg-accent focus-visible:outline-none"
          >
            <img
              src={profileAvatarSrc(profile.avatar)}
              alt=""
              className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-border/30"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{name}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t("options.personal.editProfile")}
              </span>
            </span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          </button>
          <div role="separator" className="mx-3 my-2 h-px bg-border/50" />
          <button
            type="button"
            role="menuitem"
            data-testid="sidebar-item-settings"
            aria-label={t("chat.settings")}
            aria-keyshortcuts={isMac ? "Meta+," : "Control+,"}
            onClick={() => navigate()}
            className={row}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2.5">
              {settingsTrigger ? (
                settingsTrigger({ wide: true })
              ) : (
                <SettingsTriggerContent wide />
              )}
            </span>
            <kbd className="shrink-0 font-sans text-xs tracking-wide text-muted-foreground/70">
              {shortcut}
            </kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void getPlatform()
                .shell.openExternal("https://github.com/iHeyTang/amiba")
                .then(() => setOpen(false))
                .catch(() => setNotice(t("options.personal.githubError")));
            }}
            className={row}
          >
            <Github className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1">GitHub</span>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/60" />
          </button>
          <div role="separator" className="mx-3 my-2 h-px bg-border/50" />
          <button
            type="button"
            role="menuitem"
            title={t("options.personal.checkUpdates")}
            onClick={() => {
              openingDialog.current = true;
              setOpen(false);
              setUpdatesOpen(true);
              checkUpdates();
            }}
            className={row}
          >
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1">
              {t("options.personal.currentVersion")}
            </span>
            <span className="text-xs text-muted-foreground">
              v{update.currentVersion}
            </span>
          </button>
          {notice && (
            <p
              role="status"
              className="px-3 pb-2 pt-1 text-xs leading-relaxed text-muted-foreground"
            >
              {notice}
            </p>
          )}
        </PopoverContent>
      </Popover>
      <Dialog open={updatesOpen} onOpenChange={setUpdatesOpen}>
        <DialogContent
          size="compact"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            menuTrigger.current?.focus();
          }}
        >
          <DialogHeader className="text-left">
            <div className="flex items-start gap-3.5">
              <span
                className={cn(
                  "grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary",
                  (update.status === "downloaded" || update.status === "ready") && "bg-success/10 text-success",
                  update.status === "error" && "bg-destructive/10 text-destructive",
                )}
              >
                {updateStatusIcon(update.status, "h-5 w-5")}
              </span>
              <div className="min-w-0 pt-0.5">
                <DialogTitle>{t("options.personal.checkUpdates")}</DialogTitle>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge
                    variant="outline"
                    className="rounded-full px-2 py-0 font-mono text-[11px] font-semibold"
                  >
                    v{update.currentVersion}
                  </Badge>
                  {update.version && update.status !== "error" && ["available", "offered", "downloading", "downloaded", "ready"].includes(update.status) && (
                    <>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                      <Badge className="rounded-full px-2 py-0 font-mono text-[11px] font-semibold">
                        v{update.version}
                      </Badge>
                    </>
                  )}
                </div>
              </div>
            </div>
          </DialogHeader>
          <div className="flex flex-col gap-3.5">
            <div
              role="status"
              className={cn(
                "flex items-start gap-2.5 rounded-xl border border-border/60 bg-muted/40 px-3.5 py-3",
                (update.status === "downloaded" || update.status === "ready") && "border-success/25 bg-success/5",
                update.status === "error" && "border-destructive/25 bg-destructive/5",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 shrink-0 text-primary",
                  (update.status === "downloaded" || update.status === "ready") && "text-success",
                  update.status === "error" && "text-destructive",
                  (update.status === "idle" || update.status === "disabled") && "text-muted-foreground",
                )}
              >
                {updateStatusIcon(update.status, "h-4 w-4")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug text-foreground">
                  {updateStatusTitle(update.status, update, t)}
                </p>
                {updateStatusDetail(update.status, t) && (
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {updateStatusDetail(update.status, t)}
                  </p>
                )}
              </div>
            </div>
            {update.status === "downloading" && (
              <div className="flex items-center gap-3">
                <Progress
                  value={update.percent}
                  className="h-2.5 flex-1"
                  label={t("options.personal.update.progress")}
                />
                <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
                  {Math.round(update.percent ?? 0)}%
                </span>
              </div>
            )}
            {update.status === "error" && update.error && (
              <p
                role="alert"
                className="break-words rounded-lg bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive"
              >
                {update.error}
              </p>
            )}
          </div>
          <DialogFooter>
            {update.status === "downloaded" ? (
              <Button onClick={() => { void updater?.install().catch(updateError); }}>{t("options.personal.update.install")}</Button>
            ) : update.status === "ready" ? (
              // The installer is on disk and verified; quitting is the user's move.
              <Button onClick={() => { void updater?.install().catch(updateError); }}>{t("options.personal.update.reveal")}</Button>
            ) : update.status === "offered" ? (
              <Button onClick={() => { void updater?.download?.().catch(updateError); }}>{t("options.personal.update.download")}</Button>
            ) : updater && update.status !== "disabled" ? (
              <Button disabled={["checking", "available", "downloading"].includes(update.status)} onClick={checkUpdates}>{t("options.personal.checkUpdates")}</Button>
            ) : null}
            <DialogClose asChild>
              <Button variant="outline">{t("common.close")}</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Icon for a given update status; used in the header tile and status card. */
function updateStatusIcon(status: AppUpdateState["status"], size: string) {
  switch (status) {
    case "available":
      return <Sparkles className={size} aria-hidden="true" />;
    case "offered":
    case "downloading":
      return <CloudDownload className={size} aria-hidden="true" />;
    case "downloaded":
    case "ready":
      return <CircleCheckBig className={size} aria-hidden="true" />;
    case "error":
      return <CircleAlert className={size} aria-hidden="true" />;
    case "checking":
      return <LoaderCircle className={cn(size, "animate-spin")} aria-hidden="true" />;
    default:
      return <Info className={size} aria-hidden="true" />;
  }
}

/** Headline for the status card, per state. */
function updateStatusTitle(
  status: AppUpdateState["status"],
  update: AppUpdateState,
  t: ReturnType<typeof useT>["t"],
) {
  const version = update.version ?? "";
  switch (status) {
    case "available":
      return t("options.personal.update.available", { version });
    case "offered":
      return t("options.personal.update.offered", { version });
    case "downloading":
      return t("options.personal.update.downloadingTitle", { version });
    case "downloaded":
      return t("options.personal.update.downloadedTitle", { version });
    case "ready":
      return t("options.personal.update.ready", { version });
    case "checking":
      return t("options.personal.update.checking");
    case "error":
      return t("options.personal.update.error");
    case "idle":
      return t("options.personal.update.idle");
    case "disabled":
      return t("options.personal.update.disabled");
  }
}

/** Supporting line under the status headline, where one exists. */
function updateStatusDetail(
  status: AppUpdateState["status"],
  t: ReturnType<typeof useT>["t"],
) {
  switch (status) {
    case "checking":
      return t("options.personal.update.checkingDetail");
    case "available":
    case "offered":
      return t("options.personal.update.availableDetail");
    case "downloaded":
      return t("options.personal.update.readyToInstall");
    default:
      // `error` carries the raw host message in its own alert box below the card.
      return undefined;
  }
}
