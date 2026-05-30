/**
 * Spotlight-style Quick-Ask popup.
 *
 * Built from the same primitives the main chat panel uses:
 *   - `<Composer />` (chat-ui) for the input — framed, focus-within
 *     accent ring, ArrowUp send button, IME-safe Enter handling.
 *   - `<Bubble />` (chat-ui) for the assistant response — Streamdown
 *     markdown, "Thinking…" placeholder, the same `chat-md` typography
 *     pass as a normal bubble.
 * Anything specific to the popup (sourceApp chip, keyboard hints, the
 * card outer shell) lives in this file.
 *
 * Talks to the same main-process chat engine the main window uses, via
 * the existing `window.hermes.chat` bridge. Main broadcasts events to
 * all renderers; we filter on our own session id so chatter from the
 * main chat surface (or vice versa) is ignored.
 *
 * Keyboard:
 *   - Enter         → submit
 *   - Shift+Enter   → newline
 *   - Esc           → dismiss (hide window)
 *   - Cmd/Ctrl+K    → new conversation
 */
import {
  DEFAULT_HERMES_MODEL,
  formatFileAttachmentsForPrompt,
  type ChatMessage,
  type EngineToClientMessage,
} from "@hermes-x/core"
import {
  Composer,
  MessageTurns,
  useComposerAttachments,
  type ComposerHandle,
  type UiMessage,
} from "@hermes-x/chat-ui"
import { useT } from "@hermes-x/i18n"
import { useResolvedTheme } from "@hermes-x/theme"
import { cn } from "@hermes-x/utils"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

type QuickAskPrefill = { text?: string; sourceApp?: string }

/**
 * Window height we lock to as soon as the conversation has anything
 * to show (busy / response / error / userTurn). Streaming content
 * scrolls inside the response area's `max-h-[420px] overflow-y-auto`
 * cap so the window itself never resizes during a stream.
 */
const EXPANDED_HEIGHT_PX = 480

function shortId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

