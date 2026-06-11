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
 *     skips the logo+greeting hero, flips ``quickActions={true}`` on the
 *     composer, and lets the body shrink to the composer's natural height
 *     so the popup can hug the input row.
 *   - **Prefill IPC**: the Spotlight summon ships a ``{ text?, sourceApp? }``
 *     payload (selection capture or empty re-summon). We feed it into
 *     ChatSurface via the ``pendingPrompt`` capability, the same
 *     mechanism the main window uses for HomeView / Region Snip / URL
 *     handler hand-offs — no parallel composer-prefill code path.
 *
 * Session lifecycle (A+D design): every summon KEEPS the previous active
 * session — the user is more often returning to a thought than starting
 * a brand-new question, and Spotlight precedent (always-fresh) gets
 * frustrating in a conversational surface. When there's content to
 * resume, we surface an inline ``Continuing chat from N min ago · ⌘K
 * new`` strip above the messages so the state is explicit and a reset
 * is one keystroke away. ⌘K calls ``sessions.deselect()``; the first
 * turn after that auto-creates a fresh session row via ChatSurface's
 * ``sessions.ensureActive()``. The session is tagged ``source="desktop"``
 * by the main-process chat engine, so Quick-Ask conversations show up in
 * the main window's history drawer alongside everything else.
 */
import { useSessions } from "@amiba/core"
import { useResolvedTheme } from "@amiba/ui"
import { ChatSurface } from "@amiba/ui"
import { cn } from "@amiba/ui"
import type {
  PendingPromptResult,
  ChatSurfaceCapabilities,
} from "@amiba/ui"
import { useT } from "@amiba/i18n"
import { getPlatform } from "@amiba/platform"
import { Clock, X } from "lucide-react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { ElectronChatEngineClient } from "../chat/electron-engine-client"

type QuickAskPrefill = { text?: string; sourceApp?: string }

/**
 * Window height locked to as soon as the conversation has anything to
 * show. Streaming content scrolls inside the ChatSurface's internal
 * ScrollArea so the window itself never resizes during a stream —
 * eliminating per-chunk jitter.
 */
const EXPANDED_HEIGHT_PX = 480

