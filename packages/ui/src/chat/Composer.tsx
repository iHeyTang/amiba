import { commandImages } from "./composer/command-attachments";
import { ComposerAccessory } from "../primitives/empty-state-visual";
import { useT } from "@amiba/i18n";
import { Paperclip } from "lucide-react";
import { ComposerAddMenuContext } from "./composer/ComposerAddMenuContext";
import type { MenuItem } from "./composer/providers/types";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  type DialogOverlayVariant,
} from "../primitives";
import { cn } from "../primitives";
import { ArrowUp } from "lucide-react";

import { AttachmentChip } from "./bubble/chips";
import {
  RichComposerEditor,
  type RichComposerHandle,
} from "./composer/RichComposerEditor";
import { ComposerKbdHints, type ComposerKbdHint } from "./Kbd";
import {
  AttachmentButton,
  type UseComposerAttachmentsResult,
} from "./useComposerAttachments";
import { ComposerAgentPicker } from "./ComposerAgentPicker";
import { ComposerApprovalModePicker } from "./ComposerApprovalModePicker";
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
} from "react";

import { COMPOSER_TEXTAREA_MAX_PX } from "./internal/types";
import { buildProviderRegistry } from "./composer/providers/registry";
import { expandMentionsAsync } from "./composer/expandMentions";
import { routeSubmit } from "./composer/command-routing";
import { useComposerTriggers } from "./composer/triggers/session";
import type { ComposerTriggerRuntime } from "./composer/triggers/contracts";
import type { SlashUiActionContext } from "./composer/providers/slash-ui-actions";
import type { TriggerProvider } from "./composer/providers/types";
import type { AgentExecutionContext } from "@amiba/app-runtime/core";
import type { AgentModelSelection } from "@amiba/app-runtime/platform";
import type {
  AmibaComposerModelPickerOwner,
  ConversationInputModelOwnerProps,
  ConversationInputPlanOwnerProps,
} from "@amiba/extension-sdk";

/**
 * One model-picker dispatch request, computed by the Composer per render.
 * Two seats back the same chip position:
 *
 *   - `seat: "session"` — the composer has a session id: the OFFICIAL
 *     `conversation.input.model` seat (single, session scope, owner
 *     `{ locked }`). The occupant reads `sessionId` from the framework
 *     session kit and its engine data over the official wire; the seat
 *     renders nothing until the official current session catches up with a
 *     freshly minted draft (the shell's sessions bridge opens it once the
 *     DSH session materializes).
 *   - `seat: "hero"` — no session (home/draft composer): the vendor
 *     `amiba.composer.modelPicker` hero seat, whose owner carries the
 *     surface-held draft selection and picker chrome.
 */
export type ComposerModelPickerRequest =
  | { seat: "session"; owner: ConversationInputModelOwnerProps }
  | { seat: "hero"; owner: AmibaComposerModelPickerOwner };

/**
 * Renders the composer's model-picker chip from the seat request Composer
 * computes. The host builds this from the official DSH dispatch —
 * `renderSlot("conversation.input.model" | "amiba.composer.modelPicker",
 * request.owner)` — and threads it down; Composer itself has ZERO
 * model-plane knowledge.
 */
export type ComposerModelPickerRenderer = (
  request: ComposerModelPickerRequest,
) => ReactNode;

/**
 * Renders the composer's plan-status control from the official
 * `conversation.input.plan` seat (single, session scope, owner
 * `InputControlOwnerProps { locked }`). The host backs this with
 * `renderSlot("conversation.input.plan", owner)`; Composer computes only
 * `locked` — the same chrome disable state the model seat's owner share
 * carries — and owns nothing else about the affordance.
 *
 * The seat is UNOCCUPIED in Amiba today (the official ui-plan package is
 * disabled), and an unoccupied seat renders nothing at all: no placeholder,
 * no reserved space. Surfaces without a DSH plugin runtime (Quick-Ask) pass
 * no renderer and the same nothing renders.
 */
export type ComposerPlanSeatRenderer = (
  owner: ConversationInputPlanOwnerProps,
) => ReactNode;

/**
 * The chat surface's input box. **One implementation** used by every
 * surface (main panel `<ChatSurface />`, the
 * Spotlight-style `<QuickAskView />` popup, anywhere else); the visual
 * identity lives here and only here.
 *
 * The component is closed for modification (frame styling, textarea
 * sizing, send-button states, IME-safe Enter handling, auto-grow) and
 * open for extension via slots:
 *
 *   - `topAffordance` — inside the frame, above the textarea (e.g. an
 *                       "editing queue item" hint).
 *   - `contextRail`   — a shared workspace/queue/runtime shelf directly
 *                       above and visually behind the frame.
 *   - `chipRow`       — inside the frame, between top affordance and
 *                       textarea (e.g. pinned-page + attachment chips).
 *   - `actionsLeft`   — inside the frame's bottom action row, left side
 *                       (paperclip, pin, etc).
 *   - `extrasBelow`   — below the frame (keyboard hints, status pills).
 *   - `floatingNotice`— anchored below the frame without affecting layout.
 *   - `flatTop`       — remove the frame's top corner radius so a blocking
 *                       sibling banner rendered just above merges visually.
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
 * `onSubmit` when `busy` is true (HomeView does this implicitly);
 * surfaces with a queue (ChatSurface) push to their FIFO.
 */
