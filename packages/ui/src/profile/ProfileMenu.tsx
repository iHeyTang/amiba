import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronRight,
  ChevronsUpDown,
  ExternalLink,
  Github,
  RefreshCw,
} from "lucide-react";
import { type AppUpdateState, getPlatform } from "@amiba/app-runtime/platform";
import { useT } from "@amiba/i18n";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
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
          size="sm"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            menuTrigger.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("options.personal.checkUpdates")}</DialogTitle>
            <p className="pt-1 text-sm text-muted-foreground">
              {t("options.personal.currentVersion")} · v{update.currentVersion}
            </p>
            <DialogDescription>
              {t(`options.personal.update.${update.status}`, { version: update.version ?? "", percent: String(Math.round(update.percent ?? 0)) })}
            </DialogDescription>
          </DialogHeader>
          {update.status === "downloading" && (
            <progress aria-label={t("options.personal.update.progress")} className="h-2 w-full accent-primary" max={100} value={update.percent ?? 0} />
          )}
          {update.status === "error" && <p role="alert" className="break-words text-xs text-muted-foreground">{update.error}</p>}
          <DialogFooter>
            {update.status === "downloaded" ? (
              <Button onClick={() => { void updater?.install().catch(updateError); }}>{t("options.personal.update.install")}</Button>
            ) : updater && update.status !== "disabled" && (
              <Button disabled={["checking", "available", "downloading"].includes(update.status)} onClick={checkUpdates}>{t("options.personal.checkUpdates")}</Button>
            )}
            <DialogClose asChild>
              <Button>{t("common.close")}</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