export function QuickAskView() {
  // Each BrowserWindow is its own renderer process, so the theme hook
  // must run here too — without it the dark BrowserWindow background
  // bleeds through any transparent area while the card paints with
  // light-theme tokens.
  useResolvedTheme()
  const sessions = useSessions()
  const { t } = useT()
  const client = useMemo(() => new ElectronChatEngineClient(), [])
  const bridge = useMemo(() => window.hermes, [])
  const openExternal = useCallback(
    (url: string) => getPlatform().shell.openExternal(url),
    [],
  )

  const rootRef = useRef<HTMLDivElement | null>(null)
  // Single-slot prefill queue. The IPC handler writes here, the
  // pendingPrompt capability drains it on next effect tick. Stored in a
  // ref so updates don't re-render — ChatSurface pulls via subscribe.
  const prefillRef = useRef<PendingPromptResult | null>(null)
  const prefillSubscribersRef = useRef<Set<() => void>>(new Set())

  const messages = sessions.activeMessages
  const hasActive = !!sessions.activeId
  // True while a composer overlay (slash/@ TriggerMenu, tagged with
  // data-composer-overlay) is open. Drives expansion so the upward menu
  // has room. See the MutationObserver effect below.
  const [overlayOpen, setOverlayOpen] = useState(false)
  // Whether the composer has a draft (reported by ChatSurface via
  // onComposerEmptyChange). Keeps the popup expanded mid-compose.
  const [composerNonEmpty, setComposerNonEmpty] = useState(false)
  const onComposerEmptyChange = useCallback(
    (empty: boolean) => setComposerNonEmpty(!empty),
    [],
  )
  // Sticky expansion: an open overlay SETS it; it releases only once the
  // composer is empty AND no overlay is open — so dismissing the slash/@
  // menu while a draft remains keeps the expanded layout instead of
  // snapping back to compact.
  const [stuck, setStuck] = useState(false)
  // Collapse animation. `resizeQuickAsk` animates the window both ways,
  // but on collapse the compact layout reverts instantly — the composer
  // snaps from the bottom (expanded) to the top before the window finishes
  // shrinking, so the motion reads as "no animation". We hold the tall
  // layout (composer bottom-pinned + `h-full`) for the shrink's duration
  // so the composer rides UP with the window edge, symmetric with expand.
  const [collapsing, setCollapsing] = useState(false)
  // Last measured compact (content) height. Used as the collapse target
  // because while `collapsing` the layout is still tall — measuring
  // `rootRef` would return the window height, not the composer height.
  const compactHeightRef = useRef(84)
  const prevExpandedRef = useRef(false)
  // ``expanded`` flips the moment we have a session with content, OR
  // when a composer overlay (slash/@ TriggerMenu) is open — the upward
  // menu needs vertical room that the compact window doesn't have.
  // The transition is smoothed by macOS's animated setBounds in
  // main/quick-ask-window.ts.
  const expanded = (hasActive && messages.length > 0) || overlayOpen || stuck
  // Drives layout fill + composer bottom-pin: true while expanded AND
  // throughout the collapse animation.
  const tall = expanded || collapsing

  // Continuation hint state (A+D). Snapshotted ON summon so we can hide
  // the strip the moment the user actually sends a turn (message count
  // grows past the snapshot). Manual dismiss via X also flips
  // ``hintDismissed``. ⌘K → deselect makes ``hasActive`` false, the
  // render gate falls naturally — no extra wiring needed.
  const [summonMessageCount, setSummonMessageCount] = useState<number | null>(
    null,
  )
  const [hintDismissed, setHintDismissed] = useState(false)
  // ``messages.length`` read inside the long-lived onPrefill listener
  // would close over the initial render's empty array. The ref keeps the
  // current count visible without re-binding the listener on every
  // message update.
  const messageCountRef = useRef(messages.length)
  messageCountRef.current = messages.length

  // Pending-prompt capability — bridges the Quick-Ask IPC prefill payload
  // into ChatSurface's standard ``capabilities.pendingPrompt`` slot.
  // ChatSurface's existing drain effect handles the rest: it seeds the
  // composer, populates attachments, sets the source-app chip, and (when
  // text is present) marks the turn for auto-send.
  const capabilities = useMemo<ChatSurfaceCapabilities>(
    () => ({
      pendingPrompt: {
        drain: async () => {
          const payload = prefillRef.current
          prefillRef.current = null
          return payload
        },
        subscribe: (onChanged: () => void) => {
          prefillSubscribersRef.current.add(onChanged)
          return () => {
            prefillSubscribersRef.current.delete(onChanged)
          }
        },
      },
    }),
    [],
  )

  // Prefill IPC. The previous active session is preserved across
  // summons (A+D); prefill payload just gets queued for ChatSurface's
  // ``pendingPrompt`` drain, which seeds the composer regardless of
  // whether there's a continuing thread or we're on an empty surface.
  useEffect(() => {
    const off = bridge.quickAsk.onPrefill((raw: unknown) => {
      const payload = (raw ?? {}) as QuickAskPrefill
      const text = payload.text?.trim()
        ? payload.text.replace(/\s+$/, "")
        : undefined
      const sourceApp = payload.sourceApp?.trim()
        ? payload.sourceApp
        : undefined
      prefillRef.current = text || sourceApp ? { text, sourceApp } : null
      // Snapshot message count + un-dismiss the hint so a re-summon
      // re-surfaces "continuing chat from N min ago" — same window can
      // host many summons in a session.
      setSummonMessageCount(messageCountRef.current)
      setHintDismissed(false)
      // Notify ChatSurface's drain subscription so it re-pulls even
      // when the active id didn't change (consecutive empty re-summons,
      // or summon while the same session is still active).
      for (const cb of prefillSubscribersRef.current) cb()
      // Re-focus the composer — when the BrowserWindow is hidden the
      // OS clears focus, and ``autoFocus`` on Composer only fires once
      // on mount. Defer to the next frame so any prefill text just
      // pushed into the composer has been written before we land the
      // caret. ``querySelector`` is fine here: the popup only ever
      // contains the one Composer textarea.
      requestAnimationFrame(() => {
        const ta = rootRef.current?.querySelector("textarea")
        if (ta) {
          ta.focus()
          // Move the caret to the end so prefill text doesn't get
          // overwritten by the user's first keystroke.
          const end = ta.value.length
          ta.setSelectionRange(end, end)
        }
      })
    })
    return () => off()
  }, [bridge])

  // Esc → dismiss the window. ⌘K / Ctrl+K → start a new conversation
  // (deselect; the next submit auto-creates a fresh session row).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        void bridge.quickAsk.dismiss()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        void sessions.deselect()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [bridge, sessions])

  // Watch for a composer overlay (slash/@ TriggerMenu) opening inside the
  // popup. The menu opens upward and the compact window is too short for
  // it, so when one appears we flip `overlayOpen` → `expanded`, which
  // grows the window to EXPANDED_HEIGHT_PX and switches ChatSurface to the
  // bottom-pinned composer layout (room above for the menu). The overlay
  // is tagged with `data-composer-overlay`; any future composer popup that
  // wants this treatment can carry the same attribute.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const sync = () =>
      setOverlayOpen(!!el.querySelector("[data-composer-overlay]"))
    const observer = new MutationObserver(sync)
    observer.observe(el, { childList: true, subtree: true })
    sync()
    return () => observer.disconnect()
  }, [])

  // Sticky-expansion latch: an open overlay sets it; it releases only when
  // the composer is empty AND no overlay is open, so closing the menu with
  // a draft still present keeps the popup expanded.
  useEffect(() => {
    if (overlayOpen) setStuck(true)
    else if (!composerNonEmpty) setStuck(false)
  }, [overlayOpen, composerNonEmpty])

  // When we drop from expanded → compact, hold the tall layout for the
  // window-shrink animation (~macOS 200ms) so the collapse is animated:
  // the composer stays bottom-pinned and rides UP with the shrinking
  // window instead of snapping to the top.
  useEffect(() => {
    const wasExpanded = prevExpandedRef.current
    prevExpandedRef.current = expanded
    if (wasExpanded && !expanded) {
      setCollapsing(true)
      const t = setTimeout(() => setCollapsing(false), 260)
      return () => clearTimeout(t)
    }
  }, [expanded])

  // Window-resize strategy: same two-mode design the previous Quick-Ask
  // used. Compact mode follows the inner content height via
  // ResizeObserver (fires AFTER layout so the textarea's auto-grow is
  // captured accurately); expanded snaps once to EXPANDED_HEIGHT_PX so
  // streaming chunks never cause the window itself to resize.
  useLayoutEffect(() => {
    if (expanded) {
      void bridge.quickAsk.resize(EXPANDED_HEIGHT_PX)
      return
    }
    // Collapsing → animate down to the last measured compact height while
    // the layout is still tall (composer rides the shrinking window up).
    // Use the remembered height, not a fresh measure: the tall layout
    // would make rootRef report the window height, not the content.
    if (collapsing) {
      void bridge.quickAsk.resize(compactHeightRef.current)
      return
    }
    const el = rootRef.current
    if (!el) return
    let raf = 0
    let lastSent = -1
    const measure = () => {
      raf = 0
      if (!el) return
      const target = el.scrollHeight + 12
      compactHeightRef.current = target
      if (target === lastSent) return
      lastSent = target
      void bridge.quickAsk.resize(target)
    }
    const observer = new ResizeObserver(() => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    })
    observer.observe(el)
    // First fire — observers don't reliably callback on initial
    // observation in all browsers.
    measure()
    return () => {
      if (raf) cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [expanded, collapsing, bridge])

  // Resolve the active session's last-update timestamp for the
  // continuation hint. The sessions index is shared cross-window via
  // SessionDB so the desktop main window's edits propagate here too.
  const activeSession = hasActive
    ? sessions.sessions.find((s) => s.id === sessions.activeId)
    : undefined
  const showContinuationHint =
    !hintDismissed &&
    hasActive &&
    messages.length > 0 &&
    summonMessageCount !== null &&
    messages.length === summonMessageCount

  return (
    <div
      ref={rootRef}
      className={cn(
        // ``h-full`` in expanded mode lets ChatSurface fill the entire
        // window. In compact mode the card is content-sized so the popup
        // hugs the input row. No CSS shadow — main/quick-ask-window.ts
        // sets ``hasShadow: true`` and macOS paints the shadow outside
        // the BrowserWindow where it can't be clipped at the edge.
        //
        // ``overflow-hidden`` clips the inner ChatSurface's
        // ``bg-background`` rectangle to the rounded shape — without it
        // the composer's square bottom edge paints over the outer
        // ``rounded-xl`` and the popup looks half-rounded.
        "animate-notifier-in relative mx-auto flex w-full max-w-[640px] flex-col overflow-hidden rounded-xl bg-background text-foreground",
        tall && "h-full",
      )}
    >
      {/* Drag handle. Sits above all content so the user always has a
          predictable region to grab the borderless window from. The
          visible strip is only 12px so it reads as discreet chrome,
          but the ``after:`` pseudo-element extends the hit region 10px
          further down — invisibly — so the hover animation fires as
          the cursor *approaches* the grip rather than only on direct
          contact. The pseudo is part of the parent's box, so:
            · it inherits ``app-drag-region`` (more area to grab)
            · ``group-hover:`` on the grip glyph below picks up hover
              in the extended zone, since the parent IS the group
          On hover the grip widens + darkens — the iOS modal-grip
          convention, and the only visual feedback this borderless
          window has to communicate "you can drag me".
          The global CSS rule auto opts buttons/textareas out, so the
          chips and composer below are unaffected. */}
      <div
        className="app-drag-region group relative flex h-3 w-full shrink-0 items-center justify-center after:absolute after:inset-x-0 after:top-full after:h-2.5 after:content-['']"
        title="Drag to reposition"
      >
        <span
          aria-hidden
          className="h-0.5 w-8 rounded-full bg-border/70 transition-[width,background-color,opacity] duration-150 ease-out group-hover:w-12 group-hover:bg-foreground/40"
        />
      </div>

      <ChatSurface
        variant="fullscreen"
        emptyState="composer-only"
        composerAutoFocus
        composerOnlyExpanded={tall}
        onComposerEmptyChange={onComposerEmptyChange}
        client={client}
        capabilities={capabilities}
        openSettings={() => {}}
        openAgentDestination={openExternal}
      />

      {showContinuationHint && (
        <ContinuationHint
          label={t("quickAsk.continuation.label", {
            time: formatRelativeTime(activeSession?.updatedAt ?? Date.now(), t),
          })}
          newLabel={t("quickAsk.continuation.new")}
          dismissLabel={t("quickAsk.continuation.dismiss")}
          onNew={() => void sessions.deselect()}
          onDismiss={() => setHintDismissed(true)}
        />
      )}
    </div>
  )
}

