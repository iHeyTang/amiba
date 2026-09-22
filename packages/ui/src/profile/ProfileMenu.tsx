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
  Button,
  Dialog,
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
  const [cancelling, setCancelling] = useState(false);
  const updateTrigger = useRef<HTMLButtonElement>(null);
  const openedFromUpdate = useRef(false);
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
  const cancelDownload = async () => {
    if (!updater?.cancel || cancelling) return;
    setCancelling(true);
    try { await updater.cancel(); } catch (error) { updateError(error); }
    finally { setCancelling(false); }
  };
  const percent = typeof update.percent === "number" && Number.isFinite(update.percent)
    ? Math.max(0, Math.min(100, Math.round(update.percent))) : undefined;
  const updateNotice = ["available", "offered", "downloading", "cancelled", "downloaded", "ready"].includes(update.status);
  const updateNoticeLabel = update.status === "downloading"
    ? t("options.personal.update.sidebarDownloading", { percent: percent === undefined ? "…" : `${percent}%` })
    : t(update.status === "downloaded" || update.status === "ready"
      ? "options.personal.update.sidebarReady"
      : update.status === "cancelled" ? "options.personal.update.cancelled" : "options.personal.update.sidebarAvailable");
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
      {updateNotice && (
        <button
          ref={updateTrigger}
          type="button"
          aria-label={updateNoticeLabel}
          title={updateNoticeLabel}
          onClick={() => { openedFromUpdate.current = true; setUpdatesOpen(true); }}
          className="mb-1 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center">
            {updateStatusIcon(update.status, "h-4 w-4")}
          </span>
          <span className={cn("min-w-0 flex-1 truncate", !wide && "sr-only")}>{updateNoticeLabel}</span>
          {wide && <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        </button>
      )}
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
              openedFromUpdate.current = false;
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
            (openedFromUpdate.current && updateTrigger.current ? updateTrigger.current : menuTrigger.current)?.focus();
          }}
        >
          <DialogHeader className="text-left">
            <DialogTitle>{t(update.status === "ready" || update.status === "downloaded"
              ? "options.personal.update.sidebarReady"
              : update.status === "downloading" ? "options.personal.update.downloadingHeading"
              : update.status === "offered" || update.status === "available" ? "options.personal.update.sidebarAvailable"
              : "options.personal.checkUpdates")}</DialogTitle>
            <div className="flex items-center gap-2 pt-1 text-xs tabular-nums text-muted-foreground">
              <span>v{update.currentVersion}</span>
              {update.version && updateNotice && (
                <>
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  <span className="font-medium text-primary">v{update.version}</span>
                </>
              )}
            </div>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {update.status === "downloading" ? (
              <div className="flex items-center gap-3 py-1">
                <Progress value={percent} className="h-1.5 flex-1" label={t("options.personal.update.progress")} />
                <span className="min-w-8 text-right text-xs tabular-nums text-muted-foreground">
                  {percent === undefined ? "…" : `${percent}%`}
                </span>
              </div>
            ) : (
              <div role="status" className="text-sm leading-relaxed text-muted-foreground">
                <p>{updateStatusTitle(update.status, update, t)}</p>
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
          <DialogFooter className="flex-row items-center justify-between gap-3 sm:justify-between sm:space-x-0">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
              {update.status === "downloading" ? (
                <><LoaderCircle className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("options.personal.update.backgroundDownloading")}</>
              ) : null}
            </span>
            {update.status === "downloading" && updater?.cancel ? (
              <Button variant="outline" size="sm" disabled={cancelling} onClick={() => { void cancelDownload(); }}>
                {t(cancelling ? "options.personal.update.cancelling" : "options.personal.update.cancel")}
              </Button>
            ) : null}
            {update.status === "downloaded" ? (
              <Button onClick={() => { void updater?.install().catch(updateError); }}>{t("options.personal.update.install")}</Button>
            ) : update.status === "ready" ? (
              // The installer is on disk and verified; quitting is the user's move.
              <Button onClick={() => { void updater?.install().catch(updateError); }}>{t("options.personal.update.reveal")}</Button>
            ) : (update.status === "offered" || update.status === "cancelled") ? (
              <Button disabled={cancelling} onClick={() => { void updater?.download?.().catch(updateError); }}>{t(update.status === "cancelled" ? "options.personal.update.retryDownload" : "options.personal.update.download")}</Button>
            ) : updater && !["disabled", "checking", "available", "downloading"].includes(update.status) ? (
              <Button onClick={checkUpdates}>{t("options.personal.checkUpdates")}</Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Compact icon for the persistent sidebar update entry. */
function updateStatusIcon(status: AppUpdateState["status"], size: string) {
  switch (status) {
    case "available":
      return <Sparkles className={size} aria-hidden="true" />;
    case "offered":
    case "cancelled":
      return <CloudDownload className={size} aria-hidden="true" />;
    case "downloaded":
    case "ready":
      return <CircleCheckBig className={size} aria-hidden="true" />;
    case "error":
      return <CircleAlert className={size} aria-hidden="true" />;
    case "downloading":
    case "checking":
      return <LoaderCircle className={cn(size, "animate-spin motion-reduce:animate-none")} aria-hidden="true" />;
    default:
      return <Info className={size} aria-hidden="true" />;
  }
}

/** Essential update information without a duplicate status card. */
function updateStatusTitle(
  status: AppUpdateState["status"],
  update: AppUpdateState,
  t: ReturnType<typeof useT>["t"],
) {
  const version = update.version ?? "";
  switch (status) {
    case "available":
      return t("options.personal.update.availableDetail");
    case "offered":
      return t("options.personal.update.offered", { version });
    case "cancelled":
      return t("options.personal.update.cancelled");
    case "downloading":
      return t("options.personal.update.downloadingTitle", { version });
    case "downloaded":
      return t("options.personal.update.readyToInstall");
    case "ready":
      return t("options.personal.update.manualInstallHint");
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