export interface ComposerHandle {
  focus(): void;
  select(): void;
  /** Imperative access to the underlying textarea, for callers that need
   *  things like `selectionStart` for paste-time logic. */
  getTextarea(): HTMLTextAreaElement | null;
}

export type ComposerDensity = "default" | "compact";
export type ComposerPickerOverlayVariant = DialogOverlayVariant;

interface SendButtonRenderCtx {
  /** What the caller's effective submit handler is. Defaults to `onSubmit`. */
  onSubmit(): void;
  /** What the caller's effective abort handler is. Defaults to `onAbort`. */
  onAbort(): void;
  busy: boolean;
  canSubmit: boolean;
  disabled: boolean;
}

export interface ComposerProps {
  value: string;
  onChange: (next: string) => void;
  /**
   * Called when the user submits a turn. Composer expands mentions and
   * routes UI-only slash commands before handing the final text to the
   * surface.
   */
  onSubmit: (text: string) => void;
  /** True while the engine is streaming. Flips the send button to stop. */
  busy?: boolean;
  onAbort?: () => void;

  /**
   * Whether the current composer state can submit a turn. Defaults to
   * `!!value.trim()`. Callers with attachments / page-context flows
   * override (e.g. `value.trim() || hasReadyAttachments`).
   */
  canSubmit?: boolean;
  /** Re-evaluate admission for an imperative draft write before React commits. */
  canSubmitDraft?: (draft: string) => boolean;

  /** Disable the whole composer (textarea + buttons). */
  disabled?: boolean;

  // Textarea
  /**
   * Static text, or a typewriter cycle. When the `typewriter` array is
   * passed, the placeholder cycles through the entries by typing them
   * out one character at a time, holding, deleting, advancing. Set
   * `active: false` (or let it default — Composer pauses automatically
   * when the user has typed anything or while `busy`) to freeze the
   * animation. Respects `prefers-reduced-motion`.
   */
  placeholder?: string | { typewriter: string[]; active?: boolean };
  /**
   * Initial rows. Kept for back-compat with existing consumers, but no
   * longer applied: the Lexical editor auto-grows from a min height, so
   * an initial `rows` count has no effect.
   */
  rows?: number;
  autoFocus?: boolean;
  /** Max height before the textarea starts scrolling instead of growing. */
  maxTextareaPx?: number;
  /** Inline style override on the textarea (e.g. `maxHeight`). */
  textareaStyle?: CSSProperties;
  /**
   * Extra key handler — runs BEFORE the default Enter-to-submit logic.
   * Return `true` to swallow the event (skip the default handling).
   * Returning nothing lets the default kick in.
   */
  onKeyDownExtra?: (e: KeyboardEvent) => boolean | void;
  /** Pass-through paste handler (used for image / file paste). */
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>;

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
  attachments?: UseComposerAttachmentsResult;
  /**
   * Show a compact DSH inference-model selector beside the send controls.
   * The picker NODE comes from `render` — the host's renderSlot-backed
   * dispatch of the seat Composer picks per render: the official
   * session-scoped `conversation.input.model` while `permissionSessionId`
   * is set (owner `{ locked }` — engine data is the occupant's own wire
   * concern), the vendor session-less `amiba.composer.modelPicker` hero
   * seat otherwise (owner carries the surface-held draft selection and
   * picker chrome). Surfaces without a DSH plugin runtime (Quick-Ask) pass
   * nothing and Composer renders nothing where the chip would sit.
   */
  modelPicker?: {
    render: ComposerModelPickerRenderer;
    draftSelection?: AgentModelSelection;
    onDraftSelectionChange?: (selection: AgentModelSelection) => void;
  };
  /** Show the active DSH permission preset as a switchable composer pill. */
  approvalModePicker?: boolean;
  /**
   * Occupant of the official `conversation.input.plan` seat, rendered in the
   * tool row immediately right of the access-mode control (the placement the
   * official contract names). The NODE comes from the host's
   * renderSlot-backed dispatch; Composer passes the owner share the contract
   * defines — `{ locked }`, the same chrome disable state the model seat
   * gets. Pass nothing (Quick-Ask, any surface outside a DSH plugin runtime)
   * and nothing renders where the control would sit; an empty seat renders
   * nothing either way, so the row keeps its exact layout until a plugin
   * takes the seat.
   */
  planSeat?: ComposerPlanSeatRenderer;
  /**
   * The official `conversation.input.overlay` seat (list, session scope, NO
   * owner share), already dispatched by the host —
   * `renderSlot("conversation.input.overlay", {})`. It renders as the LAST
   * child of the `[data-composer-card]` frame, a bare node with no wrapper:
   * every occupant positions itself against that card
   * (`position: absolute; bottom: calc(100% + 4px)`) and probes it with
   * `closest("[data-composer-card]")` to decide whether an outside
   * pointerdown dismisses it. An unoccupied seat is `undefined` here and
   * costs nothing — no box, no gap. Surfaces with no plugin runtime
   * (Quick-Ask) pass nothing and behave exactly as before.
   */
  inputOverlay?: ReactNode;
  /** Runtime session used to distinguish pinned permissions from new-task defaults. */
  permissionSessionId?: string;
  /** Visual treatment for the modal overlay behind model and Profile dialogs. */
  pickerOverlayVariant?: ComposerPickerOverlayVariant;
  /** Height treatment for model and Profile dialogs in constrained hosts. */
  pickerDialogSize?: "default" | "tall";
  /** Reload picker state when a persistent host is activated again. */
  pickerRefreshKey?: number;
  /**
   * Task-scoped DSH Agent Preset. Once a task has messages, callers lock
   * changes so execution and history keep using the same composition.
   */
  agentPicker?: {
    value: AgentExecutionContext;
    onChange: (next: AgentExecutionContext) => void;
    profileLocked?: boolean;
  };
  // ---------------------------------------------------------------------
  // Surface-specific slots — fall back to these only when something
  // genuinely surface-specific needs to fit in the composer. Anything
  // common (paperclip, chips, hints) is built-in above.
  // ---------------------------------------------------------------------
  /** Outside the frame, above it. Used for host-local notices. */
  extrasAbove?: ReactNode;
  /**
   * Execution context visually joined to the top of the composer. This is
   * intentionally distinct from `extrasAbove`: workspace/runtime belong to
   * the input's identity, while notices and bridge state remain separate.
   */
  contextRail?: ReactNode;
  /** Inside the frame, above the chip row + textarea. */
  topAffordance?: ReactNode;
  /**
   * Extra chips to render alongside the auto-attached attachment chip
   * row. Surfaces with pinned pages / page context use this. The
   * attachment chips ALWAYS render first; this slot appears after.
   */
  chipRow?: ReactNode;
  /**
   * Extra buttons appended to the bottom action row, between the
   * built-in attachment button and the quick-action chips. Used for
   * surface-specific toggles (pin current tab, stream-details toggle,
   * navigate-open-policy toggle). Common affordances should
   * NEVER live here — they belong in the built-in section above.
   */
  actionsLeft?: ReactNode;
  /** Outside the frame, below it (caption / hints). */
  extrasBelow?: ReactNode;
  /**
   * Transient notice anchored below the frame without participating in
   * layout. Use for recoverable composer-local failures whose diagnostics
   * must not move the writing surface.
   */
  floatingNotice?: ReactNode;

