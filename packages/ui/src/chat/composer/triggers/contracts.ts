/**
 * The runtime-neutral face of the OFFICIAL input-trigger pipeline, as seen
 * from `@amiba/ui`.
 *
 * `@amiba/ui` renders on three surfaces: inside the DSH plugin runtime (the
 * product shell), inside Quick-Ask (no plugin runtime at all), and inside the
 * browser extension. Only the first can resolve
 * `ctx.inputTriggers.sessionOf(actx)`. So the composer takes the pipeline as
 * an OPTIONAL injected face rather than importing a service: present → the
 * official pipeline drives the menu; absent → the composer's own
 * provider-registry path runs, unchanged.
 *
 * Every type here is the official one, re-exported through
 * `@amiba/extension-sdk`. Nothing in this file redefines an official shape.
 */

import type {
  ClientSessionContext,
  ComposerAttachment,
  ConversationInputState,
  CommandClaim,
  ConsumeTokenRequest,
  InputTriggerSource,
  MenuState,
  ObservableSnapshot,
  PickOutcome,
  ReferenceInsert,
  SubmitOutcome,
  TokenSpan,
  TriggerGuard,
} from "@amiba/extension-sdk";

export type {
  CandidateRequest,
  ClientSessionContext,
  CommandClaim,
  InputTriggerCandidate,
  InputTriggerPick,
  InputTriggerSource,
  MenuState,
  PickOutcome,
  ReferenceCodec,
  ReferenceInsert,
  SubmitOutcome,
  TokenSpan,
  TriggerChar,
  TriggerGuard,
  TriggerPosition,
} from "@amiba/extension-sdk";

/** The `guard` member of the official consume-token request. */
export type ConsumeTokenGuard = ConsumeTokenRequest["guard"];

/**
 * The subset of the official `InputTriggerController` the composer drives.
 * Structural, so the real controller (a class instance resolved by the host
 * plugin through `ctx.inputTriggers.sessionOf(actx)`) satisfies it directly —
 * no adapter, no re-implementation.
 *
 * `arbitrate` is deliberately absent: it is a menu-internal keyboard helper
 * (its body touches only the menu store and `pick`), and Amiba's own
 * `TriggerMenu` owns the keyboard identically on BOTH mount paths — the
 * in-session shadow and the session-less home composer. Routing arrows
 * through `arbitrate` would give the two paths different highlight models,
 * which is exactly the divergence this design exists to prevent. No
 * source-facing callback is lost: no `InputTriggerSource` member is reachable
 * only through `arbitrate`.
 */
export interface ComposerTriggerController {
  /** Menu state store — the ONE menu model both mount paths render from. */
  readonly menu: ObservableSnapshot<MenuState>;
  /** Feed one draft/caret change through detection and candidate fetch. */
  track(
    draft: string,
    caret: number,
    guard: TriggerGuard,
    draftRev: number,
  ): void;
  /** Route a menu pick back through the owning source's `onPick`. */
  pick(source: string, index: number): void;
  /** Space adjudication over the just-completed leading token. */
  onSpace(): boolean;
  /** Enter adjudication; rejects when a polled source's warmup failed. */
  adjudicate(line: string, signal: AbortSignal, envelope: Parameters<NonNullable<InputTriggerSource["matchEnter"]>>[3]): Promise<PickOutcome>;
  /** Serialize one reference occurrence to its model form via its codec. */
  serializeReference(
    source: string,
    ref: string,
    signal: AbortSignal,
  ): Promise<string>;
  /** External dismiss (Escape, outside pointerdown). */
  dismiss(): void;
}

/**
 * The four scoped `slash/input-*` verbs, implemented against Amiba's Lexical
 * editor. Each returns `true` ONLY when the editor actually mutated — the
 * host plugin's bail listeners return `true` iff these do, so a source's
 * `onPick` sees the truth about whether its outcome landed.
 *
 * The official machine's own answers, which these mirror
 * (`dsh-client-ui-conversation/lib/client.js` lines 1100-1160):
 *   - `beginCommand` → `phase === "claimed" && draftRev !== before`
 *   - `insertReference` → `draftRev !== before`
 *   - `consumeToken` / `insertText` → span CAS (or bare-token equality) then
 *     splice
 * Amiba's implementations are STRICTER: "actually applied" is observed from
 * inside the Lexical update transaction, not inferred from a revision
 * counter, so a CAS-passing outcome whose splice is a no-op still answers
 * `false`.
 */
/** The text/reference portion of official InputState, read from the live editor. */
export interface ComposerInputStatus {
  readonly phase: "plain" | "claimed" | "adjudicating" | "submitting";
  readonly claim?: Readonly<Pick<CommandClaim, "token" | "hint" | "images">>;
}

