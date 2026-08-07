/**
 * Spotlight-style Quick-Ask popup.
 *
 * Architecturally this is *the same chat surface as the desktop main
 * window's right pane* — it mounts ``<ChatSurface />`` directly so
 * the conversation flow, composer, attachments, approvals, reasoning,
 * tool progress, etc. are guaranteed-identical to what the user sees
 * inside the main BrowserWindow. The only differences are:
 *
 *   - **Outer shell**: drag region, Esc-to-dismiss, ⌘K-new-conversation,
 *     and the window-resize coordination (compact → hugs the composer,
 *     expanded → snaps to ``EXPANDED_HEIGHT_PX`` so streaming chunks
 *     scroll inside the messages region without jittering the window).
 *   - **Empty state**: ``emptyState="composer-only"`` on ChatSurface
 *     skips the logo+greeting hero and lets the body shrink to the
 *     composer's natural height so the popup can hug the input row.
 *   - **Prefill IPC**: the Spotlight summon ships a ``{ text?, sourceApp? }``
 *     payload (selection capture or empty re-summon). We feed it into
 *     ChatSurface via the ``pendingPrompt`` capability, the same
 *     mechanism the main window uses for HomeView / Region Snip / URL
 *     handler hand-offs — no parallel composer-prefill code path.
 *
 * Every summon keeps the previous active session. The persistent New chat
 * action (and ⌘K) asks ChatSurface to run its own draft reset before
 * deselecting; the first turn after that auto-creates a fresh session row via
 * ``sessions.ensureActive()``. Quick-Ask conversations still appear in the
 * main window's history drawer alongside everything else.
 */
import { useSessions } from "@amiba/core";
import { useResolvedTheme } from "@amiba/ui";
import { ChatSurface } from "@amiba/ui";
import { cn } from "@amiba/ui";
import type { PendingPromptResult, ChatSurfaceCapabilities } from "@amiba/ui";
import { useT } from "@amiba/i18n";
import { getPlatform } from "@amiba/platform";
import { ArrowUpRight, SquarePen } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ElectronChatEngineClient } from "../chat/electron-engine-client";
import {
  resolveQuickAskCardLayout,
  resolveQuickAskSurfaceLayout,
} from "../../shared/quick-ask-layout";

type QuickAskPrefill = { text?: string; sourceApp?: string };

/** Shadow-safe room inside the transparent BrowserWindow stage. */
const SHADOW_GUTTER_X_PX = 16;