export function QuickAskView() {
  // Apply user's theme preference (light / dark / auto) to <html>.
  // Without this the renderer would default to light theme — the dark
  // BrowserWindow background then shows through transparent body
  // areas, but the card uses light-theme tokens and looks wrong.
  useResolvedTheme()
  const { t } = useT()
  // Per-session state — a fresh session id every time the user clears
  // or the window is re-summoned with a new prefill. The main-process
  // engine keys streams by sessionId, so reusing one across two
  // unrelated quick-asks would tangle events.
  const [sessionId, setSessionId] = useState<string>(() => shortId("qa"))
  // Attachment state — full picker / chip / paste / upload pipeline,
  // same hook the main panel uses. Scoped to the popup's ephemeral
  // session id so the backplane writes uploads into a popup-private
  // directory and they survive at least until the popup is dismissed.
  const att = useComposerAttachments({
    getSessionId: () => sessionId,
  })
  const [input, setInput] = useState("")
  const [sourceApp, setSourceApp] = useState<string>("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Full conversation thread for this Quick-Ask session. We keep ALL
  // turns visible — every Q&A inside one summon belongs to the same
  // ephemeral session, and hiding earlier turns made multi-turn
  // exchanges read like an amnesia bug. Cleared by `newConversation`.
  const [messages, setMessages] = useState<UiMessage[]>([])

  // Mirror of `messages` in raw `ChatMessage` form for the engine's
  // `history` payload. Maintained alongside the React state because
  // SidePanelView's engine submit expects `ChatMessage[]`, not
  // `UiMessage[]`.
  const historyRef = useRef<ChatMessage[]>([])
  const composerRef = useRef<ComposerHandle | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  // uiId of the in-flight assistant message — chunks find it and
  // append. Cleared once the stream finishes (or aborts / errors).
  const streamingAssistantIdRef = useRef<string>("")
  // Stable ref to the attachment hook so the document-level paste
  // listener doesn't have to re-subscribe on every render (att is a
  // new object each render — re-subscribing would cause a brief gap
  // where pastes could slip through unbound).
  const attRef = useRef(att)
  attRef.current = att

  const bridge = useMemo(() => window.hermes, [])

  const newConversation = useCallback(() => {
    setSessionId(shortId("qa"))
    setInput("")
    setError(null)
    setBusy(false)
    setSourceApp("")
    setMessages([])
    historyRef.current = []
    streamingAssistantIdRef.current = ""
    // Drop any attachments queued for the previous conversation —
    // they're scoped to the old session id on disk.
    att.clearAttachments()
    att.setAttachmentError(null)
  }, [att])

  // Listen for prefill from main. Every summon resets the popup back
  // to a clean conversation — we don't auto-capture selection or
  // clipboard anymore, so the prefill is always empty in practice.
  // The IPC still drives the reset + focus so re-summons feel like a
  // fresh launch.
  useEffect(() => {
    const off = bridge.quickAsk.onPrefill((raw: unknown) => {
      const payload = (raw ?? {}) as QuickAskPrefill
      newConversation()
      if (payload.text && payload.text.trim()) {
        // Trim trailing whitespace so a selection-style prefill that
        // ended on a newline doesn't balloon the textarea via auto-grow.
        setInput(payload.text.replace(/\s+$/, ""))
      }
      if (payload.sourceApp) setSourceApp(payload.sourceApp)
      requestAnimationFrame(() => {
        composerRef.current?.focus()
        composerRef.current?.select()
      })
    })
    return () => off()
  }, [bridge, newConversation])

  // Subscribe once to chat events from main. The engine broadcasts to
  // all windows; we filter by sessionId so chatter from the main chat
  // surface (or vice versa) doesn't leak into the popup.
  useEffect(() => {
    const off = bridge.chat.onMessage((msg: EngineToClientMessage) => {
      if (msg.type !== "event") return
      if (msg.sessionId !== sessionId) return
      const e = msg.event
      const streamingId = streamingAssistantIdRef.current
      switch (e.kind) {
        case "chunk": {
          // Append delta to the in-flight assistant message in place
          // so React only re-renders the bubble that's growing.
          if (!streamingId) return
          setMessages((prev) =>
            prev.map((m) =>
              m.uiId === streamingId
                ? { ...m, content: m.content + e.text }
                : m,
            ),
          )
          return
        }
        case "done": {
          setBusy(false)
          if (streamingId) {
            // Mark streaming as finished + lift the final text into
            // history so the next turn's request includes it as
            // prior context.
            let finalText = ""
            setMessages((prev) => {
              const out = prev.map((m) => {
                if (m.uiId !== streamingId) return m
                finalText = m.content
                return { ...m, streaming: false }
              })
              return out
            })
            // Defer the history push to a microtask so the closure
            // sees the post-setState `finalText`.
            queueMicrotask(() => {
              if (finalText) {
                historyRef.current.push({
                  role: "assistant",
                  content: finalText,
                })
              }
            })
          }
          streamingAssistantIdRef.current = ""
          return
        }
        case "aborted": {
          setBusy(false)
          if (streamingId) {
            setMessages((prev) =>
              prev.map((m) =>
                m.uiId === streamingId ? { ...m, streaming: false } : m,
              ),
            )
          }
          streamingAssistantIdRef.current = ""
          return
        }
        case "error":
          setError(e.message || "Request failed.")
          setBusy(false)
          if (streamingId) {
            setMessages((prev) =>
              prev.map((m) =>
                m.uiId === streamingId ? { ...m, streaming: false } : m,
              ),
            )
          }
          streamingAssistantIdRef.current = ""
          return
        default:
          return
      }
    })
    return () => off()
  }, [bridge, sessionId])

  // Window-resize strategy: two modes, deterministic, no jitter.
  //
  //   - **Compact** (no conversation yet): follow the natural root
  //     content height via `ResizeObserver` so the textarea's auto-grow
  //     is mirrored by a smooth window resize. We deliberately use the
  //     observer (rather than a state-deps useEffect + rAF) because the
  //     observer fires AFTER layout commits — earlier the popup would
  //     measure mid-render, get a too-small `scrollHeight`, and stick
  //     at that height until the next state change happened to
  //     re-trigger the effect.
  //
  //   - **Expanded** (busy / response / error / userTurn present):
  //     snap to a fixed roomy height (`EXPANDED_HEIGHT_PX`) ONCE. The
  //     response area scrolls internally inside `max-h-[420px]
  //     overflow-y-auto`, so streaming chunks never trigger another
  //     resize — eliminating the per-chunk window jitter the previous
  //     implementation suffered from.
  //
  // The single visible transition (compact → expanded on submit, or
  // expanded → compact on new conversation) is smoothed by macOS's
  // animated `setBounds` in `main/quick-ask-window.ts`.
  const expanded = busy || messages.length > 0 || !!error
  useLayoutEffect(() => {
    if (expanded) {
      bridge.quickAsk.resize(EXPANDED_HEIGHT_PX)
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
      bridge.quickAsk.resize(target)
    }
    const observer = new ResizeObserver(() => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    })
    observer.observe(el)
    // Initial fire — the observer doesn't reliably callback on its very
    // first observation in all browsers.
    measure()
    return () => {
      if (raf) cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [expanded, bridge])

  const submit = useCallback(
    async (overrideText?: string) => {
      // Quick-action chips submit a templated prompt rather than the
      // raw composer text — `overrideText` lets the caller pass it in
      // directly. When omitted, we use the live composer value as before.
      const rawText = (overrideText ?? input).trim()
      // Tolerate attachment-only sends: an image with no question is
      // still a valid turn ("explain this screenshot"). Wait if any
      // attachment is still uploading though — otherwise the file path
      // wouldn't be included in the rendered <file-attachment> block.
      if (att.attachmentUploading) return
      const readyAttachments = att.attachments.filter(
        (a) => a.path && !a.uploading,
      )
      if (!rawText && readyAttachments.length === 0) return
      if (busy) return

      // Format attachments into a `<file-attachment>` block appended to
      // the user message — same wire format every other surface uses
      // so the agent's tools handle it identically.
      const attBlock = formatFileAttachmentsForPrompt(readyAttachments)
      const text = attBlock ? `${attBlock}\n\n${rawText}` : rawText

      setError(null)
      setBusy(true)
      // Append both bubbles to the visible thread. The user bubble
      // shows only the human-typed text — the `<file-attachment>`
      // block (in `text`) is agent-facing detail we don't surface in
      // UI. The assistant bubble starts empty and fills as chunks
      // stream; chunks find it by `streamingAssistantIdRef`.
      const userUiId = shortId("u")
      const assistantUiId = shortId("a")
      streamingAssistantIdRef.current = assistantUiId
      historyRef.current.push({ role: "user", content: text })
      setMessages((prev) => [
        ...prev,
        {
          uiId: userUiId,
          role: "user",
          content: rawText || "(attachment)",
        },
        {
          uiId: assistantUiId,
          role: "assistant",
          content: "",
          streaming: true,
        },
      ])
      setInput("")
      // Attachments belong to this turn — drop them from the composer
      // state so the next turn starts fresh. The on-disk files stay
      // around so the agent's vision/read tools can fetch them.
      att.setAttachments((prev) =>
        prev.filter((a) => !readyAttachments.some((r) => r.uiId === a.uiId)),
      )
      try {
        await bridge.chat.send({ type: "subscribe", sessionId })
        await bridge.chat.send({
          type: "submit",
          payload: {
            sessionId,
            assistantUiId,
            model: DEFAULT_HERMES_MODEL,
            history: historyRef.current.slice(),
          },
        })
      } catch (e) {
        setBusy(false)
        setError(String((e as Error)?.message || e))
      }
    },
    [att, bridge, busy, input, sessionId],
  )

  // Quick-action chip click is owned by Composer — when a chip fires
  // it calls our `onSubmit(expandedPrompt)`. No more per-surface
  // template handling.

  const abort = useCallback(async () => {
    try {
      await bridge.chat.send({ type: "abort", sessionId })
    } catch {
      // best-effort
    }
  }, [bridge, sessionId])

  const dismiss = useCallback(() => {
    void abort()
    void bridge.quickAsk.dismiss()
  }, [abort, bridge])

  // Document-level paste safety net. Composer wires `onPaste` on its
  // own textarea, but in this NSPanel the paste event sometimes
  // targets `document.body` (or skips the textarea entirely) — for
  // instance right after summon when focus is still settling, or when
  // the source-app chip / drag region briefly steals key focus. The
  // document listener catches paste events anywhere in the popup and
  // routes file payloads through `att.addFiles`, matching what every
  // other surface does.
  //
  // `attRef` keeps the closure stable across re-renders so we register
  // once. The handler skips when Composer's onPaste already called
  // `preventDefault()` (its `handlePaste` does so right before adding
  // the same files), avoiding duplicate chips.
  useEffect(() => {
    const handler = async (e: ClipboardEvent) => {
      if (e.defaultPrevented) return
      const items = e.clipboardData?.items
      if (!items || items.length === 0) return
      const files: File[] = []
      for (let i = 0; i < items.length; i += 1) {
        const it = items[i]
        if (it.kind === "file") {
          const f = it.getAsFile()
          if (f) files.push(f)
        }
      }
      if (files.length === 0) return
      e.preventDefault()
      try {
        await attRef.current.addFiles(files)
      } catch (err) {
        console.warn("[quick-ask] document paste attach failed:", err)
      }
    }
    document.addEventListener("paste", handler)
    return () => document.removeEventListener("paste", handler)
  }, [])

  // Auto-scroll the message list to the bottom whenever new content
  // streams in. Watches `messages` (any append / chunk-driven content
  // change) and `error` so the user always sees the latest line.
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = scrollAreaRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, error])

  return (
    <div
      ref={rootRef}
      className={cn(
        // `h-full` in expanded mode makes the card fill the entire
        // window — the window edge IS the card edge. Composer sticks
        // to the bottom (last flex-col child after a `flex-1` scroll
        // area), so chat history grows upward and scrolls cleanly when
        // it overflows. In compact mode (no conversation yet) the card
        // is content-sized so the popup hugs the input + chips.
        //
        // No `shadow-2xl` on the React tree — the BrowserWindow has
        // `hasShadow: true`, so macOS paints the popup shadow OUTSIDE
        // the window where it can't get clipped at the window edge.
        // Doing it in CSS here used to render a visible strip at the
        // bottom (shadow trying to extend beyond the window bounds).
        "animate-notifier-in relative mx-auto flex w-full max-w-[640px] flex-col rounded-xl bg-background px-2 pb-2 text-foreground",
        expanded && "h-full",
      )}
    >
      {/* Minimal 4px top strip — no traffic-light buttons on this
          window so we don't need any chrome breathing room. When the
          "selected from" chip is visible, the strip + chip row form
          one larger drag target. globals.css opts buttons/textareas/
          inputs out of drag, so there's no risk of breaking clicks
          below.
          Drag-to-attach + drop overlay live INSIDE Composer's wrapper
          (`attachments={att}` registers them) — popping them up here
          too would double-fire `addFiles` on drops over the composer. */}
      <div className="app-drag-region h-1 w-full shrink-0" title="Drag to reposition" />

      {sourceApp && (
        <div
          className="app-drag-region mt-1 flex shrink-0 items-center gap-1 px-1 text-[11px] text-muted-foreground"
          title="Drag to reposition"
        >
          <span>{t("quickAsk.selectionFrom")}</span>
          <span className="rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-foreground">
            {sourceApp}
          </span>
        </div>
      )}

      {/* Scrollable conversation area — flex-1 fills the gap between
          the (fixed-height) source-app chip above and the (fixed-
          height) Composer below. Uses the SAME `<MessageTurns>` the
          main panel renders for its message list, so user-sticky
          behaviour + turn grouping + verbose blocks are all shared.
          Auto-scrolls to the bottom on every chunk via the effect
          below. */}
      {(messages.length > 0 || error) && (
        <div
          ref={scrollAreaRef}
          className="mt-1 min-h-0 flex-1 space-y-2 overflow-y-auto px-1"
        >
          <MessageTurns messages={messages} showStreamDetails={false} />
          {error && (
            <div className="px-1 py-1 text-sm text-destructive">{error}</div>
          )}
        </div>
      )}

      <div className="mt-1 shrink-0">
      <Composer
        ref={composerRef}
        value={input}
        onChange={setInput}
        onSubmit={(override) => void submit(override)}
        busy={busy}
        onAbort={() => void abort()}
        canSubmit={
          (!!input.trim() || att.hasReadyAttachment()) &&
          !att.attachmentUploading &&
          !att.attachmentBusy
        }
        attachments={att}
        quickActions={!expanded}
        placeholder="Ask Hermes…"
        autoFocus
        maxTextareaPx={160}
        onKeyDownExtra={(e) => {
          if (e.key === "Escape") {
            e.preventDefault()
            dismiss()
            return true
          }
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
            e.preventDefault()
            newConversation()
            return true
          }
        }}
        kbdHints={[
          { keys: "⏎", label: t("quickAsk.kbd.ask") },
          { keys: "⇧⏎", label: t("quickAsk.kbd.newline") },
          { keys: "⌘K", label: t("quickAsk.kbd.new") },
          { keys: "esc", label: t("quickAsk.kbd.dismiss") },
        ]}
      />
      </div>
    </div>
  )
}
