import { ReplacementBoundary } from "../chat/ReplacementBoundary";
import { useNewChatWorkspace } from "../chat/new-chat-workspace";
import { useDirectoryChooser } from "../directory-chooser";
import { InteractionRegion } from "../primitives/interaction-region";
import { EmptyStateVisual } from "../primitives/empty-state-visual";
/**
 * Amiba Home page — recent tasks + composer hand-off.
 *
 * Used by the desktop main window and by the empty conversation state.
 * Runtime behavior is supplied by the desktop platform and managed DSH
 * adapters; the component owns presentation only.
 */

import { Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getAgentPresets,
  normalizeAgentContext,
  useSessions,
  useWallpaper,
  type WallpaperController,
  type AgentExecutionContext,
} from "@amiba/app-runtime/core";
import {
  Composer,
  ComposerNotice,
  queueChatPrompt,
  useComposerAttachments,
  WallpaperBackdrop,
  WallpaperCredit,
  WorkspaceControl,
  type ComposerHandle,
  type ComposerModelPickerRenderer,
} from "../chat";
import { getPlatform, type AgentModelSelection } from "@amiba/app-runtime/platform";
import { shortId } from "@amiba/app-runtime/utils";
import { useT } from "@amiba/i18n";
import { useResolvedTheme } from "../theme";
import { AmibaLogo } from "../primitives";
import { cn } from "../primitives";
import type { ComposerTriggerRuntime } from "../chat/composer/triggers/contracts";

/**
 * Draft hand-off INTO the home composer: a plain string a host queues
 * (e.g. the shell's `open-new-chat` layout action) that pre-fills the
 * composer WITHOUT sending — unlike `home.pendingPrompt`, whose drain
 * auto-sends and creates the session. HomeView drains it destructively
 * on mount and on storage change.
 */
export const HOME_PENDING_DRAFT_KEY = "home.pendingDraft";

export interface HomeViewProps {
  renderAttachments?: import("../chat/Composer").ComposerAttachmentsRenderer;
  brandMark?: (owner: { size: number; className?: string }, fallback: import("react").ReactNode) => import("react").ReactNode;
  triggerRuntime?: ComposerTriggerRuntime;
  /** Where to send the user when they hit "Open in tab" / submit chat. */
  onOpenChat: () => void;
  /** TabBar gear / top-bar gear → open Settings. */
  onOpenSettings: () => void;
  /**
   * Pixel reserve on the left edge of the top header so OS chrome
   * (macOS traffic lights when running inside Electron with a hidden
   * title bar) doesn't visually collide with the Amiba logo + title.
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
  /**
   * renderSlot-backed composer model-picker renderer, forwarded to
   * ``<Composer modelPicker>`` together with HomeView's own draft-selection
   * state. Hosts without a DSH plugin runtime omit it; the composer then
   * renders nothing where the chip would sit.
   */
  modelPicker?: ComposerModelPickerRenderer;
}

