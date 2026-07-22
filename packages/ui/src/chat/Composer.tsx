import {
  renderQuickActionPrompt,
  useQuickActions,
  type ResolvedQuickAction,
} from "@amiba/core"
import { useT } from "@amiba/i18n"
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../primitives"
import { cn } from "../primitives"
import { ArrowUp } from "lucide-react"

import { AttachmentChip } from "./bubble/chips"
import {
  RichComposerEditor,
  type RichComposerHandle,
} from "./composer/RichComposerEditor"
import { ComposerKbdHints, type ComposerKbdHint } from "./Kbd"
import { QuickActionChips } from "./QuickActionChips"
import {
  AttachmentButton,
  type UseComposerAttachmentsResult,
} from "./useComposerAttachments"
import { MicrophoneButton } from "./useVoiceRecorder"
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ClipboardEventHandler,
  type CSSProperties,
  type ReactNode,
} from "react"

import { COMPOSER_TEXTAREA_MAX_PX } from "./internal/types"
import { buildProviderRegistry } from "./composer/providers/registry"
import { loadMentionResourceProviders } from "./composer/providers/mention-resources"
import { expandMentions } from "./composer/expandMentions"
import { routeSubmit } from "./composer/command-routing"
import type { SlashUiActionContext } from "./composer/providers/slash-ui-actions"
import type { TriggerProvider } from "./composer/providers/types"

