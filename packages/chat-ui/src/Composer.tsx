import {
  renderQuickActionPrompt,
  useQuickActions,
  type ResolvedQuickAction,
} from "@hermes-x/core"
import { useT } from "@hermes-x/i18n"
import {
  Button,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@hermes-x/ui"
import { cn } from "@hermes-x/utils"
import { ArrowUp } from "lucide-react"

import { AttachmentChip } from "./bubble/chips"
import { ComposerKbdHints, type ComposerKbdHint } from "./Kbd"
import { QuickActionChips } from "./QuickActionChips"
import {
  AttachmentButton,
  type UseComposerAttachmentsResult,
} from "./useComposerAttachments"
import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ClipboardEventHandler,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react"

import { COMPOSER_TEXTAREA_MAX_PX } from "./internal/types"

/**
 * The chat surface's input box. **One implementation** used by every
 * surface (main panel `<SidePanelView />`, `<ChatView />`, the
 * Spotlight-style `<QuickAskView />` popup, anywhere else); the visual
 * identity lives here and only here.
 *
 * The component is closed for modification (frame styling, textarea
 * sizing, send-button states, IME-safe Enter handling, auto-grow) and
 * open for extension via slots:
 *
 *   - `topAffordance` — inside the frame, above the textarea (e.g. an
 *                       "editing queue item" hint).
 *   - `chipRow`       — inside the frame, between top affordance and
 *                       textarea (e.g. pinned-page + attachment chips).
 *   - `actionsLeft`   — inside the frame's bottom action row, left side
 *                       (paperclip, pin, brain-toggle, etc).
 *   - `extrasBelow`   — below the frame (keyboard hints, status pills).
 *   - `flatTop`       — remove the frame's top corner radius so a
 *                       sibling element rendered just above (a pending-
 *                       queue stack, an approval banner) merges visually.
 *
 * Anything that lives OUTSIDE the box — approval banners, pending-queue
 * stacks, drag-over drop overlays — is the caller's responsibility. The
 * Composer doesn't try to be a chat-panel-in-a-box; it's the typing
 * affordance, full stop.
 *
 * Send-button modes:
 *   - idle      → Send (default ArrowUp, disabled when `!canSubmit`)
 *   - busy      → Stop  (custom rounded-square glyph)
 *   - busy+can  → Send  (queue / send-after-current; same ArrowUp, but
 *                       calls `onSubmit` not `onAbort`).
 * The "send while busy" path is what SidePanelView uses for its queue
 * feature; surfaces that don't queue (Quick-Ask, ChatView) just leave
 * `canSubmit` false while busy and the button becomes Stop naturally.
 */
export interface ComposerHandle {
  focus(): void
  select(): void
  /** Imperative access to the underlying textarea, for callers that need
   *  things like `selectionStart` for paste-time logic. */
  getTextarea(): HTMLTextAreaElement | null
}

interface SendButtonRenderCtx {
  /** What the caller's effective submit handler is. Defaults to `onSubmit`. */
  onSubmit(): void
  /** What the caller's effective abort handler is. Defaults to `onAbort`. */
  onAbort(): void
  busy: boolean
  canSubmit: boolean
  busyQueueable: boolean
  disabled: boolean
}

export interface ComposerProps {
  value: string
  onChange: (next: string) => void
  /**
   * Called when the user submits a turn. Composer passes an optional
   * `overrideText` when the source is something other than the live
   * composer value (e.g. a quick-action chip click that produced an
   * expanded prompt — Composer renders the template against the live
   * input internally and hands you the final string). For the normal
   * Enter / send-button path, `overrideText` is undefined and you
   * read `value` like before.
   */
  onSubmit: (overrideText?: string) => void
  /** True while the engine is streaming. Flips the send button to stop. */
  busy?: boolean
  onAbort?: () => void

  /**
   * Whether the current composer state can submit a turn. Defaults to
   * `!!value.trim()`. Callers with attachments / page-context flows
   * override (e.g. `value.trim() || hasReadyAttachments`).
   */
  canSubmit?: boolean

  /**
   * When true AND `busy`, the send button stays in "Send" mode and a
   * click queues the next turn instead of aborting. SidePanelView uses
   * this for its multi-turn queue; surfaces without a queue concept
   * leave this false (default) so busy state always means "Stop".
   */
  busyQueueable?: boolean

  /** Disable the whole composer (textarea + buttons). */
  disabled?: boolean

  // Textarea
  placeholder?: string
  /** Initial rows. Default 2 — matches the main panel composer. */
  rows?: number
  autoFocus?: boolean
  /** Max height before the textarea starts scrolling instead of growing. */
  maxTextareaPx?: number
  /** Inline style override on the textarea (e.g. `maxHeight`). */
  textareaStyle?: CSSProperties
  /**
   * Extra key handler — runs BEFORE the default Enter-to-submit logic.
   * Return `true` to swallow the event (skip the default handling).
   * Returning nothing lets the default kick in.
   */
  onKeyDownExtra?: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean | void
  /** Pass-through paste handler (used for image / file paste). */
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>

  // ---------------------------------------------------------------------
  // Built-in affordances. These render in fixed, surface-agnostic
  // positions so the same things ALWAYS look the same place on every
  // surface that uses Composer. Pass nothing to opt out.
  // ---------------------------------------------------------------------
  /**
   * Pass the result of `useComposerAttachments(...)` to enable the
   * full attachment flow (paperclip in bottom action row + chip row
   * above textarea + paste handler + drop handlers on the wrapper).
   * Composer wires all of it internally — surfaces don't decide where
   * any of those pieces render.
   */
  attachments?: UseComposerAttachmentsResult
  /**
   * Quick-action chips (translate / summarize / polish / explain +
   * customs) rendered in the bottom action row between the attachment
   * button and the send button. Auto-loads via `useQuickActions(t)`
   * unless this is set to `false`. Set to `false` for surfaces where
   * quick actions don't make sense (rare).
   */
  quickActions?: boolean

  // ---------------------------------------------------------------------
  // Surface-specific slots — fall back to these only when something
  // genuinely surface-specific needs to fit in the composer. Anything
  // common (paperclip, chips, hints) is built-in above.
  // ---------------------------------------------------------------------
  /** Outside the frame, above it. Used by ChatView for bridge status,
   *  page-context chips, etc. that don't visually merge with the frame. */
  extrasAbove?: ReactNode
  /** Inside the frame, above the chip row + textarea. */
  topAffordance?: ReactNode
  /**
   * Extra chips to render alongside the auto-attached attachment chip
   * row. Surfaces with pinned pages / page context use this. The
   * attachment chips ALWAYS render first; this slot appears after.
   */
  chipRow?: ReactNode
  /**
   * Extra buttons appended to the bottom action row, between the
   * built-in attachment button and the quick-action chips. Used for
   * surface-specific toggles (pin current tab, brain / stream-details
   * toggle, navigate-open-policy toggle). Common affordances should
   * NEVER live here — they belong in the built-in section above.
   */
  actionsLeft?: ReactNode
  /** Outside the frame, below it (caption / hints). */
  extrasBelow?: ReactNode

  // Frame
  /** Remove the frame's top-left/right radius. Use when a sibling above
   *  (queue stack, banner) needs to visually merge with the frame. */
  flatTop?: boolean
  /** Wrapper className override (margins / drag-over ring). */
  className?: string
  /** Frame className override (rare; for unusual surfaces). */
  frameClassName?: string

  // Send-button customization
  /** Tooltip heading + aria for idle send. */
  sendTitle?: string
  /** Tooltip heading + aria for "send while busy" (queue) variant. */
  sendQueueTitle?: string
  /** Tooltip heading + aria for stop. */
  stopTitle?: string
  /**
   * Keyboard hints rendered inside the send-button hover tooltip
   * (rich popover instead of the native `title` yellow box). When
   * omitted the button falls back to a plain `title=` attribute, so
   * surfaces that don't want a tooltip just leave this unset.
   */
  kbdHints?: ComposerKbdHint[]
  /**
   * Full override of the send/stop button. Receives the resolved
   * handlers + state so the override can preserve behaviour. Rarely
   * needed; prefer `sendTitle` / `sendQueueTitle` / `stopTitle`.
   */
  renderSendButton?: (ctx: SendButtonRenderCtx) => ReactNode

  /** Pass-through DOM attributes on the OUTER wrapper (drag handlers). */
  wrapperProps?: React.HTMLAttributes<HTMLDivElement>
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(
  function Composer(
    {
      value,
      onChange,
      onSubmit,
      busy = false,
      onAbort,
      canSubmit,
      busyQueueable = false,
      disabled = false,
      placeholder = "Send a message…",
      rows = 2,
      autoFocus = false,
      maxTextareaPx = COMPOSER_TEXTAREA_MAX_PX,
      textareaStyle,
      onKeyDownExtra,
      onPaste,
      attachments,
      quickActions = true,
      extrasAbove,
      topAffordance,
      chipRow,
      actionsLeft,
      extrasBelow,
      flatTop = false,
      className,
      frameClassName,
      sendTitle,
      sendQueueTitle,
      stopTitle = "Stop",
      kbdHints,
      renderSendButton,
      wrapperProps,
    },
    ref,
  ) {
    const taRef = useRef<HTMLTextAreaElement>(null)

    useImperativeHandle(
      ref,
      (): ComposerHandle => ({
        focus: () => taRef.current?.focus(),
        select: () => taRef.current?.select(),
        getTextarea: () => taRef.current,
      }),
      [],
    )

    // Default canSubmit if not provided.
    const effectiveCanSubmit =
      canSubmit !== undefined ? canSubmit : !!value.trim()

    // Auto-grow up to `maxTextareaPx`; switch to scroll past that.
    useLayoutEffect(() => {
      const el = taRef.current
      if (!el) return
      el.style.height = "auto"
      const sh = el.scrollHeight
      const next = Math.min(sh, maxTextareaPx)
      el.style.height = `${next}px`
      el.style.overflowY = sh > maxTextareaPx ? "auto" : "hidden"
    }, [value, maxTextareaPx])

    function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
      if (onKeyDownExtra) {
        const swallow = onKeyDownExtra(e)
        if (swallow === true) return
        if (e.defaultPrevented) return
      }
      // Ignore Enter while an IME is composing — the user may press
      // Enter to commit Latin/pinyin, not to send.
      const ne = e.nativeEvent as KeyboardEvent["nativeEvent"] & {
        isComposing?: boolean
      }
      if (ne.isComposing || e.key === "Process") return
      const isSendChord =
        (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ||
        (e.key === "Enter" && !e.shiftKey && !e.altKey)
      if (!isSendChord) return
      e.preventDefault()
      if (disabled) return
      if (busy && !busyQueueable) return
      if (!effectiveCanSubmit) return
      onSubmit()
    }

    function handleSendClick() {
      if (disabled) return
      if (busy) {
        if (busyQueueable) {
          if (!effectiveCanSubmit) return
          onSubmit()
          return
        }
        onAbort?.()
        return
      }
      if (!effectiveCanSubmit) return
      onSubmit()
    }

    // Resolve which heading the tooltip / aria should use given the
    // current send-button state. `busy + !busyQueueable` is the stop
    // variant; everything else is the send / queue variant.
    const isStopState = busy && !busyQueueable
    const buttonHeading = isStopState
      ? stopTitle
      : busy
        ? sendQueueTitle ?? sendTitle ?? "Queue"
        : sendTitle ?? "Send"

    const rawSendButton = renderSendButton ? (
      renderSendButton({
        onSubmit: handleSendClick,
        onAbort: () => onAbort?.(),
        busy,
        canSubmit: effectiveCanSubmit,
        busyQueueable,
        disabled,
      })
    ) : isStopState ? (
      /* Stop variant — custom rounded-square glyph; avoids the lucide
         `Square` icon's heavy stroke at this size reading as "minimize". */
      <Button
        type="button"
        size="icon"
        onClick={handleSendClick}
        disabled={disabled}
        // Native title fallback used only when no rich tooltip below
        // wraps this button (i.e. `kbdHints` is unset).
        title={kbdHints ? undefined : buttonHeading}
        aria-label={buttonHeading}
        className="h-6 w-6 shrink-0 rounded-full"
      >
        <span
          aria-hidden
          className="block h-2 w-2 rounded-[1.5px] bg-current"
        />
      </Button>
    ) : (
      <Button
        type="button"
        size="icon"
        onClick={handleSendClick}
        disabled={disabled || !effectiveCanSubmit}
        title={kbdHints ? undefined : buttonHeading}
        aria-label={buttonHeading}
        className="h-6 w-6 shrink-0 rounded-full [&_svg]:size-3"
      >
        <ArrowUp strokeWidth={3} />
      </Button>
    )

    // Rich hover tooltip — heading + the same `<ComposerKbdHints>` row
    // we used to render under the textarea. `delayDuration={250}` is
    // brisk enough to feel responsive but long enough that pointer
    // fly-bys don't pop the tooltip. Wrap only when the caller actually
    // passed hints; otherwise fall through to the bare button (with
    // its native `title`).
    const sendButtonNode = kbdHints ? (
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <TooltipTrigger asChild>{rawSendButton}</TooltipTrigger>
          <TooltipContent side="top" align="end" className="flex flex-col gap-1">
            <span className="font-medium">{buttonHeading}</span>
            {!isStopState && (
              <ComposerKbdHints
                className="text-popover-foreground/70"
                hints={kbdHints}
              />
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ) : (
      rawSendButton
    )

    // Compose paste handler: surface-provided onPaste is honoured
    // first, then the attachment hook's handler runs to capture
    // pasted files. Wrapping at the Composer level means no surface
    // needs to remember to wire it.
    const handlePaste = (
      e: import("react").ClipboardEvent<HTMLTextAreaElement>,
    ) => {
      if (onPaste) onPaste(e)
      if (e.defaultPrevented) return
      attachments?.handlePaste(e)
    }

    // Built-in attachment chip strip merged with the optional `chipRow`
    // slot from the surface (e.g. pinned page chips). Attachment chips
    // ALWAYS render first so the order is consistent across surfaces.
    const attachmentChips = attachments?.attachments ?? []
    const renderedChipRow =
      attachmentChips.length > 0 || chipRow ? (
        <div className="flex flex-wrap items-center gap-1 border-b border-border/50 px-2 py-1.5">
          {attachmentChips.map((a) => (
            <AttachmentChip
              key={a.uiId}
              attachment={a}
              onRemove={() => attachments?.removeAttachment(a.uiId)}
            />
          ))}
          {chipRow}
        </div>
      ) : null

    return (
      <div
        {...wrapperProps}
        // Drop handlers from the attachment hook are merged with any
        // wrapperProps the surface passed (rare). This way the wrapper
        // is the single place the popup grows a drag-over ring + drop
        // overlay — no per-surface boilerplate.
        onDragOver={(e) => {
          wrapperProps?.onDragOver?.(e)
          attachments?.dropHandlers.onDragOver(e)
        }}
        onDragLeave={(e) => {
          wrapperProps?.onDragLeave?.(e)
          attachments?.dropHandlers.onDragLeave(e)
        }}
        onDrop={(e) => {
          wrapperProps?.onDrop?.(e)
          attachments?.dropHandlers.onDrop(e)
        }}
        className={cn(
          "relative flex w-full flex-col",
          attachments?.dragOver && "rounded-lg ring-2 ring-primary/30",
          className,
          wrapperProps?.className,
        )}
      >
        {extrasAbove}
        <div
          className={cn(
            "relative flex flex-col rounded-lg border border-input bg-background shadow-sm transition-colors focus-within:border-ring/25",
            flatTop && "rounded-t-none",
            frameClassName,
          )}
        >
          {topAffordance}
          {renderedChipRow}
          <Textarea
            ref={taRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            rows={rows}
            autoFocus={autoFocus}
            disabled={disabled}
            style={{ maxHeight: maxTextareaPx, ...textareaStyle }}
            className="min-h-9 resize-none overflow-hidden border-0 bg-transparent px-3 py-2 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
              {/*
                Order of items in the bottom action row — same on EVERY
                surface that uses Composer:
                  1. attachment paperclip (auto-rendered when attachments prop set)
                  2. surface-specific extras (actionsLeft slot)
                  3. quick-action chip strip (auto-loaded)
              */}
              {attachments ? (
                <AttachmentButton
                  onClick={() => void attachments.openFilePicker()}
                  disabled={
                    attachments.attachmentBusy ||
                    attachments.attachmentUploading
                  }
                />
              ) : null}
              {actionsLeft}
              {quickActions ? (
                <ComposerQuickActions
                  value={value}
                  busy={busy}
                  disabled={disabled}
                  onSubmit={onSubmit}
                />
              ) : null}
            </div>
            {sendButtonNode}
          </div>
        </div>
        {/* Hidden fallback file input. Renders once at the bottom of
            the wrapper so the picker click-fallback path works on
            browsers without `showOpenFilePicker`. */}
        {attachments ? <input {...attachments.fileInputProps} /> : null}
        {extrasBelow ? (
          <div className="px-1 pt-1 text-xs text-muted-foreground">
            {extrasBelow}
          </div>
        ) : null}
      </div>
    )
  },
)

/**
 * Quick-action chip strip rendered inside Composer's bottom action
 * row. Loads the user's persisted action list via `useQuickActions`
 * and expands template + composer text into the final prompt on chip
 * click, then calls Composer's `onSubmit(prompt)`. Surfaces never see
 * the template-expansion step — they receive ready-to-send text.
 */
function ComposerQuickActions({
  value,
  busy,
  disabled,
  onSubmit,
}: {
  value: string
  busy?: boolean
  disabled?: boolean
  onSubmit: (overrideText?: string) => void
}) {
  const { t } = useT()
  const { actions } = useQuickActions(t)
  if (actions.length === 0) return null
  const trimmed = value.trim()
  const canApply = !busy && !disabled && !!trimmed
  const handle = (action: ResolvedQuickAction) => {
    if (!canApply) return
    onSubmit(renderQuickActionPrompt(action.template, trimmed))
  }
  return (
    <QuickActionChips
      actions={actions}
      canApply={canApply}
      onApply={handle}
      className="ml-0.5"
    />
  )
}