  // Frame
  /**
   * Visual identity of the frame:
   *   - "default" (the chat surface and Quick-Ask): a compact
   *     rounded-2xl surface with a quiet, focus-stable edge.
   *   - "hero" (homepage empty state): a softly edged glass surface — 24px
   *     radius, translucent bg-card, soft elevation, larger
   *     textarea padding. Use when the composer is the focal point of
   *     the page rather than a tool bar at the bottom.
   */
  frameVariant?: "default" | "hero";
  /**
   * Compact trims the editor and toolbar's vertical chrome for constrained
   * surfaces such as Quick Ask. It does not change control sizes or hit areas.
   */
  density?: ComposerDensity;
  /** Remove the frame's top-left/right radius. Use when a blocking sibling
   * banner needs to visually merge with the frame. Queue tabs belong in
   * `contextRail` instead. */
  flatTop?: boolean;
  /** Wrapper className override (margins / drag-over ring). */
  className?: string;
  /** Frame className override (rare; for unusual surfaces). */
  frameClassName?: string;
  /**
   * Custom node rendered as a full-cover overlay while a file is being
   * dragged over the wrapper (only fires when `attachments` is set, so
   * the wrapper actually listens for drops). Default: nothing — the
   * wrapper just grows a primary-tinted ring. Pass a string or rich
   * node for surfaces that want explicit "Drop files to attach" copy.
   */
  dropOverlay?: ReactNode;

  // Send-button customization
  /** Tooltip heading + aria for idle send. */
  sendTitle?: string;
  /** Tooltip heading + aria for "send while busy" (queue) variant. */
  sendQueueTitle?: string;
  /** Tooltip heading + aria for stop. */
  stopTitle?: string;
  /**
   * Keyboard hints rendered inside the send-button hover tooltip
   * (rich popover instead of the native `title` yellow box). When
   * omitted the button falls back to a plain `title=` attribute, so
   * surfaces that don't want a tooltip just leave this unset.
   */
  kbdHints?: ComposerKbdHint[];
  /**
   * Full override of the send/stop button. Receives the resolved
   * handlers + state so the override can preserve behaviour. Rarely
   * needed; prefer `sendTitle` / `sendQueueTitle` / `stopTitle`.
   */
  renderSendButton?: (ctx: SendButtonRenderCtx) => ReactNode;