/**
 * The chat surface's input box. **One implementation** used by every
 * surface (main panel `<ChatSurface />`, `<ChatView />`, the
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
 *                       (paperclip, pin, etc).
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
 * Send-button modes (driven entirely by `busy` + `canSubmit` — no surface
 * needs to opt into queue behaviour explicitly):
 *   - !busy + !canSubmit → ArrowUp, disabled.
 *   - !busy +  canSubmit → ArrowUp, click sends (`onSubmit`).
 *   -  busy + !canSubmit → Stop glyph, click aborts (`onAbort`).
 *   -  busy +  canSubmit → ArrowUp, click queues (`onSubmit`; the parent
 *                          decides whether to enqueue or no-op).
 * Surfaces without a queue concept just early-return inside their
 * `onSubmit` when `busy` is true (HomeView, ChatView do this implicitly);
 * surfaces with a queue (ChatSurface) push to their FIFO.
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

  /** Disable the whole composer (textarea + buttons). */
  disabled?: boolean

  // Textarea
  /**
   * Static text, or a typewriter cycle. When the `typewriter` array is
   * passed, the placeholder cycles through the entries by typing them
   * out one character at a time, holding, deleting, advancing. Set
   * `active: false` (or let it default — Composer pauses automatically
   * when the user has typed anything or while `busy`) to freeze the
   * animation. Respects `prefers-reduced-motion`.
   */
  placeholder?: string | { typewriter: string[]; active?: boolean }
  /**
   * Initial rows. Kept for back-compat with existing consumers, but no
   * longer applied: the Lexical editor auto-grows from a min height, so
   * an initial `rows` count has no effect.
   */
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
  onKeyDownExtra?: (e: KeyboardEvent) => boolean | void
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
   * Voice input affordance. When set, a microphone button renders next
   * to the paperclip; click toggles record/stop. The Composer owns
   * nothing else — the surface drives MediaRecorder + STT, then writes
   * the transcript back via `onChange`. Leave undefined to hide.
   */
  microphone?: {
    recording: boolean
    onToggle: () => void
    /**
     * Audio capture has stopped and we're round-tripping to STT. The
     * button swaps the mic glyph for a spinner so the wait reads as
     * deliberate work rather than a frozen control.
     */
    transcribing?: boolean
    /** Force-disable independent of transcribing (rare). */
    disabled?: boolean
  }
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
   * surface-specific toggles (pin current tab, stream-details toggle,
   * navigate-open-policy toggle). Common affordances should
   * NEVER live here — they belong in the built-in section above.
   */
  actionsLeft?: ReactNode
  /** Outside the frame, below it (caption / hints). */
  extrasBelow?: ReactNode

  // Frame
  /**
   * Visual identity of the frame:
   *   - "default" (the chat surface, Quick-Ask, ChatView): a compact,
   *     borderless rounded-2xl surface over solid bg-background.
   *   - "hero" (homepage empty state): a borderless glass surface — 24px
   *     radius, translucent bg-card, soft elevation, larger
   *     textarea padding. Use when the composer is the focal point of
   *     the page rather than a tool bar at the bottom.
   */
  frameVariant?: "default" | "hero"
  /** Remove the frame's top-left/right radius. Use when a sibling above
   *  (queue stack, banner) needs to visually merge with the frame. */
  flatTop?: boolean
  /** Wrapper className override (margins / drag-over ring). */
  className?: string
  /** Frame className override (rare; for unusual surfaces). */
  frameClassName?: string
  /**
   * Custom node rendered as a full-cover overlay while a file is being
   * dragged over the wrapper (only fires when `attachments` is set, so
   * the wrapper actually listens for drops). Default: nothing — the
   * wrapper just grows a primary-tinted ring. Pass a string or rich
   * node for surfaces that want explicit "Drop files to attach" copy.
   */
  dropOverlay?: ReactNode

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

  /**
   * Extra @ / slash trigger providers, merged with the built-in registry
   * (skills @-mentions + slash commands). Passed through to
   * RichComposerEditor (so the trigger menu sees them) and used at
   * send-time to expand `@[...]` tokens into their serialized text.
   */
  mentionProviders?: TriggerProvider[]
  /**
   * Host-wired handlers for slash commands that map to a native UI action
   * (e.g. `/config` → open settings) instead of being sent as text. When a
   * matching handler is present the command is performed and NOT sent;
   * otherwise it falls through to a normal send.
   */
  slashUiActions?: SlashUiActionContext
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
      disabled = false,
      placeholder = "Send a message…",
      // `rows` stays in the public ComposerProps for the 5 consumers, but
      // RichComposerEditor auto-grows and has no rows attr, so we no longer
      // read it here (sizing is driven by min-height classes + AutoGrowPlugin).
      autoFocus = false,
      maxTextareaPx = COMPOSER_TEXTAREA_MAX_PX,
      textareaStyle,
      onKeyDownExtra,
      onPaste,
      attachments,
      microphone,
      quickActions = true,
      extrasAbove,
      topAffordance,
      chipRow,
      actionsLeft,
      extrasBelow,
      frameVariant = "default",
      flatTop = false,
      className,
      frameClassName,
      dropOverlay,
      sendTitle,
      sendQueueTitle,
      stopTitle = "Stop",
      kbdHints,
      renderSendButton,
      wrapperProps,
      mentionProviders,
      slashUiActions,
    },
    ref,
  ) {
    const innerRef = useRef<RichComposerHandle>(null)

    // Backplane-contributed mention resources (e.g. lark.doc/chat/user) become
    // generic @-providers, fetched once from GET /hermes/mention-resources.
    // Empty until the fetch resolves (and stays empty if the backplane is
    // down) — the composer degrades to its built-in + injected providers.
    const [dynamicMentionProviders, setDynamicMentionProviders] = useState<
      TriggerProvider[]
    >([])
    useEffect(() => {
      let alive = true
      loadMentionResourceProviders()
        .then((ps) => {
          if (alive) setDynamicMentionProviders(ps)
        })
        .catch(() => {})
      return () => {
        alive = false
      }
    }, [])

    // The single mention-provider source: backplane-dynamic first, then any
    // host-injected ones (Files on desktop, Page-context on the extension).
    // Threaded to BOTH the trigger menu (via RichComposerEditor) and the
    // send-time `@[...]` expansion registry, so the two never diverge.
    const effectiveMentionProviders = useMemo(
      () => [...dynamicMentionProviders, ...(mentionProviders ?? [])],
      [dynamicMentionProviders, mentionProviders],
    )

    // Active provider list (built-in @ skills + / commands, plus the resolved
    // mention providers). Used both for the trigger menu and send-time
    // `@[...]` expansion.
    const providerRegistry = useMemo(
      () => buildProviderRegistry(effectiveMentionProviders),
      [effectiveMentionProviders],
    )

    // Single normal-send path. Slash UI-action commands with a wired handler
    // are performed and NOT sent; everything else expands `@[...]` mention
    // tokens to text (a no-op for plain messages) and submits. Abort / stop /
    // queue branches do NOT route through here.
    const handleSend = useCallback(
      (overrideText?: string) => {
        const text = overrideText ?? value
        if (routeSubmit(text, { send: () => {}, ctx: slashUiActions ?? {} }))
          return // UI action handled, don't send
        const finalText = expandMentions(text, providerRegistry.all)
        onSubmit(finalText)
      },
      [value, slashUiActions, providerRegistry, onSubmit],
    )

    useImperativeHandle(
      ref,
      (): ComposerHandle => ({
        focus: () => innerRef.current?.focus(),
        select: () => innerRef.current?.select(),
        getTextarea: () => innerRef.current?.getTextarea() ?? null,
      }),
      [],
    )

    // Default canSubmit if not provided.
    const effectiveCanSubmit =
      canSubmit !== undefined ? canSubmit : !!value.trim()

    // Resolve placeholder. String form is verbatim; typewriter form runs
    // the cycling effect (pausing automatically as soon as the user types
    // or while ``busy``, so the animation doesn't fight live input).
    // Narrow via a typed alias so the field reads below survive the
    // less-aggressive narrowing under non-strict tsconfigs (extension app).
    const placeholderObj =
      typeof placeholder === "object" && placeholder !== null
        ? placeholder
        : null
    const typewriterExamples = placeholderObj?.typewriter ?? null
    const typewriterActive = placeholderObj
      ? (placeholderObj.active ?? (!value && !busy))
      : false
    const typewriterText = useTypewriterPlaceholder(
      typewriterExamples,
      typewriterActive,
    )
    const resolvedPlaceholder: string =
      typeof placeholder === "string" ? placeholder : typewriterText

    // Auto-grow + IME-safe Enter/Shift+Enter handling now live inside
    // RichComposerEditor (AutoGrowPlugin / ImeEnterPlugin). The old
    // textarea `useLayoutEffect` and `handleKeyDown` are gone.

    // `autoFocus` used to be a textarea attribute; RichComposerEditor has
    // no such attr, so we focus its Lexical editor imperatively on mount.
    useEffect(() => {
      if (autoFocus) innerRef.current?.focus()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    function handleSendClick() {
      if (disabled) return
      if (busy) {
        if (effectiveCanSubmit) {
          // Queue branch — route through handleSend so @[...] mentions are
          // expanded before the parent enqueues the message.
          handleSend()
          return
        }
        // Abort branch — untouched.
        onAbort?.()
        return
      }
      if (!effectiveCanSubmit) return
      // Normal send — route through handleSend (slash routing + @ expansion).
      handleSend()
    }

    // Resolve which heading the tooltip / aria should use given the
    // current send-button state. `busy + !canSubmit` is the stop
    // variant; everything else is the send / queue variant.
    const isStopState = busy && !effectiveCanSubmit
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
        className={cn(
          "shrink-0 rounded-full",
          frameVariant === "hero" ? "h-7 w-7" : "h-6 w-6",
        )}
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
        className={cn(
          "shrink-0 rounded-full",
          frameVariant === "hero"
            ? "h-7 w-7 [&_svg]:size-3.5"
            : "h-6 w-6 [&_svg]:size-3",
        )}
      >
        <ArrowUp strokeWidth={frameVariant === "hero" ? 2.5 : 3} />
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
        <div
          className={cn(
            "flex flex-wrap items-center gap-1 border-b py-1.5",
            frameVariant === "hero"
              ? "border-foreground/5 px-3"
              : "border-border/50 px-2",
          )}
        >
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
          attachments?.dragOver &&
            (frameVariant === "hero" ? "rounded-[24px]" : "rounded-2xl"),
          attachments?.dragOver && "ring-2 ring-primary/30",
          flatTop && attachments?.dragOver && "rounded-t-none",
          className,
          wrapperProps?.className,
        )}
      >
        {extrasAbove}
        <div
          className={cn(
            "relative flex flex-col transition-colors",
            frameVariant === "hero"
              ? // Hero: a borderless glass surface. A diffuse ambient shadow
                // describes the shape without drawing a hard outline.
                // Used by the
                // homepage empty state where the composer is THE focal
                // point of the page.
                "rounded-[24px] bg-card/85 shadow-[0_12px_34px_-20px_rgb(0_0_0_/_0.2)] backdrop-blur-2xl dark:shadow-[0_12px_34px_-20px_rgb(0_0_0_/_0.6)]"
              : // Default: the same borderless treatment at a tighter scale.
                // Shallow ambient depth keeps it legible on the chat surface.
                "rounded-2xl bg-background shadow-[0_8px_24px_-16px_rgb(0_0_0_/_0.22)] dark:shadow-[0_8px_24px_-16px_rgb(0_0_0_/_0.56)]",
            flatTop && "rounded-t-none",
            frameClassName,
          )}
        >
          {attachments?.dragOver && dropOverlay ? (
            <div
              className={cn(
                "pointer-events-none absolute inset-0 z-[9] flex items-center justify-center bg-primary/5 text-sm font-medium text-primary",
                frameVariant === "hero" ? "rounded-[24px]" : "rounded-2xl",
                flatTop && "rounded-t-none",
              )}
            >
              {dropOverlay}
            </div>
          ) : null}
          {topAffordance}
          {renderedChipRow}
          <RichComposerEditor
            ref={innerRef}
            value={value}
            onChange={onChange}
            placeholder={resolvedPlaceholder}
            disabled={disabled}
            maxHeightPx={maxTextareaPx}
            style={textareaStyle}
            onSubmitChord={() => {
              if (disabled) return
              if (!effectiveCanSubmit) return
              handleSend()
            }}
            mentionProviders={effectiveMentionProviders}
            onKeyDownExtra={onKeyDownExtra}
            onPaste={handlePaste}
            className={cn(
              frameVariant === "hero"
                ? "min-h-[3.5rem] px-5 pb-1 pt-3.5"
                : "min-h-9 px-3 py-2",
            )}
          />
          <div
            className={cn(
              "flex items-center justify-between gap-2 pb-2",
              frameVariant === "hero" ? "px-3 pt-0.5" : "px-2",
            )}
          >
            <div
              className={cn(
                "flex min-w-0 flex-1 items-center text-muted-foreground",
                frameVariant === "hero"
                  ? "gap-1.5"
                  : "flex-wrap gap-x-1.5 gap-y-1 text-[11px]",
              )}
            >
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
                  // Quick-action chips are a normal-send path: route through
                  // handleSend so the expanded prompt gets @ expansion / slash
                  // routing like any other send.
                  onSubmit={handleSend}
                  // Hero mode lets the chip row absorb the leftover space
                  // so the send button hugs the right edge; default mode
                  // sits inline next to actionsLeft.
                  className={frameVariant === "hero" ? "flex-1" : "ml-0.5"}
                />
              ) : null}
            </div>
            {/* Mic sits next to the send button — speech-to-text is the
                output-side affordance, not an attachment. Grouping it on
                the right keeps the left rail consistent across surfaces. */}
            {microphone ? (
              <MicrophoneButton
                recording={microphone.recording}
                transcribing={microphone.transcribing}
                onClick={microphone.onToggle}
                disabled={microphone.disabled}
              />
            ) : null}
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
  className,
}: {
  value: string
  busy?: boolean
  disabled?: boolean
  onSubmit: (overrideText?: string) => void
  className?: string
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
      className={className ?? "ml-0.5"}
    />
  )
}

