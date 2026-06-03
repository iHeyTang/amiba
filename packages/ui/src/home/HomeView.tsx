/**
 * Hermes Home page — cron-run reader + recent chats + composer hand-off.
 *
 * Shared by extension's `chrome_url_overrides.newtab` page and desktop's
 * main BrowserWindow. Pure UI; chrome-specific behaviours (bookmark
 * shortcuts, favicon lookup) come in via the `HomeCapabilities` prop —
 * when absent, the corresponding section hides or falls back to a
 * generic icon.
 */

import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Globe,
  Settings,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  transcribeAudio,
  useSessions,
  useVoicePrefs,
  useWallpaper,
  type WallpaperController,
} from "@hermes-x/core";
import {
  Composer,
  queueChatPrompt,
  useComposerAttachments,
  useVoiceRecorder,
  WallpaperBackdrop,
  WallpaperCredit,
  type ComposerHandle,
} from "../chat";
import { shortId } from "@hermes-x/utils";
import { useT } from "@hermes-x/i18n";
import { useResolvedTheme } from "../theme";
import { HermesLogo } from "../primitives";
import { cn } from "../primitives";
import {
  buildBrainInstallPrompt,
  ensureBrainDefaultUrl,
  hasGBrainBridge,
} from "../settings/brain-install";
import type {
  FaviconCapability,
  HomeCapabilities,
  HomeShortcut,
  HomeShortcutsController,
} from "./capabilities";

const NO_SHORTCUTS_CONTROLLER: HomeShortcutsController = {
  ready: true,
  items: [],
  error: null,
  async add() {},
  async remove() {},
  async rename() {},
  async reorder() {},
  async refresh() {},
};

function useNoShortcuts(): HomeShortcutsController {
  return NO_SHORTCUTS_CONTROLLER;
}

export interface HomeViewProps {
  /** Where to send the user when they hit "Open in tab" / submit chat. */
  onOpenChat: () => void;
  /** TabBar gear / top-bar gear → open Settings. */
  onOpenSettings: () => void;
  /** Extension-only capabilities (bookmark shortcuts + favicon URL). */
  capabilities?: HomeCapabilities;
  /**
   * Pixel reserve on the left edge of the top header so OS chrome
   * (macOS traffic lights when running inside Electron with a hidden
   * title bar) doesn't visually collide with the Hermes logo + title.
   * Default 0 — extension uses 0; desktop passes ~78 on mac.
   */
  headerLeftInset?: number;
  /**
   * Extra className applied to the top header. Desktop passes
   * `app-drag-region` so the user can drag the window from the header
   * (buttons inside opt out automatically via the global CSS rule).
   */
  headerClassName?: string;
  /**
   * Hide the internal TopBar entirely. Desktop sets this `true` and
   * renders its own immersive title bar (with traffic-light reserve)
   * outside of HomeView, hosting the wallpaper + settings actions.
   */
  hideInternalHeader?: boolean;
  /**
   * Embedded "panel" rendering: drop the full-screen chrome so HomeView
   * can be mounted inside another container (e.g. the chat surface's
   * empty state). Skips the wallpaper backdrop, TopBar, BottomPeek
   * dashboard + its global wheel listener; the outer wrapper grows to
   * its parent's height instead of `h-screen`. The composer card
   * itself remains the centre-piece. Use this when the chat view
   * wants to show "the home-page composer" while nothing's selected.
   */
  panelMode?: boolean;
}

