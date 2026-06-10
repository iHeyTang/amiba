/**
 * Spotlight-style Quick-Ask popup.
 *
 * Architecturally this is *the same chat surface as the desktop main
 * window's right pane* — it mounts ``<ChatSurface />`` directly so
 * the conversation flow, composer, attachments, approvals, reasoning,
 * tool progress, etc. are guaranteed-identical to what the user sees
 * inside the main BrowserWindow. The only differences are:
 *
 *   - **Outer shell**: drag region, Esc-to-dismiss, ⌘K-new-conversation.
 *     Window geometry is fixed (full-display transparent stage); the card
 *     sizes itself via CSS — no resize IPC.
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
  useMemo,
  useRef,
  useState,
} from "react"

import { ElectronChatEngineClient } from "../chat/electron-engine-client"

type QuickAskPrefill = { text?: string; sourceApp?: string }

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

  // Modal dismiss: a mousedown anywhere on the transparent backdrop (i.e.
  // NOT on the card) closes the stage — the Spotlight/Raycast convention.
  // The card stops propagation so interacting with it never dismisses.
  // Electron transparent windows don't pass clicks through by default, so
  // the backdrop reliably receives this event.
  const onBackdropMouseDown = useCallback(() => {
    void bridge.quickAsk.dismiss()
  }, [bridge])

  return (
    <div
      ref={rootRef}
      onMouseDown={onBackdropMouseDown}
      // Full-window transparent backdrop. No dim/blur — the stage looks
      // like just a floating card, matching Spotlight/Raycast. Clicking
      // the blank area dismisses; the card below stops propagation.
      className="fixed inset-0 flex items-start justify-center"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          // The visible card. Centered horizontally, pushed down ~22vh so
          // there's headroom ABOVE for the slash/@ menu (TriggerMenu opens
          // upward via bottom-full) and a large area BELOW for downward
          // dropdowns/selects. CSS shadow (not native — transparent
          // windows don't get one; hasShadow is false).
          // overflow-hidden is NOT in the base string — in compact mode we
          // intentionally omit it so the slash/@ menu and other upward
          // popups can escape into the transparent stage; rounded corners
          // are preserved because ChatSurface's root div carries
          // rounded-xl when isComposerOnlyEmpty is true. In
          // expanded mode overflow-hidden is restored — popups already fit
          // inside the 480 px card and clipping keeps the corners clean.
          "animate-notifier-in mt-[22vh] flex w-full max-w-[640px] flex-col rounded-xl bg-background text-foreground shadow-2xl",
          // expanded → fixed height so ChatSurface fills it and streaming
          // scrolls INSIDE its own ScrollArea (no window resize, ever).
          // compact → hug the composer, capped so a stray tall empty state
          // can't run off-screen.
          expanded ? "h-[480px] overflow-hidden" : "max-h-[480px]",
        )}
      >
        {/*
          Invariant: `expanded` here and ChatSurface's `isComposerOnlyEmpty`
          are complements — when a turn exists, expanded=true and
          isComposerOnlyEmpty=false, so both sides restore overflow-hidden +
          flex-1 together. They derive from the same (hasActive, messages)
          signals, so they can't diverge; keep them in sync if either changes.
        */}
        <ChatSurface
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
              time: formatRelativeTime(
                activeSession?.updatedAt ?? Date.now(),
                t,
              ),
            })}
            newLabel={t("quickAsk.continuation.new")}
            dismissLabel={t("quickAsk.continuation.dismiss")}
            onNew={() => void sessions.deselect()}
            onDismiss={() => setHintDismissed(true)}
          />
        )}
      </div>
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