export function QuickAskView() {
  // Each BrowserWindow is its own renderer process, so the theme hook
  // must run here too — without it the dark BrowserWindow background
  // bleeds through any transparent area while the card paints with
  // light-theme tokens.
  useResolvedTheme();
  const sessions = useSessions();
  const { t } = useT();
  const client = useMemo(() => new ElectronChatEngineClient(), []);
  const bridge = useMemo(() => window.amiba, []);
  const openExternal = useCallback(
    (url: string) => getPlatform().shell.openExternal(url),
    [],
  );

  const rootRef = useRef<HTMLDivElement | null>(null);
  // Single-slot prefill queue. The IPC handler writes here, the
  // pendingPrompt capability drains it on next effect tick. Stored in a
  // ref so updates don't re-render — ChatSurface pulls via subscribe.
  const prefillRef = useRef<PendingPromptResult | null>(null);
  const prefillSubscribersRef = useRef<Set<() => void>>(new Set());

  const hasActive = !!sessions.activeId;
  // True while any composer-owned menu/dialog is open. Detection remains
  // document-wide so slash/@ surfaces and any future portals share Escape.
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [pickerRefreshKey, setPickerRefreshKey] = useState(0);
  const [composerHeight, setComposerHeight] = useState(0);
  const [newConversationRequestKey, setNewConversationRequestKey] =
    useState(0);
  // Expand as soon as the session id exists. Waiting for the first message
  // creates an intermediate compact frame where ChatSurface has already
  // switched to conversation mode but the outer card has not caught up.
  const conversationExpanded = hasActive;
  const fillCard = conversationExpanded;
  const cardLayout = resolveQuickAskCardLayout(fillCard, composerHeight);
  const handleComposerHeightChange = useCallback((height: number) => {
    setComposerHeight((current) => (current === height ? current : height));
  }, []);
  const requestNewConversation = useCallback(() => {
    setNewConversationRequestKey((current) => current + 1);
  }, []);

  // Pending-prompt capability — bridges the Quick-Ask IPC prefill payload
  // into ChatSurface's standard ``capabilities.pendingPrompt`` slot.
  // ChatSurface's existing drain effect handles the rest: it seeds the
  // composer, populates attachments, sets the source-app chip, and (when
  // text is present) marks the turn for auto-send.
  const capabilities = useMemo<ChatSurfaceCapabilities>(
    () => ({
      pendingPrompt: {
        drain: async () => {
          const payload = prefillRef.current;
          prefillRef.current = null;
          return payload;
        },
        subscribe: (onChanged: () => void) => {
          prefillSubscribersRef.current.add(onChanged);
          return () => {
            prefillSubscribersRef.current.delete(onChanged);
          };
        },
      },
    }),
    [],
  );

  // Prefill IPC. The previous active session is preserved across
  // summons (A+D); prefill payload just gets queued for ChatSurface's
  // ``pendingPrompt`` drain, which seeds the composer regardless of
  // whether there's a continuing thread or we're on an empty surface.
  useEffect(() => {
    const off = bridge.quickAsk.onPrefill((raw: unknown) => {
      const payload = (raw ?? {}) as QuickAskPrefill;
      const text = payload.text?.trim()
        ? payload.text.replace(/\s+$/, "")
        : undefined;
      const sourceApp = payload.sourceApp?.trim()
        ? payload.sourceApp
        : undefined;
      prefillRef.current = text || sourceApp ? { text, sourceApp } : null;
      // This renderer is created while hidden, before the backplane is always
      // ready. Refresh model/Profile state on each real summon so a transient
      // mount-time failure never becomes the visible Quick Ask state.
      setPickerRefreshKey((current) => current + 1);
      // Notify ChatSurface's drain subscription so it re-pulls even
      // when the active id didn't change (consecutive empty re-summons,
      // or summon while the same session is still active).
      for (const cb of prefillSubscribersRef.current) cb();
      // Re-focus the composer — when the BrowserWindow is hidden the
      // OS clears focus, and ``autoFocus`` on Composer only fires once
      // on mount. Defer to the next frame so any prefill text just
      // pushed into the composer has been written before we land the
      // caret. ``querySelector`` is fine here: the popup only ever
      // contains the one Composer textarea.
      requestAnimationFrame(() => {
        const ta = rootRef.current?.querySelector("textarea");
        if (ta) {
          ta.focus();
          // Move the caret to the end so prefill text doesn't get
          // overwritten by the user's first keystroke.
          const end = ta.value.length;
          ta.setSelectionRange(end, end);
        }
      });
    });
    return () => off();
  }, [bridge]);

  // Esc → dismiss the window. ⌘K / Ctrl+K asks ChatSurface to clear the
  // persistent draft and then deselect the current session.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Composer-owned menus/dialogs consume the first Escape. A second
        // Escape, once the overlay has closed, dismisses Quick Ask itself.
        if (overlayOpen) return;
        e.preventDefault();
        void bridge.quickAsk.dismiss();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        requestNewConversation();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [bridge, overlayOpen, requestNewConversation]);

  // A shared data attribute makes every current and future picker follow the
  // same Escape and hit-testing contract without coupling this shell to each
  // picker implementation.
  useEffect(() => {
    const sync = () =>
      setOverlayOpen(
        !!document.querySelector(
          '[data-ui-overlay="dialog"], [data-ui-overlay="popover"], [data-composer-overlay]',
        ),
      );
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    sync();
    return () => observer.disconnect();
  }, []);

  // Empty Quick Ask always uses the same transparent modal stage. Opening
  // model/Profile/approval changes only overlay DOM — never the window height
  // or composer layout. A real conversation remains the sole reason to switch
  // to the taller chat window.
  useLayoutEffect(() => {
    const layout = resolveQuickAskSurfaceLayout(conversationExpanded);
    void bridge.quickAsk.resize(layout.height, layout.anchor);
  }, [conversationExpanded, bridge]);

  // The fixed stage is intentionally much taller than the visible card.
  // Make its fully transparent pixels click-through while keeping the card
  // and any open modal interactive. `forward: true` in main keeps mousemove
  // events flowing so the window can become interactive again on re-entry.
  useEffect(() => {
    let lastIgnored: boolean | null = null;
    const syncHitTesting = (event: MouseEvent) => {
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const interactive = Boolean(
        hit?.closest(
          "[data-quick-ask-hit-area], [data-ui-overlay], [data-composer-overlay], [data-dialog-overlay]",
        ),
      );
      const ignore = !interactive;
      if (ignore === lastIgnored) return;
      lastIgnored = ignore;
      void bridge.quickAsk.setIgnoreMouseEvents(ignore);
    };
    document.addEventListener("mousemove", syncHitTesting);
    return () => {
      document.removeEventListener("mousemove", syncHitTesting);
      void bridge.quickAsk.setIgnoreMouseEvents(false);
    };
  }, [bridge]);

  return (
    <div
      ref={rootRef}
      className="relative mx-auto h-full w-full text-foreground"
    >
      <section
        data-quick-ask-hit-area=""
        className={cn(
          // One continuous surface owns the radius, edge and depth. Compact
          // mode keeps its Composer frameless; expanded mode restores the main
          // window Composer chrome so the working input has clear structure.
          "quick-ask-card absolute isolate flex min-h-0 flex-col rounded-[18px] border border-border/45 bg-background shadow-[0_12px_28px_-14px_rgb(0_0_0_/_0.28),0_3px_10px_-5px_rgb(0_0_0_/_0.16)] dark:shadow-[0_14px_34px_-15px_rgb(0_0_0_/_0.72),0_3px_12px_-5px_rgb(0_0_0_/_0.48)]",
          "overflow-visible transition-[height,top] duration-200 ease-out motion-reduce:transition-none",
          // Never clip here: the main-window Composer deliberately paints a
          // soft shadow beyond its frame. Its own scroll regions already own
          // their content clipping, while the action bar rounds its bottom.
        )}
        style={{
          left: `${SHADOW_GUTTER_X_PX}px`,
          right: `${SHADOW_GUTTER_X_PX}px`,
          top: `${cardLayout.top}px`,
          height: `${cardLayout.height}px`,
        }}
      >
        {/* The drag target overlays the card edge instead of consuming flex
            height. It must never push the Composer beyond the visible card. */}
        <div
          className="app-drag-region absolute inset-x-0 top-0 z-50 h-2"
          title="Drag to reposition"
          aria-hidden
        />

        {/* The card owns the available height in both modes. Keeping the
            surface full-height lets its persistent dock stay bottom-anchored
            while the card grows upward around multiline drafts. */}
        <ChatSurface
          variant="fullscreen"
          emptyState="composer-only"
          composerAutoFocus
          composerOnlyExpanded
          persistComposerAcrossModes
          composerDensity={fillCard ? "default" : "compact"}
          onComposerHeightChange={handleComposerHeightChange}
          composerPickerDialogSize="tall"
          composerPickerOverlayVariant="transparent"
          composerPickerRefreshKey={pickerRefreshKey}
          newConversationRequestKey={newConversationRequestKey}
          composerFrameClassName={
            fillCard
              ? undefined
              : "rounded-none border-0 bg-transparent shadow-none dark:shadow-none"
          }
          surfaceClassName={cn(
            "quick-ask-composer-motion bg-transparent",
            fillCard && "quick-ask-chat-surface",
          )}
          client={client}
          capabilities={capabilities}
          openSettings={() => {}}
          openAgentDestination={openExternal}
        />

        <QuickAskActionBar
          visible={fillCard}
          newConversationLabel={t("quickAsk.actions.newConversation")}
          openInMainLabel={t("quickAsk.actions.openInMain")}
          onNewConversation={requestNewConversation}
          onOpenInMain={() => {
            if (!sessions.activeId) return;
            void bridge.quickAsk.openInMain(sessions.activeId);
          }}
        />
      </section>
    </div>
  );
}