export default function HomeView(props: HomeViewProps) {
  useResolvedTheme();
  return <Home {...props} />;
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

function Home({
  onOpenChat,
  onOpenSettings,
  capabilities,
  headerLeftInset,
  headerClassName,
  hideInternalHeader,
  panelMode,
}: HomeViewProps) {
  const { t, language } = useT();
  const sessions = useSessions();
  // Shortcuts hook is capability-provided — stable across renders. Falls
  // back to a no-op so the rules-of-hooks order stays consistent.
  const useShortcutsHook = capabilities?.shortcuts?.useController ?? useNoShortcuts;
  const shortcuts = useShortcutsHook();
  const wallpaper = useWallpaper();
  // Composer attachments — same hook the main panel and Quick-Ask use.
  // The session id is just a folder name for the backplane upload path;
  // we use a stable HomeView-scoped one so re-uploads land in the same
  // bucket and clean up cleanly on chat hand-off.
  const homeUploadSessionRef = useRef<string>(shortId("home"));
  const att = useComposerAttachments({
    getSessionId: () => homeUploadSessionRef.current,
  });

  // Typewriter placeholder examples — memoised so the cycling effect
  // doesn't restart on every render. Re-derived only when the locale
  // changes (which itself re-binds ``t``).
  const placeholderExamples = useMemo(
    () => [
      t("newtab.placeholder.example.1"),
      t("newtab.placeholder.example.2"),
      t("newtab.placeholder.example.3"),
      t("newtab.placeholder.example.4"),
      t("newtab.placeholder.example.5"),
    ],
    [t],
  );

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<ComposerHandle | null>(null);

  // Voice input — same pipeline as the chat composer. The recorder hook
  // owns the MediaRecorder lifecycle; once the user stops we POST the
  // blob to /hermes/stt and append the transcript to ``input``. ``enabled``
  // gates the button on/off so the prefs page can hide voice entirely.
  const voicePrefs = useVoicePrefs();
  const voiceRecorder = useVoiceRecorder({
    deviceId: voicePrefs.deviceId || undefined,
  });
  const [voiceTranscribing, setVoiceTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  // Brain hint — show when gbrain bridge exists but is not connected
  const [showBrainHint, setShowBrainHint] = useState(false);
  useEffect(() => {
    if (!hasGBrainBridge()) return;
    const bridge = (window as unknown as {
      hermes: { gbrain: { health: () => Promise<unknown> } };
    }).hermes.gbrain;
    void bridge
      .health()
      .then((h) => {
        setShowBrainHint(!h);
      })
      .catch(() => {
        // Bridge exists but health probe blew up — still surface the
        // hint; the install flow handles "not actually gbrain" cases.
        setShowBrainHint(true);
      });
  }, []);

  // On mount: focus the composer textarea.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Navigate to the chat view. Extension does an in-page redirect to
  // `tabs/chat.html`; desktop just switches a state variable in App.
  // Either way, the caller supplies `onOpenChat`.
  function goToChatTab() {
    onOpenChat();
  }

  async function submitToChat(text: string) {
    const trimmed = text.trim();
    const readyAttachments = att.attachments.filter(
      (a) => a.path && !a.uploading,
    );
    if (att.attachmentUploading) return;
    if (!trimmed && readyAttachments.length === 0) return;
    if (busy || !sessions.ready) return;
    setBusy(true);
    try {
      // HomeView only carries the *intent* to start a chat — the
      // receiving surface (``ChatSurface`` in panelMode, or
      // ``tabs/chat.html``'s ``FullScreenChatView`` after navigation)
      // is what actually creates the session via ``ensureActive``
      // inside its autosend chain.
      //
      // Previously HomeView called ``sessions.createNew()`` itself
      // before writing the pending prompt. That worked in panel mode
      // (same Store → the new session id propagates immediately) but
      // produced an orphan unnamed conversation in the cross-window
      // case: newtab's local Store minted session A; navigating to
      // ``tabs/chat.html`` mounts a fresh per-window Store whose
      // ``activeId`` starts empty (per-window selection — see
      // ``SessionsStore``); chat.html's autosend then calls
      // ``ensureActive`` which mints session B. Session A is left
      // dangling in the rail as an unnamed empty row.
      //
      // Letting only the receiving surface create the session avoids
      // that fork entirely. ``ensureActive`` short-circuits to the
      // local active id when one exists (panelMode with a selected
      // empty session — "scenario 2") and creates a fresh session
      // when there isn't (newtab → chat hand-off or panelMode empty
      // activeId — "scenario 1"). One session in either case.
      //
      // Uses `queueChatPrompt` (the bare write — no `createNew`)
      // rather than the `useChatSessionRequester` hook with `mode:
      // "new"` precisely because of the orphan-session story above.
      await queueChatPrompt({
        text: trimmed || undefined,
        attachments:
          readyAttachments.length > 0
            ? readyAttachments
                // `readyAttachments` is already filtered on `a.path` above
                // (`att.attachments.filter((a) => a.path && !a.uploading)`),
                // so each entry's path is a string at runtime. The filter
                // doesn't narrow the type, so re-check here for TS.
                .filter((a): a is typeof a & { path: string } => !!a.path)
                .map((a) => ({
                  uiId: a.uiId,
                  name: a.name,
                  mime: a.mime,
                  size: a.size,
                  kind: a.kind,
                  path: a.path,
                  thumbDataUrl: a.thumbDataUrl,
                  textPreview: a.textPreview,
                }))
            : undefined,
      });
      // Hand-off done — drop them from the composer state without
      // deleting the files (the chat surface now owns them). Mint a
      // new staging session for the next round.
      att.setAttachments([]);
      homeUploadSessionRef.current = shortId("home");
      goToChatTab();
    } finally {
      setBusy(false);
    }
  }

  const handleVoiceToggle = useCallback(() => {
    if (voiceTranscribing) return;
    setVoiceError(null);
    if (!voiceRecorder.recording) {
      void voiceRecorder.start().catch((e) => {
        const message = String((e as Error)?.message || e);
        setVoiceError(
          message === "Permission denied"
            ? t("composer.voice.permissionDenied")
            : t("composer.voice.transcribeFailed", { error: message }),
        );
      });
      return;
    }
    setVoiceTranscribing(true);
    void (async () => {
      try {
        const blob = await voiceRecorder.stop();
        if (!blob || blob.size === 0) return;
        const result = await transcribeAudio(blob);
        if (result.ok !== true) {
          // ``in`` narrows under both strict and non-strict tsconfigs
          // (the workspace ships both via different apps).
          const message = "error" in result ? result.error : "unknown";
          setVoiceError(
            t("composer.voice.transcribeFailed", { error: message }),
          );
          return;
        }
        const transcript = result.text.trim();
        if (!transcript) return;
        setInput((prev) => {
          if (!prev) return transcript;
          // Avoid double-space when the buffer already ends in whitespace
          // (mid-edit append from a paused dictation).
          return /\s$/.test(prev) ? prev + transcript : prev + " " + transcript;
        });
        inputRef.current?.focus();
      } catch (e) {
        setVoiceError(
          t("composer.voice.transcribeFailed", {
            error: String((e as Error)?.message || e),
          }),
        );
      } finally {
        setVoiceTranscribing(false);
      }
    })();
  }, [voiceRecorder, voiceTranscribing, t]);

  const canSend =
    (input.trim().length > 0 || att.hasReadyAttachment()) &&
    !busy &&
    !att.attachmentUploading &&
    !att.attachmentBusy &&
    sessions.ready;

  return (
    <div
      className={cn(
        // `isolate` confines the wallpaper's negative-z stacking to this
        // subtree; without it `-z-10` would escape behind <html> and the
        // overlay would never visibly composite. We deliberately drop the
        // outer `bg-background`: WallpaperBackdrop renders the base color
        // itself so the wallpaper can paint on top of it when enabled.
        // `overflow-hidden` hard-clips the bottom peek panel when it's
        // translated below the viewport in its collapsed state; without
        // this, the off-screen 60vh of panel would extend the document
        // height and let the user scroll into a "ghost" area below the
        // wallpaper.
        //
        // Panel mode (embedded in another container, e.g. the chat
        // surface's empty state) fills its parent instead — h-screen
        // would force the outer chrome to scroll. The chat surface
        // hosts its own background, so the wallpaper layer is skipped.
        panelMode
          ? "relative flex h-full w-full flex-col overflow-hidden text-foreground"
          : "relative isolate flex h-screen w-full flex-col overflow-hidden text-foreground",
      )}
    >
      {!panelMode && <WallpaperBackdrop controller={wallpaper} />}
      {!hideInternalHeader && !panelMode && (
        <TopBar
          wallpaperController={wallpaper.enabled ? wallpaper : null}
          onOpenSettings={() => onOpenSettings()}
          leftInset={headerLeftInset}
          className={headerClassName}
        />
      )}

      <main
        className={cn(
          "flex w-full flex-1 flex-col gap-6 overflow-hidden px-8",
          // Centred vertically with a slight upward bias (the empty
          // composer feels more at home around the upper third than
          // dead-centre). Achieved via `padding-bottom` — shrinks the
          // available area from below so `justify-center` re-centres
          // the content in the smaller space.
          "justify-center pb-[6vh]",
        )}
      >
        <section className="mx-auto w-full max-w-2xl shrink-0 space-y-2">
          {/* Floating text picks its colour off the wallpaper's
              average luminance — but ONLY once measurement has landed
              (`wallpaper.mode !== null`). Before then, whatever is
              actually visible behind the text is the theme's
              `bg-background` (the wallpaper image is still loading
              with `opacity-0`, or measurement permanently failed), so
              `text-foreground` is the correct, theme-matched fallback.
              The previous "always-white-when-wallpaper-enabled"
              fallback failed on blank/light backgrounds in light
              theme. */}
          {panelMode ? (
            // Panel mode (embedded in the chat surface's empty state):
            // a centred Hermes mark over a single-line description.
            // Matches the look the ChatSurface fallback used to
            // render, so the home composer reads as "Hermes here, type
            // below" instead of an out-of-context wordmark + tagline.
            <div className="flex flex-col items-center gap-2 text-center">
              <HermesLogo size={56} />
              <p className="max-w-[40ch] text-xs text-muted-foreground">
                {t("newtab.subtitle")}
              </p>
            </div>
          ) : (
            (() => {
              const ambient =
                wallpaper.enabled &&
                wallpaper.wallpaper &&
                wallpaper.mode !== null;
              const className = cn(
                "space-y-0.5 px-0.5",
                // No colour transition: the wallpaper-driven palette swap
                // pairs with an instant logo-asset swap; a fading text
                // beside an already-snapped logo reads as out-of-sync.
                !ambient
                  ? "text-foreground"
                  : wallpaper.mode === "light"
                    ? "text-neutral-900 [&_p]:drop-shadow-[0_1px_1px_rgba(255,255,255,0.4)]"
                    : "text-white [&_p]:drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]",
              );
              return (
                <div className={className}>
                  <p className="text-sm font-semibold">
                    {t("newtab.greeting")}
                  </p>
                  <p className="text-xs opacity-80">{t("newtab.subtitle")}</p>
                </div>
              );
            })()
          )}
          <Composer
            ref={inputRef}
            value={input}
            onChange={setInput}
            onSubmit={(override) => void submitToChat(override ?? input)}
            busy={busy}
            canSubmit={canSend}
            frameVariant="hero"
            maxTextareaPx={280}
            placeholder={{ typewriter: placeholderExamples }}
            attachments={att}
            microphone={
              voicePrefs.enabled
                ? {
                    recording: voiceRecorder.recording,
                    transcribing: voiceTranscribing,
                    onToggle: handleVoiceToggle,
                  }
                : undefined
            }
            dropOverlay={t("newtab.dropOverlay")}
            sendTitle={t("newtab.send.tooltip")}
            kbdHints={[
              { keys: "⏎", label: t("sidepanel.composer.kbd.send") },
              { keys: "⇧⏎", label: t("sidepanel.composer.kbd.newline") },
            ]}
            extrasBelow={
              voiceError ? (
                <p role="alert" className="text-[11px] text-destructive">
                  {voiceError}
                </p>
              ) : undefined
            }
          />
        </section>

        {/* Knowledge-base hint — subtle pill above the composer when
            the gbrain bridge exists but isn't connected yet. Clicking
            prefills the composer with the install prompt and focuses
            the input, leaving the actual send to the user (they can
            read/edit/back out). We still pre-seed the default brain URL
            so a successful install lands on the right port without
            requiring another visit to Settings → Knowledge. */}
        {showBrainHint && (
          <button
            type="button"
            onClick={() => {
              setShowBrainHint(false);
              setInput(buildBrainInstallPrompt(language));
              inputRef.current?.focus();
              void ensureBrainDefaultUrl();
            }}
            className="mx-auto flex items-center gap-2 rounded-full border border-border/50 bg-background/60 px-4 py-1.5 text-xs text-muted-foreground backdrop-blur-sm transition-colors hover:border-primary/30 hover:text-foreground"
          >
            <BookOpen className="h-3.5 w-3.5" />
            {t("newtab.brainHint")}
          </button>
        )}

        {/*
          Shortcuts strip is extension-only (backed by chrome.bookmarks).
          Render only when the capability is supplied — desktop omits, so
          the empty-state "add your most-visited sites" hint never appears.
        */}
        {capabilities?.shortcuts && (
          <ShortcutsStrip
            controller={shortcuts}
            ambientMode={wallpaper.enabled ? wallpaper.mode : null}
            faviconCapability={capabilities?.favicon}
          />
        )}
      </main>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Home shortcuts — quick-launch strip between the composer and the dashboard.
//
// Cards are bookmarks under a dedicated folder; see
// `lib/home-shortcuts/use-home-shortcuts.ts`. The strip exposes the bare
// minimum of newtab-native interactions (add, remove, drag-reorder); deeper
// edits (rename, move out of folder, etc.) happen in Chrome's bookmark
// manager and stream back here via bookmark events.
// ---------------------------------------------------------------------------

function faviconUrl(
  url: string,
  size = 32,
  bust?: number,
  capability?: FaviconCapability,
): string {
  // Capability-provided. Extension binds to Chrome's `_favicon/` service;
  // desktop omits and we fall back to "" so the UI renders a generic
  // globe icon. `bust` flips the query so re-renders that should re-check
  // (newtab mount, tab regains visibility) actually re-hit the favicon
  // service instead of being pinned to the renderer's HTTP cache.
  if (!capability) return "";
  const base = capability.resolve(url, size);
  if (!base) return "";
  return bust ? `${base}&v=${bust}` : base;
}

function normalizeAddUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    // Throws on truly malformed input; otherwise normalises (case, idn, …).
    const u = new URL(withScheme);
    return u.toString();
  } catch {
    return null;
  }
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function ShortcutsStrip({
  controller,
  ambientMode,
  faviconCapability,
}: {
  controller: HomeShortcutsController;
  ambientMode: "light" | "dark" | null;
  faviconCapability?: FaviconCapability;
}) {
  const { t } = useT();
  const { ready, items } = controller;
  const [managerOpen, setManagerOpen] = useState(false);
  // Cache-buster passed to `faviconUrl`. Reseeded on mount AND every time
  // the tab becomes visible again, so cards re-check Chrome's favicon
  // service after a click-through that populated the cache. Without this
  // the renderer's HTTP cache pins whatever response landed first
  // (usually Chrome's default globe) for the whole tab session.
  const [faviconBust, setFaviconBust] = useState<number>(() => Date.now());
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "visible") {
        setFaviconBust(Date.now());
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () =>
      document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Hide the section entirely while we're still resolving the folder on
  // first paint: the dashboard below is what users see first, and an
  // empty-but-loading strip flashing in is more visual noise than help.
  // Once `ready` is true, render — empty state included.
  if (!ready) return null;

  // Pill text colour follows the wallpaper, not the theme — see the
  // `ambientMode` prop doc above.
  const ambientTextClass =
    ambientMode === "light"
      ? "text-neutral-900"
      : ambientMode === "dark"
        ? "text-white"
        : "text-foreground";

  function openShortcut(url: string) {
    try {
      window.location.assign(url);
    } catch {
      // Fallback — open in a new tab if the current navigation is blocked.
      window.open(url, "_self");
    }
  }

  return (
    <section className="mx-auto w-full max-w-4xl shrink-0">
      <ul className="flex flex-wrap items-center justify-center gap-2.5">
        {items.map((s) => (
          <li key={s.id}>
            <ShortcutCard
              item={s}
              faviconBust={faviconBust}
              onOpen={() => openShortcut(s.url)}
              ambientTextClass={ambientTextClass}
              faviconCapability={faviconCapability}
            />
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => setManagerOpen(true)}
            aria-label={t("newtab.shortcuts.manage.tooltip")}
            title={t("newtab.shortcuts.manage.tooltip")}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-3",
              // Match the shortcut pills exactly so the row reads as
              // one continuous control surface; secondary status is
              // signalled by the icon + text choice, not by the
              // chrome being weaker.
              "bg-gradient-to-b from-card/28 to-card/12",
              "backdrop-blur-2xl backdrop-saturate-110",
              "backdrop-brightness-115 dark:backdrop-brightness-85",
              "shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.2),0_1px_2px_0_rgb(0_0_0_/_0.06),0_4px_12px_-2px_rgb(0_0_0_/_0.1)]",
              "dark:shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.08),0_1px_2px_0_rgb(0_0_0_/_0.3),0_4px_12px_-2px_rgb(0_0_0_/_0.4)]",
              ambientTextClass,
              "text-xs transition-all duration-200",
              "hover:from-card/45 hover:to-card/25",
            )}
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span>{t("newtab.shortcuts.manage")}</span>
          </button>
        </li>
      </ul>

      {items.length === 0 && (
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
          {t("newtab.shortcuts.empty")}
        </p>
      )}

      {managerOpen && (
        <ShortcutsManager
          controller={controller}
          faviconBust={faviconBust}
          onClose={() => setManagerOpen(false)}
          faviconCapability={faviconCapability}
        />
      )}
    </section>
  );
}

function ShortcutCard({
  item,
  faviconBust,
  onOpen,
  ambientTextClass,
  faviconCapability,
}: {
  item: HomeShortcut;
  faviconBust: number;
  onOpen: () => void;
  ambientTextClass: string;
  faviconCapability?: FaviconCapability;
}) {
  // Tie the "icon failed" state to the *exact* src that failed, not a
  // sticky boolean: when `faviconBust` (or item.url) changes, the src
  // changes, `failed` flips back to false, and the next render tries
  // the favicon again.
  const src = faviconUrl(item.url, 32, faviconBust, faviconCapability);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;
  // Display fallback: hostname rather than the raw URL when the stored
  // title is the auto-placeholder we wrote before scraping `<title>`.
  const trimmedTitle = item.title?.trim() || "";
  const titleLooksAuto =
    !trimmedTitle ||
    trimmedTitle === item.url ||
    trimmedTitle === item.url.replace(/\/$/, "");
  const label = titleLooksAuto ? hostFromUrl(item.url) : trimmedTitle;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${label}\n${item.url}`}
      className={cn(
        "inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-full pl-1 pr-3",
        "bg-gradient-to-b from-card/28 to-card/12",
        "backdrop-blur-2xl backdrop-saturate-110",
        "backdrop-brightness-115 dark:backdrop-brightness-85",
        // Three-layer shadow recipe = real glass:
        //   1. `inset 0 1px 0 rgba(255,255,255,X)` — a 1px-thick white
        //      highlight along the inner top edge that follows the
        //      pill's rounded curvature (the "wet-glass" catch-light).
        //   2. `0 1px 2px black` — tight outline shadow that defines
        //      the pill against the wallpaper without a hard border.
        //   3. `0 4px 12px -2px black` — diffuse drop shadow that
        //      lifts the pill off the surface.
        // Dark mode flips the highlight down (white is less visible
        // anyway) and pushes the dark shadows harder for contrast.
        "shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.2),0_1px_2px_0_rgb(0_0_0_/_0.06),0_4px_12px_-2px_rgb(0_0_0_/_0.1)]",
        "dark:shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.08),0_1px_2px_0_rgb(0_0_0_/_0.3),0_4px_12px_-2px_rgb(0_0_0_/_0.4)]",
        // `transition-all` (not `transition-[background-color]`) so the
        // gradient stops Tailwind sets via CSS variables actually
        // animate on hover — `background-image` is not in the default
        // `transition` property list, which is why the previous hover
        // change appeared instant.
        ambientTextClass,
        "text-xs transition-all duration-200",
        "hover:from-card/45 hover:to-card/25",
      )}
    >
      {/* Theme-matched favicon "tile" — pure white in light mode,
          near-black in dark mode. Mirrors how browser tabs render
          favicons: a flat surface the icon sits on with predictable
          contrast, decoupled from whatever colour the pill's glass
          happens to reveal underneath. */}
      <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white dark:bg-neutral-900">
        {failed ? (
          <Globe className="h-3.5 w-3.5 text-neutral-500" />
        ) : (
          <img
            src={src}
            alt=""
            width={16}
            height={16}
            onError={() => setFailedSrc(src)}
            className="h-4 w-4"
          />
        )}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Shortcuts manager — modal dialog. Centralises every mutation (add, rename,
// remove, reorder) so the homepage strip itself can stay strictly read-only.
// Closes on Esc, backdrop click, or the explicit ×.
// ---------------------------------------------------------------------------

function ShortcutsManager({
  controller,
  faviconBust,
  onClose,
  faviconCapability,
}: {
  controller: HomeShortcutsController;
  faviconBust: number;
  onClose: () => void;
  faviconCapability?: FaviconCapability;
}) {
  const { t } = useT();
  const { items, add, remove, rename, reorder } = controller;

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto",
        "bg-black/40 backdrop-blur-[2px] px-4 py-12",
      )}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("newtab.shortcuts.manage.title")}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "w-full max-w-lg rounded-xl border border-border bg-background shadow-2xl",
        )}
      >
        <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <h2 className="text-sm font-semibold tracking-tight">
            {t("newtab.shortcuts.manage.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("newtab.shortcuts.manage.close")}
            title={t("newtab.shortcuts.manage.close")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="px-4 pb-4 pt-3">
          <ManagerAddRow onAdd={add} />

          {items.length === 0 ? (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              {t("newtab.shortcuts.manage.listEmpty")}
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border/40 rounded-lg border border-border/60">
              {items.map((s, i) => (
                <ManagerRow
                  key={s.id}
                  item={s}
                  faviconBust={faviconBust}
                  isFirst={i === 0}
                  isLast={i === items.length - 1}
                  onRename={(title) => rename(s.id, title)}
                  onRemove={() => remove(s.id)}
                  onMoveUp={() => reorder(i, i - 1)}
                  onMoveDown={() => reorder(i, i + 1)}
                  faviconCapability={faviconCapability}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ManagerAddRow({
  onAdd,
}: {
  onAdd: (input: { url: string; title: string }) => Promise<void>;
}) {
  const { t } = useT();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const normalized = normalizeAddUrl(url);
    if (!normalized) {
      setErr(t("newtab.shortcuts.add.invalidUrl"));
      return;
    }
    setSubmitting(true);
    try {
      await onAdd({ url: normalized, title: title.trim() });
      setUrl("");
      setTitle("");
      setErr(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-1.5">
      {/* Column order mirrors the list rows below: title (primary) on the
          left, URL (secondary) on the right. Mixing the two orders would
          make users re-read each row top-to-bottom. */}
      <div className="flex items-stretch gap-1.5">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={t("newtab.shortcuts.add.dialog.titlePlaceholder")}
          className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:border-foreground/40 focus:outline-none"
        />
        <input
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (err) setErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={t("newtab.shortcuts.add.dialog.urlPlaceholder")}
          className="flex-[2] rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:border-foreground/40 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || url.trim().length === 0}
          className={cn(
            "shrink-0 rounded-md px-3 text-xs font-medium transition-colors",
            "bg-foreground text-background hover:bg-foreground/85",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {t("newtab.shortcuts.add.dialog.confirm")}
        </button>
      </div>
      {err && <p className="text-[11px] text-destructive">{err}</p>}
    </div>
  );
}

function ManagerRow({
  item,
  faviconBust,
  isFirst,
  isLast,
  onRename,
  onRemove,
  onMoveUp,
  onMoveDown,
  faviconCapability,
}: {
  item: HomeShortcut;
  faviconBust: number;
  isFirst: boolean;
  isLast: boolean;
  onRename: (title: string) => Promise<void> | void;
  onRemove: () => Promise<void> | void;
  onMoveUp: () => Promise<void> | void;
  onMoveDown: () => Promise<void> | void;
  faviconCapability?: FaviconCapability;
}) {
  const { t } = useT();
  const src = faviconUrl(item.url, 32, faviconBust, faviconCapability);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;
  const trimmedTitle = item.title?.trim() || "";
  const titleLooksAuto =
    !trimmedTitle ||
    trimmedTitle === item.url ||
    trimmedTitle === item.url.replace(/\/$/, "");
  const initialLabel = titleLooksAuto ? hostFromUrl(item.url) : trimmedTitle;
  // Local input state so the user can type without the bookmark
  // round-tripping on every keystroke. Commit on blur or Enter.
  const [draft, setDraft] = useState(initialLabel);
  // If the upstream item title changes (e.g. agent renamed it from
  // elsewhere, or scrape finished), pick up the new value — but only
  // when the input isn't currently dirty (user is typing).
  useEffect(() => {
    setDraft(initialLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.title]);

  function commit() {
    const next = draft.trim();
    if (!next || next === initialLabel) return;
    void onRename(next);
  }

  return (
    <li className="flex items-center gap-2 px-2.5 py-2">
      {/* Same tile colour as the homepage pills — keeps the modal's
          row visually consistent with what the user sees outside it. */}
      <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white dark:bg-neutral-900">
        {failed ? (
          <Globe className="h-3.5 w-3.5 text-neutral-500" />
        ) : (
          <img
            src={src}
            alt=""
            width={16}
            height={16}
            onError={() => setFailedSrc(src)}
            className="h-4 w-4"
          />
        )}
      </span>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(initialLabel);
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        aria-label={t("newtab.shortcuts.rename")}
        className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs text-foreground hover:border-border focus:border-foreground/40 focus:bg-background focus:outline-none"
      />
      <span
        className="hidden truncate text-[10px] text-muted-foreground/70 sm:inline-block sm:max-w-[140px]"
        title={item.url}
      >
        {hostFromUrl(item.url)}
      </span>
      <div className="flex shrink-0 items-center">
        <button
          type="button"
          onClick={() => void onMoveUp()}
          disabled={isFirst}
          aria-label={t("newtab.shortcuts.manage.moveUp")}
          title={t("newtab.shortcuts.manage.moveUp")}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void onMoveDown()}
          disabled={isLast}
          aria-label={t("newtab.shortcuts.manage.moveDown")}
          title={t("newtab.shortcuts.manage.moveDown")}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void onRemove()}
          aria-label={t("newtab.shortcuts.remove")}
          title={t("newtab.shortcuts.remove")}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

function TopBar({
  wallpaperController,
  onOpenSettings,
  leftInset = 0,
  className,
}: {
  wallpaperController: WallpaperController | null;
  onOpenSettings: () => void;
  /**
   * Extra left padding so the wordmark + logo don't collide with
   * desktop OS chrome (macOS traffic lights) at the top-left corner.
   */
  leftInset?: number;
  /** Extra className (desktop passes `app-drag-region` for window dragging). */
  className?: string;
}) {
  const { t } = useT();
  // Same `ambient` gate the greeting block / shortcut pills use — we
  // only switch off `text-foreground` once the wallpaper's luminance
  // mode has actually been measured. Before then the visible surface
  // is `bg-background` (image still loading / measurement failed), so
  // the theme color is the right baseline.
  const ambient =
    wallpaperController?.enabled === true &&
    wallpaperController.wallpaper !== null &&
    wallpaperController.mode !== null;
  const wordmarkClass = !ambient
    ? "text-foreground"
    : wallpaperController?.mode === "light"
      ? "text-neutral-900 [&_p]:drop-shadow-[0_1px_1px_rgba(255,255,255,0.4)]"
      : "text-white [&_p]:drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]";
  // Action icons (credit chip, Settings) need the same adaptation but
  // we keep them slightly dimmer than the wordmark — they're tools, not
  // headings — and let `hover:` push to full prominence.
  const iconClass = !ambient
    ? "text-muted-foreground hover:text-foreground"
    : wallpaperController?.mode === "light"
      ? "text-neutral-900/75 hover:text-neutral-900"
      : "text-white/80 hover:text-white";
  // HermesLogo is a raster PNG, not a currentColor SVG, so it can't
  // inherit `wordmarkClass`. Pick the contrasting variant explicitly
  // from the wallpaper mode (when ambient) or fall back to the document
  // theme (when not). Mode "light" = light photograph behind it →
  // render the dark-glyph variant via `light-bg`.
  const logoVariant: "auto" | "light-bg" | "dark-bg" = !ambient
    ? "auto"
    : wallpaperController?.mode === "light"
      ? "light-bg"
      : "dark-bg";
  return (
    <header
      className={cn(
        "flex shrink-0 items-center justify-between gap-3 py-4 pr-6",
        className,
      )}
      style={{ paddingLeft: Math.max(leftInset, 24) }}
    >
      <div
        className={cn(
          // No `transition-colors` here: the logo PNG swaps its asset
          // instantly when wallpaper mode lands, so a fading wordmark
          // beside an already-snapped logo reads as out-of-sync.
          "flex items-center gap-2.5",
          wordmarkClass,
        )}
      >
        <HermesLogo size={22} variant={logoVariant} />
        <p className="text-sm font-semibold tracking-tight">
          {t("app.title")}
        </p>
      </div>
      <div className="flex items-center gap-1">
        {wallpaperController?.wallpaper ? (
          <WallpaperCredit
            controller={wallpaperController}
            ambientClass={iconClass}
          />
        ) : null}
        <button
          type="button"
          onClick={onOpenSettings}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors",
            "hover:bg-white/10",
            iconClass,
          )}
          aria-label={t("newtab.openOptions")}
          title={t("newtab.openOptions")}
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

