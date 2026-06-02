/**
 * Spotlight-style Quick-Ask popup.
 *
 * Architecturally this is *the same chat surface as the desktop main
 * window's right pane* — it mounts ``<SidePanelView />`` directly so
 * the conversation flow, composer, attachments, approvals, reasoning,
 * tool progress, etc. are guaranteed-identical to what the user sees
 * inside the main BrowserWindow. The only differences are:
 *
 *   - **Outer shell**: drag region, Esc-to-dismiss, ⌘K-new-conversation,
 *     and the window-resize coordination (compact → hugs the composer,
 *     expanded → snaps to ``EXPANDED_HEIGHT_PX`` so streaming chunks
 *     scroll inside the messages region without jittering the window).
 *   - **Empty state**: ``emptyState="composer-only"`` on SidePanelView
 *     skips the logo+greeting hero, flips ``quickActions={true}`` on the
 *     composer, and lets the body shrink to the composer's natural height
 *     so the popup can hug the input row.
 *   - **Prefill IPC**: the Spotlight summon ships a ``{ text?, sourceApp? }``
 *     payload (selection capture or empty re-summon). We feed it into
 *     SidePanelView via the ``pendingPrompt`` capability, the same
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
 * turn after that auto-creates a fresh session row via SidePanelView's
 * ``sessions.ensureActive()``. The session is tagged ``source="desktop"``
 * by the main-process chat engine, so Quick-Ask conversations show up in
 * the main window's history drawer alongside everything else.
 */
import { useSessions } from "@hermes-x/core"
import { useResolvedTheme } from "@hermes-x/ui"
import { SidePanelView } from "@hermes-x/ui"
import { cn } from "@hermes-x/ui"
import type {
  PendingPromptResult,
  SidePanelCapabilities,
} from "@hermes-x/ui"
import { useT } from "@hermes-x/i18n"
import { getPlatform } from "@hermes-x/platform"
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
 * show. Streaming content scrolls inside the SidePanelView's internal
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
  // ref so updates don't re-render — SidePanelView pulls via subscribe.
  const prefillRef = useRef<PendingPromptResult | null>(null)
  const prefillSubscribersRef = useRef<Set<() => void>>(new Set())

  const messages = sessions.activeMessages
  const hasActive = !!sessions.activeId
  // ``expanded`` flips the moment we have a session with content; until
  // then the window hugs the composer. The transition is smoothed by
  // macOS's animated setBounds in main/quick-ask-window.ts.
  const expanded = hasActive && messages.length > 0

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
  // into SidePanelView's standard ``capabilities.pendingPrompt`` slot.
  // SidePanelView's existing drain effect handles the rest: it seeds the
  // composer, populates attachments, sets the source-app chip, and (when
  // text is present) marks the turn for auto-send.
  const capabilities = useMemo<SidePanelCapabilities>(
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
  // summons (A+D); prefill payload just gets queued for SidePanelView's
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
      // Notify SidePanelView's drain subscription so it re-pulls even
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
    const el = rootRef.current
    if (!el) return
    let raf = 0
    let lastSent = -1
    const measure = () => {
      raf = 0
      if (!el) return
      const target = el.scrollHeight + 12
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
  }, [expanded, bridge])

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
        // ``h-full`` in expanded mode lets SidePanelView fill the entire
        // window. In compact mode the card is content-sized so the popup
        // hugs the input row. No CSS shadow — main/quick-ask-window.ts
        // sets ``hasShadow: true`` and macOS paints the shadow outside
        // the BrowserWindow where it can't be clipped at the edge.
        //
        // ``overflow-hidden`` clips the inner SidePanelView's
        // ``bg-background`` rectangle to the rounded shape — without it
        // the composer's square bottom edge paints over the outer
        // ``rounded-xl`` and the popup looks half-rounded.
        "animate-notifier-in relative mx-auto flex w-full max-w-[640px] flex-col overflow-hidden rounded-xl bg-background text-foreground",
        expanded && "h-full",
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

      <SidePanelView
        variant="fullscreen"
        emptyState="composer-only"
        composerAutoFocus
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