interface QuickAskActionBarProps {
  visible: boolean;
  newConversationLabel: string;
  openInMainLabel: string;
  onNewConversation: () => void;
  onOpenInMain: () => void;
}

function QuickAskActionBar({
  visible,
  newConversationLabel,
  openInMainLabel,
  onNewConversation,
  onOpenInMain,
}: QuickAskActionBarProps) {
  const actionClassName =
    "inline-flex h-5 items-center gap-1 px-1.5 text-[10px] font-normal text-muted-foreground/65 transition-colors duration-150 hover:text-foreground focus:outline-none focus-visible:text-foreground focus-visible:underline focus-visible:underline-offset-2";

  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "app-no-drag relative z-40 flex shrink-0 items-center justify-center gap-3 overflow-hidden bg-transparent px-2",
        "transition-[height,opacity] duration-200 ease-out motion-reduce:transition-none",
        visible ? "h-6 opacity-100" : "pointer-events-none h-0 opacity-0",
      )}
      data-quick-ask-action-bar=""
    >
      <button
        type="button"
        disabled={!visible}
        tabIndex={visible ? 0 : -1}
        onClick={onNewConversation}
        className={actionClassName}
      >
        <SquarePen className="h-2.5 w-2.5 shrink-0" />
        <span>{newConversationLabel}</span>
      </button>
      <button
        type="button"
        disabled={!visible}
        tabIndex={visible ? 0 : -1}
        onClick={onOpenInMain}
        className={actionClassName}
      >
        <ArrowUpRight className="h-2.5 w-2.5 shrink-0" />
        <span>{openInMainLabel}</span>
      </button>
    </div>
  );
}