  /** Pass-through DOM attributes on the OUTER wrapper (drag handlers). */
  wrapperProps?: React.HTMLAttributes<HTMLDivElement>;

  /**
   * Extra @ / slash trigger providers, merged with the built-in registry
   * (skills @-mentions + slash commands). Passed through to
   * RichComposerEditor (so the trigger menu sees them) and used at
   * send-time to expand `@[...]` tokens into their serialized text.
   */
  mentionProviders?: TriggerProvider[];
  /**
   * Host-wired handlers for slash commands that map to a native UI action
   * (e.g. `/config` → open settings) instead of being sent as text. When a
   * matching handler is present the command is performed and NOT sent;
   * otherwise it falls through to a normal send.
   */
  slashUiActions?: SlashUiActionContext;
  /**
   * The OFFICIAL input-trigger pipeline, supplied by the DSH plugin host.
   *
   * With it (and a `permissionSessionId` whose DSH session has materialized)
   * the composer drives the official per-session `InputTriggerController`:
   * every plugin's `inputTriggers.registerSource(...)` group appears in the
   * menu, `/`-commands enter command mode, and reference chips serialize
   * through their source's `codec` on submit. The menu itself renders from
   * the shadowed `conversation.input.overlay` seat.
   *
   * Without it (Quick-Ask, the browser extension, the home/draft composer
   * before its session materializes) the composer keeps its surface-local
   * provider registry — same sources, same menu component, same editor verbs.
   */
  triggerRuntime?: ComposerTriggerRuntime;
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
      canSubmitDraft,
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
      modelPicker,
      approvalModePicker,
      planSeat,
      inputOverlay,
      permissionSessionId,
      pickerDialogSize = "default",
      pickerOverlayVariant = "dimmed",
      pickerRefreshKey = 0,
      agentPicker,
      extrasAbove,
      contextRail,
      topAffordance,
      chipRow,
      actionsLeft,
      extrasBelow,
      floatingNotice,
      frameVariant = "default",
      density = "default",
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
      triggerRuntime,
    },
    ref,
  ) {
    const { t } = useT();
    const innerRef = useRef<RichComposerHandle>(null);

    const effectiveMentionProviders = useMemo(
      () => mentionProviders ?? [],
      [mentionProviders],
    );

    // The official trigger pipeline for this composer (or the session-less
    // fallback). Owns command mode, the draft revision every span CAS is
    // checked against, and reference resolution at submit time.
    const trigger = useComposerTriggers({
      runtime: triggerRuntime,
      sessionId: permissionSessionId,
      disabled,
    });

    // Provider list used ONLY for send-time `@[...]` expansion of chips whose
    // model form is provider-owned (host-contributed mention providers). The
    // built-ins no longer serialize here — a reference chip resolves through
    // its source's official `codec`, routed by `trigger.resolver`.
    const providerRegistry = useMemo(
      () =>
        buildProviderRegistry(effectiveMentionProviders, {
          sessionId: permissionSessionId,
          omitBuiltins: true,
        }),
      [effectiveMentionProviders, permissionSessionId],
    );

    // A command-mode submit failure, or a reference serialization failure.
    // Never a silent downgrade: the draft is kept and the reason is shown.
    const [commandNotice, setCommandNotice] = useState<string | null>(null);

    // Single normal-send path. Order mirrors upstream's `onEnter`:
    //   1. command mode (a claim owns Enter),
    //   2. slash UI-actions with a wired handler,
    //   3. official Enter adjudication for a `/`-leading draft,
    //   4. ordinary send with `@[...]` expansion.
    // Abort / stop / queue branches do NOT route through here.
    const resolvingMentionRef = useRef<(AbortController & { draft: string; sessionId?: string; attachments: UseComposerAttachmentsResult["attachments"] | undefined }) | null>(null);
    const commandAttemptRef = useRef<object | null>(null);
    const currentDraftRef = useRef({ value, sessionId: permissionSessionId });
    currentDraftRef.current = { value, sessionId: permissionSessionId };
    useEffect(() => {
      const attempt = resolvingMentionRef.current;
      if (!attempt || (attempt.draft === value && attempt.sessionId === permissionSessionId &&
        attempt.attachments === attachments?.attachments && !disabled)) return;
      attempt.abort();
      resolvingMentionRef.current = null;
      trigger.setAttemptInFlight(false);
    }, [value, permissionSessionId, disabled, attachments?.attachments]);
    useEffect(() => () => {
      resolvingMentionRef.current?.abort();
      resolvingMentionRef.current = null;
    }, []);
    useEffect(() => {
      commandAttemptRef.current = null;
      trigger.setAttemptInFlight(false);
      return () => { commandAttemptRef.current = null; };
    }, [permissionSessionId]);
    const handleSend = useCallback(async (draft = value) => {
      if (disabled || commandAttemptRef.current || resolvingMentionRef.current) return;
      const handled = routeSubmit(draft, {
        send: () => {},
        ctx: slashUiActions ?? {},
        claim: {
          current: trigger.claims.get(),
          run: (claim, args) => {
            setCommandNotice(null);
            const submit = trigger.submitClaim;
            if (submit === null) {
              setCommandNotice(
                `/${claim.token.trim().slice(1)}: no command runtime on this surface`,
              );
              return;
            }
            const captured = (attachments?.attachments ?? []).map((item) => ({ ...item }));
            const sessionId = permissionSessionId;
            const commandAttempt = {};
            commandAttemptRef.current = commandAttempt;
            trigger.setAttemptInFlight(true, "submitting");
            void commandImages(claim, captured).then((images) => submit(claim, args, images))
              .then(
                (outcome) => {
                  if (commandAttemptRef.current !== commandAttempt) return;
                  commandAttemptRef.current = null;
                  trigger.setAttemptInFlight(false);
                  if (currentDraftRef.current.sessionId !== sessionId) return;
                  if (outcome.kind === "success") {
                    if (innerRef.current?.getValue() === draft) {
                      trigger.claims.release();
                      onChange("");
                    }
                    for (const item of captured) attachments?.removeAttachment(item.uiId);
                    if (outcome.text) setCommandNotice(outcome.text);
                    return;
                  }
                  setCommandNotice(outcome.text ?? "command failed");
                },
                (error: unknown) => {
                  if (commandAttemptRef.current !== commandAttempt) return;
                  commandAttemptRef.current = null;
                  trigger.setAttemptInFlight(false);
                  if (currentDraftRef.current.sessionId !== sessionId) return;
                  setCommandNotice(
                    error instanceof Error ? error.message : String(error),
                  );
                },
              );
          },
        },
      });
      if (handled) return; // command claim or UI action took it, don't send
      const attempt = Object.assign(new AbortController(), { draft, sessionId: permissionSessionId, attachments: attachments?.attachments });
      resolvingMentionRef.current = attempt;
      trigger.setAttemptInFlight(true);
      try {
        // Enter adjudication: give every registered source its `matchEnter`
        // turn before the draft becomes an ordinary message. Only the
        // `{ claim }` arm and `undefined` act, exactly as upstream's
        // `onAdjudicated` does — `'handled'` means the source dealt with it.
        const controller = trigger.controller;
        const trimmed = draft.trim();
        if (controller !== undefined && trimmed.startsWith("/")) {
          let outcome;
          try {
            outcome = await controller.adjudicate(trimmed, attempt.signal, {
              images: attachments?.attachments.filter((item) => item.kind === "image").length ?? 0,
            });
          } catch (error) {
            if (attempt.signal.aborted) return;
            setCommandNotice(
              error instanceof Error ? error.message : String(error),
            );
            return;
          }
          if (attempt.signal.aborted) return;
          if (outcome !== undefined) {
            if (outcome !== "handled" && "claim" in outcome) {
              trigger.claims.begin(outcome.claim);
            }
            return;
          }
        }
        let finalText: string;
        try {
          finalText = await expandMentionsAsync(
            draft,
            providerRegistry.all,
            trigger.resolver,
            attempt.signal,
          );
        } catch (error) {
          if (attempt.signal.aborted) return;
          setCommandNotice(
            error instanceof Error ? error.message : String(error),
          );
          return;
        }
        if (attempt.signal.aborted) return;
        setCommandNotice(null);
        onSubmit(finalText);
      } finally {
        // A canceled provider may settle after a new submission has begun.
        if (resolvingMentionRef.current === attempt) {
          resolvingMentionRef.current = null;
          trigger.setAttemptInFlight(false);
        }
      }
    }, [value, slashUiActions, providerRegistry, onSubmit, onChange, trigger, attachments, permissionSessionId, disabled]);

    useImperativeHandle(
      ref,
      (): ComposerHandle => ({
        focus: () => innerRef.current?.focus(),
        select: () => innerRef.current?.select(),
        getTextarea: () => innerRef.current?.getTextarea() ?? null,
      }),
      [],
    );

    const imageBindingRef = useRef({ sessionId: permissionSessionId, attachments, disabled });
    imageBindingRef.current = { sessionId: permissionSessionId, attachments, disabled };
    useEffect(() => {
      if (!permissionSessionId || !triggerRuntime?.bindImages || !attachments) return;
      const current = () => imageBindingRef.current.sessionId === permissionSessionId ? imageBindingRef.current : undefined;
      const writable = () => {
        const binding = current();
        return !!binding && !binding.disabled && !commandAttemptRef.current && !resolvingMentionRef.current;
      };
      return triggerRuntime.bindImages(permissionSessionId, {
        getImages: () => current()?.attachments?.draftImages ?? [],
        canAdd: () => writable() && !current()?.attachments?.attachmentBusy &&
          !current()?.attachments?.attachmentUploading && !!current()?.attachments?.canAddDraftImages?.(),
        addImages: images => current()?.attachments?.addDraftImages?.(images),
        removeImage: id => { if (writable()) current()?.attachments?.removeDraftImage?.(id); },
      });
    }, [permissionSessionId, triggerRuntime, attachments?.draftImages]);

    // Default canSubmit if not provided.
    const effectiveCanSubmit =
      canSubmit !== undefined ? canSubmit : !!value.trim();

    const submitBindingRef = useRef<{ sessionId: string | undefined; submit: () => boolean }>({ sessionId: permissionSessionId, submit: () => false });
    submitBindingRef.current = {
      sessionId: permissionSessionId,
      submit: () => {
        const draft = innerRef.current?.getValue();
        if (draft === undefined || disabled || commandAttemptRef.current || resolvingMentionRef.current ||
          attachments?.attachmentBusy || attachments?.attachmentUploading ||
          (attachments?.canAddDraftImages && !attachments.canAddDraftImages())) return false;
        const admitted = canSubmitDraft?.(draft) ?? (canSubmit === undefined ? !!draft.trim() : effectiveCanSubmit);
        if (!admitted) return false;
        void handleSend(draft);
        return true;
      },
    };
    useEffect(() => {
      if (!permissionSessionId || !triggerRuntime?.bindSubmit) return;
      return triggerRuntime.bindSubmit(permissionSessionId, () => {
        const binding = submitBindingRef.current;
        return binding.sessionId === permissionSessionId && binding.submit();
      });
    }, [permissionSessionId, triggerRuntime]);

    // Resolve placeholder. String form is verbatim; typewriter form runs
    // the cycling effect (pausing automatically as soon as the user types
    // or while ``busy``, so the animation doesn't fight live input).
    // Narrow via a typed alias so the field reads below survive the
    // less-aggressive narrowing under non-strict tsconfigs (extension app).
    const placeholderObj =
      typeof placeholder === "object" && placeholder !== null
        ? placeholder
        : null;
    const typewriterExamples = placeholderObj?.typewriter ?? null;
    const typewriterActive = placeholderObj
      ? (placeholderObj.active ?? (!value && !busy))
      : false;
    const typewriterText = useTypewriterPlaceholder(
      typewriterExamples,
      typewriterActive,
    );
    const resolvedPlaceholder: string =
      typeof placeholder === "string" ? placeholder : typewriterText;

    // Auto-grow + IME-safe Enter/Shift+Enter handling now live inside
    // RichComposerEditor (AutoGrowPlugin / ImeEnterPlugin). The old
    // textarea `useLayoutEffect` and `handleKeyDown` are gone.

    // `autoFocus` used to be a textarea attribute; RichComposerEditor has
    // no such attr, so we focus its Lexical editor imperatively on mount.
    useEffect(() => {
      if (autoFocus) innerRef.current?.focus();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function handleSendClick() {
      if (disabled) return;
      if (busy) {
        if (effectiveCanSubmit) {
          // Queue branch — route through handleSend so @[...] mentions are
          // expanded before the parent enqueues the message.
          handleSend();
          return;
        }
        // Abort branch — untouched.
        onAbort?.();
        return;
      }
      if (!effectiveCanSubmit) return;
      // Normal send — route through handleSend (slash routing + @ expansion).
      handleSend();
    }

    // Resolve which heading the tooltip / aria should use given the
    // current send-button state. `busy + !canSubmit` is the stop
    // variant; everything else is the send / queue variant.
    const isStopState = busy && !effectiveCanSubmit;
    const buttonHeading = isStopState
      ? stopTitle
      : busy
        ? (sendQueueTitle ?? sendTitle ?? "Queue")
        : (sendTitle ?? "Send");

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
    );

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
          <TooltipContent
            side="top"
            align="end"
            className="flex flex-col gap-1"
          >
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
    );

    // Compose paste handler: surface-provided onPaste is honoured
    // first, then the attachment hook's handler runs to capture
    // pasted files. Wrapping at the Composer level means no surface
    // needs to remember to wire it.
    const handlePaste = (
      e: import("react").ClipboardEvent<HTMLTextAreaElement>,
    ) => {
      if (onPaste) onPaste(e);
      if (e.defaultPrevented) return;
      attachments?.handlePaste(e);
    };

    // Built-in attachment chip strip merged with the optional `chipRow`
    // slot from the surface (e.g. pinned page chips). Attachment chips
    // ALWAYS render first so the order is consistent across surfaces.
    const attachmentChips = attachments?.attachments ?? [];
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
      ) : null;

    const addMenuItems = useMemo<MenuItem[]>(() => {
      if (!attachments || disabled || attachments.attachmentBusy || attachments.attachmentUploading) return [];
      return [{
        id: "composer.attach-files",
        label: t("sidepanel.triggerMenu.files"),
        icon: <Paperclip className="h-4 w-4" strokeWidth={1.75} />,
        action: () => {
          innerRef.current?.consumeMentionTrigger();
          void attachments.openFilePicker();
        },
      }];
    }, [attachments?.openFilePicker, attachments?.attachmentBusy, attachments?.attachmentUploading, disabled, t]);

    return (
      <ComposerAddMenuContext.Provider value={addMenuItems}>
      <div
        {...wrapperProps}
        // Drop handlers from the attachment hook are merged with any
        // wrapperProps the surface passed (rare). This way the wrapper
        // is the single place the popup grows a drag-over ring + drop
        // overlay — no per-surface boilerplate.
        onDragOver={(e) => {
          wrapperProps?.onDragOver?.(e);
          attachments?.dropHandlers.onDragOver(e);
        }}
        onDragLeave={(e) => {
          wrapperProps?.onDragLeave?.(e);
          attachments?.dropHandlers.onDragLeave(e);
        }}
        onDrop={(e) => {
          wrapperProps?.onDrop?.(e);
          attachments?.dropHandlers.onDrop(e);
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
        {contextRail ? (
          <div
            data-composer-context-rail=""
            className={cn(
              "relative z-0 mx-4 -mb-2.5 flex h-10 items-start rounded-t-[14px] border border-b-0 border-border/45 bg-muted/45 px-3 pt-[3px]",
              "shadow-[inset_0_1px_0_rgb(255_255_255_/_0.5)] dark:shadow-[inset_0_1px_0_rgb(255_255_255_/_0.04)]",
              frameVariant === "hero" &&
                "mx-6 h-11 rounded-t-[16px] px-4 pt-[5px]",
              flatTop && "mx-0 rounded-t-none",
            )}
          >
            {contextRail}
          </div>
        ) : null}
        <div
          // The composer CARD. `data-composer-card` is the official anchor
          // contract of the `conversation.input.overlay` seat rendered at the
          // end of this element: occupants position themselves against this
          // box and call `closest("[data-composer-card]")` on themselves to
          // tell a pointerdown inside the composer apart from one outside it
          // (an outside press dismisses). The attribute must stay on the
          // element that contains BOTH the editor and the seat.
          data-composer-card=""
          className={cn(
            "relative z-10 flex flex-col transition-colors",
            frameVariant === "hero"
              ? // Hero: the same quiet, focus-stable edge at a larger scale.
                // A broad, upward-biased ambient shadow keeps the composer
                // legible against the conversation without turning its edge
                // into a dark outline.
                // Used by the
                // homepage empty state where the composer is THE focal
                // point of the page.
                "rounded-[24px] border border-border/30 bg-card/85 shadow-[0_-18px_42px_-20px_rgb(0_0_0_/_0.14),0_14px_34px_-24px_rgb(0_0_0_/_0.16)] backdrop-blur-2xl dark:shadow-[0_-20px_48px_-22px_rgb(0_0_0_/_0.55),0_14px_34px_-24px_rgb(0_0_0_/_0.5)]"
              : // Default: a low-contrast static edge restores the input's
                // boundary without becoming stronger when the editor focuses.
                "rounded-2xl border border-border/30 bg-background shadow-[0_-18px_42px_-24px_rgb(0_0_0_/_0.18),0_8px_24px_-18px_rgb(0_0_0_/_0.17)] dark:shadow-[0_-18px_44px_-24px_rgb(0_0_0_/_0.62),0_8px_24px_-18px_rgb(0_0_0_/_0.48)]",
            flatTop && !contextRail && "rounded-t-none",
            frameClassName,
          )}
        >
          {attachments?.dragOver && dropOverlay ? (
            <div
              className={cn(
                "pointer-events-none absolute inset-0 z-[9] flex items-center justify-center bg-primary/5 text-sm font-medium text-primary",
                frameVariant === "hero" ? "rounded-[24px]" : "rounded-2xl",
                flatTop && !contextRail && "rounded-t-none",
              )}
            >
              {dropOverlay}
            </div>
          ) : null}
          <ComposerAccessory />
          {topAffordance}
          {renderedChipRow}
          <div className="flex items-start">
            <div className="min-w-0 flex-1">
              <RichComposerEditor
                ref={innerRef}
                value={value}
                onChange={onChange}
                placeholder={resolvedPlaceholder}
                disabled={disabled}
                maxHeightPx={maxTextareaPx}
                style={textareaStyle}
                onSubmitChord={() => {
                  if (disabled) return;
                  if (!effectiveCanSubmit) return;
                  handleSend();
                }}
                mentionProviders={effectiveMentionProviders}
                sessionId={permissionSessionId}
                trigger={trigger}
                onKeyDownExtra={onKeyDownExtra}
                onPaste={handlePaste}
                className={cn(
                  frameVariant === "hero"
                    ? "min-h-[3.75rem] px-5 pb-1.5 pt-4"
                    : density === "compact"
                      ? "min-h-12 px-3 pb-1 pt-2"
                      : "min-h-[3.75rem] px-3 py-2.5",
                )}
              />
            </div>
          </div>
          <div
            className={cn(
              "flex items-center justify-between gap-2",
              frameVariant === "hero"
                ? "px-3 pb-2 pt-0.5"
                : density === "compact"
                  ? "px-2 pb-1.5"
                  : "px-2 pb-2",
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
                  1. unified add / mention menu
                  2. DSH agent preset (when enabled)
                  3. DSH approval policy (when enabled)
                  4. official conversation.input.plan seat (empty today)
                  5. surface-specific extras (actionsLeft slot)
              */}
              <AttachmentButton
                title={t("sidepanel.triggerMenu.add")}
                onClick={() => { if (trigger.guard().tier !== "frozen") innerRef.current?.openMention(); }}
                disabled={disabled}
              />
              {agentPicker ? (
                <ComposerAgentPicker
                  dialogSize={pickerDialogSize}
                  disabled={disabled}
                  overlayVariant={pickerOverlayVariant}
                  profileLocked={agentPicker.profileLocked}
                  onChange={agentPicker.onChange}
                  refreshKey={pickerRefreshKey}
                  value={agentPicker.value}
                />
              ) : null}
              {approvalModePicker ? (
                <ComposerApprovalModePicker
                  disabled={disabled}
                  sessionId={permissionSessionId}
                  refreshKey={pickerRefreshKey}
                />
              ) : null}
              {/* Official conversation.input.plan seat: immediately right of
                  the access-mode control, per the seat's own contract. No
                  wrapper element — an empty seat must cost no layout, and a
                  flex-row wrapper would spend one gap on nothing. */}
              {planSeat ? planSeat({ locked: disabled }) : null}
              {actionsLeft}
            </div>
            {modelPicker
              ? permissionSessionId
                ? modelPicker.render({
                    seat: "session",
                    owner: { locked: disabled },
                  })
                : modelPicker.render({
                    seat: "hero",
                    owner: {
                      draftSelection: modelPicker.draftSelection,
                      onDraftSelectionChange: modelPicker.onDraftSelectionChange,
                      disabled,
                      dialogSize: pickerDialogSize,
                      overlayVariant: pickerOverlayVariant,
                      refreshKey: pickerRefreshKey,
                    },
                  })
              : null}
            {sendButtonNode}
          </div>
          {/* Official conversation.input.overlay seat: a BARE dispatch, no
              wrapper — an empty seat must cost no box and no gap, and every
              occupant supplies its own absolute positioning relative to this
              card (`bottom: calc(100% + 4px)`, i.e. floating just above the
              composer). Last child of the card so it never sits between the
              editor and the tool row in reading order. */}
          {inputOverlay}
        </div>
        {/* Hidden fallback file input. Renders once at the bottom of
            the wrapper so the picker click-fallback path works on
            browsers without `showOpenFilePicker`. */}
        {attachments ? <input {...attachments.fileInputProps} /> : null}
        {floatingNotice || commandNotice ? (
          <div
            className="pointer-events-none absolute inset-x-2 top-full z-30 flex flex-col items-center gap-1 pt-2"
            data-composer-floating-notice=""
          >
            {floatingNotice}
            {/* Command-mode / reference-serialization failures. Upstream
                surfaces these through the input machine's notice channel;
                Amiba has no such channel, so the composer owns this one
                strip. The draft is ALWAYS retained — a failed command or a
                failed `codec.serialize` must never silently downgrade into
                an ordinary message. */}
            {commandNotice ? (
              <span
                data-composer-command-notice=""
                className="pointer-events-auto rounded-md border border-destructive/40 bg-background px-2 py-1 text-xs text-destructive shadow-sm"
                role="status"
              >
                {commandNotice}
              </span>
            ) : null}
          </div>
        ) : null}
        {extrasBelow ? (
          <div className="px-1 pt-1 text-xs text-muted-foreground">
            {extrasBelow}
          </div>
        ) : null}
      </div>
      </ComposerAddMenuContext.Provider>
    );
  },
);

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
  const [output, setOutput] = useState("");
  const stateRef = useRef<{
    idx: number;
    charIdx: number;
    phase: "typing" | "holding" | "deleting";
  }>({ idx: 0, charIdx: 0, phase: "typing" });

  useEffect(() => {
    if (!examples || examples.length === 0) {
      setOutput("");
      return;
    }

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setOutput(examples[0] ?? "");
      return;
    }

    if (!active) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function tick() {
      if (cancelled || !examples) return;
      const { idx, charIdx, phase } = stateRef.current;
      const current = examples[idx] ?? "";

      if (phase === "typing") {
        if (charIdx < current.length) {
          stateRef.current = { idx, charIdx: charIdx + 1, phase };
          setOutput(current.slice(0, charIdx + 1));
          timer = setTimeout(tick, 55 + Math.random() * 50);
        } else {
          stateRef.current = { idx, charIdx, phase: "holding" };
          timer = setTimeout(tick, 1800);
        }
      } else if (phase === "holding") {
        stateRef.current = { idx, charIdx, phase: "deleting" };
        timer = setTimeout(tick, 0);
      } else {
        if (charIdx > 0) {
          stateRef.current = { idx, charIdx: charIdx - 1, phase };
          setOutput(current.slice(0, charIdx - 1));
          timer = setTimeout(tick, 22);
        } else {
          stateRef.current = {
            idx: (idx + 1) % examples.length,
            charIdx: 0,
            phase: "typing",
          };
          timer = setTimeout(tick, 250);
        }
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, examples]);

  return output;
}