interface ContinuationHintProps {
  label: string
  newLabel: string
  dismissLabel: string
  onNew: () => void
  onDismiss: () => void
}

function ContinuationHint({
  label,
  newLabel,
  dismissLabel,
  onNew,
  onDismiss,
}: ContinuationHintProps) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 pb-1.5 pl-3 pr-2 text-[10px] text-muted-foreground/80">
      <Clock className="h-2.5 w-2.5 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
      <span className="text-muted-foreground/50">·</span>
      <button
        type="button"
        onClick={onNew}
        className="rounded underline-offset-2 hover:text-foreground hover:underline"
      >
        {newLabel}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-auto shrink-0 rounded p-0.5 hover:bg-muted hover:text-foreground"
        aria-label={dismissLabel}
        title={dismissLabel}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}

/**
 * Relative-time formatter. Coarse buckets ("just now", "Nm ago",
 * "Nh ago", "Nd ago") using the same i18n keys the new-tab recents
 * list uses, so the strings stay consistent across surfaces.
 */
function formatRelativeTime(
  ms: number,
  t: ReturnType<typeof useT>["t"],
): string {
  const diffSec = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (diffSec < 60) return t("newtab.relative.justNow")
  if (diffSec < 3600) {
    return t("newtab.relative.mAgo", { n: Math.floor(diffSec / 60) })
  }
  if (diffSec < 86400) {
    return t("newtab.relative.hAgo", { n: Math.floor(diffSec / 3600) })
  }
  return t("newtab.relative.dAgo", { n: Math.floor(diffSec / 86400) })
}