export default function HomeView(props: HomeViewProps) {
  useResolvedTheme();
  return <Home {...props} />;
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

function Home({
  renderAttachments,
  brandMark,
  onOpenChat,
  onOpenSettings,
  headerLeftInset,
  headerClassName,
  hideInternalHeader,
  panelMode,
  modelPicker,
  triggerRuntime,
}: HomeViewProps) {
  const { t, language } = useT();
  const sessions = useSessions();
  const wallpaper = useWallpaper();
  // Composer attachments — same hook the main panel and Quick-Ask use.
  // The session id scopes the host attachment staging directory;
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
  const [agent, setAgent] = useState<AgentExecutionContext>({
    profileId: "default",
  });
  const [draftModelSelection, setDraftModelSelection] =
    useState<AgentModelSelection>();
  const [busy, setBusy] = useState(false);
  const newChatWorkspace = useNewChatWorkspace();
  const [workspacePath, setWorkspacePath] = useState<string | null>(newChatWorkspace?.path ?? null);
  const [defaultWorkspaceRoot, setDefaultWorkspaceRoot] = useState<
    string | null
  >(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const inputRef = useRef<ComposerHandle | null>(null);
  const chooseDirectory = useDirectoryChooser("home");
  const canChooseWorkspace = Boolean(chooseDirectory);

  // Sidebar shortcuts select a draft directory without creating an empty session.
  useEffect(() => {
    if (!newChatWorkspace) return;
    setWorkspacePath(newChatWorkspace.path ?? defaultWorkspaceRoot);
    setWorkspaceError(null);
    inputRef.current?.focus();
    // Only navigation requests reset a manual selection. Default-root loading
    // below fills a still-empty selection without overwriting a chosen folder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newChatWorkspace]);

  // On mount: focus the composer textarea.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Drain a queued composer draft (see HOME_PENDING_DRAFT_KEY): fill the
  // input, never send. Destructive read, same idiom as the pendingPrompt
  // drain, so remounts don't re-apply a stale draft.
  useEffect(() => {
    const storage = getPlatform().storage;
    let alive = true;
    const drain = async () => {
      try {
        const snapshot = await storage.get(HOME_PENDING_DRAFT_KEY);
        const raw = snapshot[HOME_PENDING_DRAFT_KEY];
        if (typeof raw !== "string" || !raw.trim()) return;
        await storage.remove(HOME_PENDING_DRAFT_KEY);
        if (!alive) return;
        setInput(raw);
        inputRef.current?.focus();
      } catch {
        // Storage unavailable (e.g. runtime-less hosts): no draft to show.
      }
    };
    void drain();
    const unwatch = storage.watch([HOME_PENDING_DRAFT_KEY], (changes) => {
      if (changes[HOME_PENDING_DRAFT_KEY]?.newValue != null) void drain();
    });
    return () => {
      alive = false;
      unwatch();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void getAgentPresets().then((result) => {
      if (alive && result.ok) {
        setAgent({ profileId: result.active || "default" });
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // Desktop tasks always have a workspace. Until the user picks a project
  // directory, make the product-level task workspace visible in the composer
  // instead of representing it as an ambiguous "no directory" state.
  useEffect(() => {
    const workspaces = getPlatform().workspaces;
    if (!workspaces) return;
    let cancelled = false;
    void workspaces
      .getDefaultRoot()
      .then((root) => {
        if (cancelled) return;
        setDefaultWorkspaceRoot(root);
        setWorkspacePath((current) => current ?? root);
      })
      .catch((error) => {
        if (cancelled) return;
        setWorkspaceError(String((error as Error)?.message || error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Navigate to the desktop chat view through the caller-provided handler.
  function goToChatTab() {
    onOpenChat();
  }

  async function chooseWorkspace() {
    const choose = chooseDirectory;
    if (!choose) return;
    try {
      await choose(workspacePath ?? undefined, async (selected) => {
        setWorkspacePath(selected);
        setWorkspaceError(null);
      });
    } catch (e) {
      setWorkspaceError(
        t("workspace.pickerFailed", {
          error: String((e as Error)?.message || e),
        }),
      );
    }
  }

  async function submitToChat(text: string) {
    const trimmed = text.trim();
    const readyAttachments = att.attachments.filter(
      (a) => a.attachmentId && !a.uploading,
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
      // that fork entirely. The home surface has no active id, so the
      // autosend path creates exactly one session when it submits the
      // first message.
      //
      // Uses `queueChatPrompt` (the bare write — no `createNew`)
      // rather than the `useChatSessionRequester` hook with `mode:
      // "new"` precisely because of the orphan-session story above.
      await queueChatPrompt({
        text: trimmed || undefined,
        agent,
        modelSelection: draftModelSelection,
        // The default root is resolved again by the receiving chat surface.
        // Only carry an explicit override through the pending-prompt handoff.
        workspacePath:
          workspacePath && workspacePath !== defaultWorkspaceRoot
            ? workspacePath
            : undefined,
        attachments:
          readyAttachments.length > 0
            ? readyAttachments
                // `readyAttachments` is already filtered on `attachmentId`
                // above, so each entry's id is a string at runtime. The filter
                // doesn't narrow the type, so re-check here for TS.
                .filter(
                  (a): a is typeof a & { attachmentId: string } =>
                    !!a.attachmentId,
                )
                .map((a) => ({
                  uiId: a.uiId,
                  name: a.name,
                  mime: a.mime,
                  size: a.size,
                  kind: a.kind,
                  attachmentId: a.attachmentId,
                  thumbDataUrl: a.thumbDataUrl,
                  textPreview: a.textPreview,
                }))
            : undefined,
      });
      // Hand-off done — drop them from the composer state without
      // deleting the files (the chat surface now owns them). Mint a
      // new staging session for the next round.
      att.setAttachments([]);
      setDraftModelSelection(undefined);
      homeUploadSessionRef.current = shortId("home");
      goToChatTab();
    } finally {
      setBusy(false);
    }
  }

  const canSend =
    (input.trim().length > 0 || att.hasReadyAttachment()) &&
    !busy &&
    !att.attachmentUploading &&
    !att.attachmentBusy &&
    sessions.ready;

  return (
    <InteractionRegion
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
            // Let the companion lead, with one quiet invitation above the composer.
            <div className="flex flex-col items-center gap-2 text-center">
              <ReplacementBoundary render={brandMark ? fallback => brandMark({ size: 56 }, fallback) : undefined}><EmptyStateVisual scene="home"><AmibaLogo size={56} /></EmptyStateVisual></ReplacementBoundary>
              <p className="text-balance text-sm font-normal leading-6 text-muted-foreground">
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
                  <EmptyStateVisual scene="home" />
                  <p className="text-balance text-sm font-normal leading-6 opacity-80">
                    {t("newtab.subtitle")}
                  </p>
                </div>
              );
            })()
          )}
          <Composer
            triggerRuntime={triggerRuntime}
            ref={inputRef}
            value={input}
            onChange={setInput}
            onSubmit={(text) => void submitToChat(text)}
            busy={busy}
            canSubmit={canSend}
            frameVariant="hero"
            maxTextareaPx={280}
            placeholder={{ typewriter: placeholderExamples }}
            attachments={att}
            renderAttachments={renderAttachments}
            dropOverlay={t("newtab.dropOverlay")}
            sendTitle={t("newtab.send.tooltip")}
            modelPicker={
              modelPicker
                ? {
                    render: modelPicker,
                    draftSelection: draftModelSelection,
                    onDraftSelectionChange: setDraftModelSelection,
                  }
                : undefined
            }
            approvalModePicker
            agentPicker={{
              value: agent,
              onChange: (next) => setAgent(normalizeAgentContext(next)),
            }}
            kbdHints={[
              { keys: "⏎", label: t("sidepanel.composer.kbd.send") },
              { keys: "⇧⏎", label: t("sidepanel.composer.kbd.newline") },
            ]}
            contextRail={
              canChooseWorkspace ? (
                <WorkspaceControl
                  path={workspacePath}
                  onChoose={() => void chooseWorkspace()}
                  onClear={
                    workspacePath &&
                    defaultWorkspaceRoot &&
                    workspacePath !== defaultWorkspaceRoot
                      ? () => {
                          setWorkspacePath(defaultWorkspaceRoot);
                          setWorkspaceError(null);
                        }
                      : undefined
                  }
                  disabled={busy}
                />
              ) : undefined
            }
            floatingNotice={
              workspaceError ? (
                <ComposerNotice
                  detail={workspaceError}
                  onDismiss={() => setWorkspaceError(null)}
                  title={t("workspace.errorTitle")}
                />
              ) : undefined
            }
          />
        </section>
      </main>
    </InteractionRegion>
  );
}

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
  // AmibaLogo uses a themed image asset, not a currentColor SVG, so it can't
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
          // No `transition-colors` here: the logo swaps its asset
          // instantly when wallpaper mode lands, so a fading wordmark
          // beside an already-snapped logo reads as out-of-sync.
          "flex items-center gap-2.5",
          wordmarkClass,
        )}
      >
        <AmibaLogo size={22} variant={logoVariant} />
        <p className="text-sm font-semibold tracking-tight">{t("app.title")}</p>
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