/**
 * Cycles through `examples`, typing each one character-by-character,
 * holding for a beat, then deleting and advancing to the next. Pauses
 * when `active` is false; respects `prefers-reduced-motion` by showing
 * the first example statically and skipping the animation loop.
 *
 * Ported from the homepage's bespoke ComposerCard so every Composer
 * surface can opt in via `placeholder={{ typewriter: [...] }}`.
 */
function useTypewriterPlaceholder(
  examples: string[] | null,
  active: boolean,
): string {
  const [output, setOutput] = useState("")
  const stateRef = useRef<{
    idx: number
    charIdx: number
    phase: "typing" | "holding" | "deleting"
  }>({ idx: 0, charIdx: 0, phase: "typing" })

  useEffect(() => {
    if (!examples || examples.length === 0) {
      setOutput("")
      return
    }

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    if (reducedMotion) {
      setOutput(examples[0] ?? "")
      return
    }

    if (!active) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    function tick() {
      if (cancelled || !examples) return
      const { idx, charIdx, phase } = stateRef.current
      const current = examples[idx] ?? ""

      if (phase === "typing") {
        if (charIdx < current.length) {
          stateRef.current = { idx, charIdx: charIdx + 1, phase }
          setOutput(current.slice(0, charIdx + 1))
          timer = setTimeout(tick, 55 + Math.random() * 50)
        } else {
          stateRef.current = { idx, charIdx, phase: "holding" }
          timer = setTimeout(tick, 1800)
        }
      } else if (phase === "holding") {
        stateRef.current = { idx, charIdx, phase: "deleting" }
        timer = setTimeout(tick, 0)
      } else {
        if (charIdx > 0) {
          stateRef.current = { idx, charIdx: charIdx - 1, phase }
          setOutput(current.slice(0, charIdx - 1))
          timer = setTimeout(tick, 22)
        } else {
          stateRef.current = {
            idx: (idx + 1) % examples.length,
            charIdx: 0,
            phase: "typing",
          }
          timer = setTimeout(tick, 250)
        }
      }
    }

    tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [active, examples])

  return output
}