export interface ComposerInputDraft extends ComposerInputStatus {
  readonly draft: string;
  readonly draftRev: number;
  readonly occurrences: readonly {
    readonly occurrenceId: number;
    readonly source: string;
    readonly ref: string;
    readonly offset: number;
    readonly length: number;
    readonly label: string;
    readonly clipboardText: string;
  }[];
}

export interface TriggerEditorOps {
  readInputDraft?(): ComposerInputDraft;
  /** User draft edits remain available during asynchronous admission/submission. */
  editInputDraft?(text: string): boolean;
  setInputDraft?(text: string, expectedRevision?: number): boolean;
  subscribeInputDraft?(listener: () => void): () => void;
  beginCommand(claim: CommandClaim, span: TokenSpan): boolean;
  insertReference(reference: ReferenceInsert, span: TokenSpan): boolean;
  consumeToken(guard: ConsumeTokenGuard): boolean;
  insertText(text: string, span: TokenSpan): boolean;
}

/**
 * What the DSH plugin host supplies to the composer. Implemented by
 * `@amiba/dsh-plugin-ui-shell`; `undefined` on every surface without a plugin
 * runtime.
 */
export interface ComposerDraftImageRegistration {
  image: ComposerAttachment;
  release(): void;
}

export interface ComposerImageOps {
  getImages(): readonly ComposerAttachment[];
  subscribeImages?(listener: () => void): () => void;
  /** Admission may change without any image-list mutation (e.g. upload settles). */
  subscribeAvailability?(listener: () => void): () => void;
  pruneImages?(ids: readonly ComposerAttachment["id"][]): void;
  canAdd(): boolean;
  addImages(images: readonly ComposerDraftImageRegistration[]): void;
  removeImage(id: ComposerAttachment["id"]): void;
}

export interface ComposerTriggerRuntime {
  inputStateSource?(sessionId: string): ObservableSnapshot<ConversationInputState | undefined>;
  bindImages?(sessionId: string, ops: ComposerImageOps): () => void;
  /** Register an original browser image in the official runtime registry. */
  registerDraftImage?(file: File): ComposerDraftImageRegistration | undefined;
  bindSubmit?(sessionId: string, submit: () => boolean): () => void;
  /** Official source objects projected onto an editor without a DSH session. */
  draftSources?(): readonly import("@amiba/extension-sdk").InputTriggerSource[];
  /**
   * Resolve the official per-session controller. `undefined` when the
   * session has no live DSH scope yet (Amiba mints sessions locally; the DSH
   * session materializes on first submit) or when the service is absent.
   */
  controllerFor(sessionId: string): ComposerTriggerController | undefined;
  /**
   * Notify when a previously unresolvable session may now resolve.
   *
   * This is not a nicety: Amiba mints a session locally and the DSH session
   * materializes on first submit, so the FIRST turn of every new task starts
   * with `controllerFor` answering `undefined`. Without a re-resolve signal
   * the composer would stay on the session-less path for that whole session
   * — the official pipeline would silently never engage.
   */
  subscribe?(listener: () => void): () => void;
  /**
   * Register the four scoped bail listeners for one session, delegating to
   * `ops`. Listeners exist EXACTLY while an editor is bound: no editor, no
   * listener, and the controller's `execute` correctly reports "not applied".
   */
  bindEditor(sessionId: string, ops: TriggerEditorOps): () => void;
  /**
   * Bind the composer's focus callback for one session
   * (`commandUi.bindComposerFocus`). Absent when `ui-commands` is not
   * composed.
   */
  bindComposerFocus?(sessionId: string, focus: () => void): () => void;
  /**
   * Run one command claim's submit transaction.
   *
   * `CommandClaim.submit(args, actx)` takes the SESSION-SCOPE cordis context
   * as its second argument. `@amiba/ui` has no access to one and must not
   * invent one — a fabricated `actx` would be exactly the kind of half-honest
   * contract member this whole adoption refuses — so the call is delegated to
   * the host, which owns the scope.
   *
   * Absent on surfaces with no plugin runtime. Amiba's own sources never
   * return a `{ claim }` outcome there (skills and sessions insert
   * references, commands insert text), so nothing is lost; a claim arriving
   * without this hook is reported as a failure, never silently swallowed.
   */
  submitClaim?(
    sessionId: string,
    claim: CommandClaim,
    args: string,
    images?: Parameters<CommandClaim["submit"]>[2],
  ): Promise<SubmitOutcome>;
}

/** The session projection handed to a source outside the plugin runtime. */
export function localSessionContext(sessionId: string): ClientSessionContext {
  return { sessionId: sessionId as ClientSessionContext["sessionId"] };
}
