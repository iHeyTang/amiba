import { bindInputDraft, type InputDraftCursor } from "./input-draft-binding.js";
/**
 * Bridge between Amiba's composer (plain React, `@amiba/ui`) and the OFFICIAL
 * input-trigger pipeline (`ctx.inputTriggers`, `ctx.commandUi`) — the piece
 * that makes `registerSource` honest rather than a silent no-op.
 *
 * The composer cannot reach a cordis context and must not fabricate one, so
 * everything context-shaped lives here:
 *
 *   - `controllerFor(sessionId)` resolves the session scope
 *     (`ctx.sessions.scope`) and hands back the official per-session
 *     `InputTriggerController`. `undefined` while the DSH session has not
 *     materialized — Amiba mints sessions locally and the real one appears on
 *     first submit — which is exactly when the session-scoped overlay seat is
 *     empty anyway.
 *   - `bindEditor(sessionId, ops)` mounts the four scoped `@mode bail`
 *     listeners on that session scope, each returning `true` iff the Lexical
 *     verb it delegates to actually mutated the editor. The listeners exist
 *     EXACTLY while an editor is bound, so "no composer for this session" is
 *     reported by the ABSENCE of a listener (the controller's `execute` sees
 *     `bail` return undefined) rather than by a listener that lies.
 *   - `submitClaim(...)` runs `CommandClaim.submit(args, actx, [])` with the real
 *     session-scope context. The composer has no `actx` and passing a fake
 *     one would be precisely the half-honest contract member this adoption
 *     refuses.
 *   - `bindComposerFocus(...)` forwards to `commandUi.bindComposerFocus`, the
 *     hook the official popup shell uses to return focus after a settle.
 */

import { createInputStateSource, type InputStateSource, type InputQueueSession } from "./input-state-source.js";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {
  CommandPopupController,
  ComposerImageOps,
  ComposerDraftImageRegistration,
  ComposerTriggerController,
  ComposerTriggerRuntime,
  TriggerEditorOps,
} from "@amiba/ui";
import type {
  CommandClaim,
  ComposerAttachment,
  InputTriggerSource,
  SubmitOutcome,
} from "@amiba/extension-sdk";

interface ImageRegistry {
  createDraftImages(files: readonly File[]): readonly ComposerAttachment[];
  draftImages?(ids: readonly ComposerAttachment["id"][]): readonly ComposerAttachment[];
  releaseDraftImage(id: ComposerAttachment["id"]): void;
}
function imageRegistry(value: unknown): ImageRegistry | undefined {
  const registry = value as Partial<ImageRegistry> | undefined;
  return typeof registry?.createDraftImages === "function" && typeof registry.releaseDraftImage === "function"
    ? registry as ImageRegistry : undefined;
}

/** Everything the bridge needs from the client root context. */
export interface InputTriggerBridgeDeps {
  /** Same per-session document as the original Composer; optional for other hosts. */
  residentDraft?(sessionId: string): {
    subscribe(listener: () => void): () => void;
    setDisplayText(text: string): void;
    readInputDraft(): ReturnType<NonNullable<TriggerEditorOps["readInputDraft"]>>;
  };
  /** Actual Host inbox state, distinct from the native local pending queue. */
  sessionFor?(sessionId: string): InputQueueSession | undefined;
  /** Browser image registry implementing the pinned image operations. */
  images?(): unknown;
  /** Resolve a session-scope ctx, or undefined for an unmaterialized session. */
  scopeOf(sessionId: string): ClientContext | undefined;
  /** The official `ctx.inputTriggers` face, absent when the row is disabled. */
  inputTriggers(): {
    registerSource(source: InputTriggerSource): () => void;
    sessionOf(actx: ClientContext): ComposerTriggerController;
  } | undefined;
  /**
   * Subscribe to official session-roster changes — the signal that a
   * previously unresolvable session may now have a scope.
   */
  subscribeSessions(listener: () => void): () => void;
  /** The official `ctx.commandUi` face, absent when the row is disabled. */
  commandUi():
    | {
        bindComposerFocus(id: never, focus: () => void): () => void;
        popupFor(actx: ClientContext): unknown;
      }
    | undefined;
}

/**
 * The official `PopupSelectController` members the shadow popup needs beyond
 * the ones `CommandPopupController` already names. `popupFor` is typed
 * `unknown` on the published contract, so this is the one place the concrete
 * shape is asserted — and it is asserted against the class's own declaration
 * in `dsh-client-ui-commands/lib/types/client/popup.d.ts`, not invented.
 */
export type OfficialPopupController = CommandPopupController & {
  retry(): void;
};

type InputDraft = ReturnType<NonNullable<TriggerEditorOps["readInputDraft"]>>;
export interface InputImagesSource {
  getSnapshot(): readonly ComposerAttachment[] | undefined;
  subscribe(listener: () => void): () => void;
}

export interface InputDraftSource {
  getSnapshot(): InputDraft | undefined;
  subscribe(listener: () => void): () => void;
}

export interface AmibaInputTriggerBridge extends ComposerTriggerRuntime {
  bindInputSession(sessionId: string, session: InputQueueSession): () => void;
  inputStateSource(sessionId: string): InputStateSource;
  inputImagesFor(sessionId: string): readonly ComposerAttachment[] | undefined;
  inputImagesSource(sessionId: string): InputImagesSource;
  pruneInputImages(sessionId: string, ids: readonly ComposerAttachment["id"][]): void;
  addInputImages(sessionId: string, ids: readonly ComposerAttachment["id"][]): boolean;
  removeInputImage(sessionId: string, id: ComposerAttachment["id"]): void;
  submitInput(sessionId: string): boolean;
  /** Live editor projection; absent until that session has an attached editor. */
  inputDraftFor(sessionId: string): ReturnType<NonNullable<TriggerEditorOps["readInputDraft"]>> | undefined;
  inputDraftSource(sessionId: string): InputDraftSource;
  editInputDraft(sessionId: string, text: string): boolean;
  setInputDraft(sessionId: string, text: string, expectedRevision?: number): boolean;
  /** Publish Amiba's own sources; returns the aggregate disposer. */
  registerSources(sources: readonly InputTriggerSource[], drafts?: boolean): () => void;
  /** Resolve the official controller for a session (seat + composer share it). */
  controllerFor(sessionId: string): ComposerTriggerController | undefined;
  /** Resolve the official popupSelect controller for a session. */
  popupFor(sessionId: string): OfficialPopupController | undefined;
}

export function createInputTriggerBridge(
  deps: InputTriggerBridgeDeps,
): AmibaInputTriggerBridge {
  const inputStates = new Map<string, InputStateSource>();
  const inputSessions = new Map<string, { session: InputQueueSession }>();
  const sessionListeners = new Set<() => void>();
  const notifyInputSessions = () => { for (const listener of sessionListeners) listener(); };

  const imageBindings = new Map<string, { ops: ComposerImageOps }>();
  // Only programmatic additions made without a mounted image owner reside here.
  // Existing native attachments still follow their original switch/unmount GC.
  const residentImages = new Map<string, readonly ComposerDraftImageRegistration[]>();
  const imageSources = new Map<string, InputImagesSource>();
  const imageListeners = new Map<string, Set<() => void>>();
  const notifyImages = (id: string) => { for (const listener of imageListeners.get(id) ?? []) listener(); };
  const inputImagesSource = (id: string): InputImagesSource => {
    let source = imageSources.get(id);
    if (!source) {
      let snapshot: readonly ComposerAttachment[] | undefined;
      source = {
        getSnapshot() {
          // Native images follow the original switch/unmount release policy.
          // Explicit offscreen additions remain separate until native admission.
          const native = imageBindings.get(id)?.ops.getImages() ?? (residentInputs.has(id) ? [] : undefined);
          const pending = residentImages.get(id);
          const images = pending?.length ? [...(native ?? []), ...pending.map(item => item.image)] : native;
          if (!images) return snapshot = undefined;
          if (!snapshot || snapshot.length !== images.length || images.some((image, i) => image !== snapshot![i])) {
            snapshot = Object.freeze([...images]);
          }
          return snapshot;
        },
        subscribe(listener) {
          let listeners = imageListeners.get(id);
          if (!listeners) { listeners = new Set(); imageListeners.set(id, listeners); }
          listeners.add(listener);
          let active = true;
          return () => {
            if (!active) return;
            active = false;
            listeners.delete(listener);
            if (!listeners.size && imageListeners.get(id) === listeners) imageListeners.delete(id);
          };
        },
      };
      imageSources.set(id, source);
    }
    return source;
  };
  const leases = new WeakMap<object, Map<ComposerAttachment["id"], number>>();
  const retain = (registry: ImageRegistry, image: ComposerAttachment): ComposerDraftImageRegistration => {
    let counts = leases.get(registry);
    if (!counts) { counts = new Map(); leases.set(registry, counts); }
    counts.set(image.id, (counts.get(image.id) ?? 0) + 1);
    let live = true;
    return { image, release() {
      if (!live) return;
      live = false;
      const count = (counts.get(image.id) ?? 1) - 1;
      if (count > 0) counts.set(image.id, count);
      else { counts.delete(image.id); registry.releaseDraftImage(image.id); }
    } };
  };
  const submitters = new Map<string, { submit: () => boolean }>();
  const editors = new Map<string, { ops: TriggerEditorOps; draft: ReturnType<typeof bindInputDraft> }>();
  const draftCursors = new Map<string, InputDraftCursor>();
  const residentInputs = new Map<string, {
    source: NonNullable<ReturnType<NonNullable<InputTriggerBridgeDeps["residentDraft"]>>>;
    draft?: ReturnType<typeof bindInputDraft>;
  }>();
  const cursorFor = (id: string) => {
    let cursor = draftCursors.get(id);
    if (!cursor) { cursor = { revision: -1, occurrence: 0 }; draftCursors.set(id, cursor); }
    return cursor;
  };
  const readDraft = (id: string) => {
    const editor = editors.get(id);
    if (editor) return editor.draft.read();
    const resident = residentInputs.get(id);
    if (!resident) return undefined;
    resident.draft ??= bindInputDraft({ readInputDraft: resident.source.readInputDraft } as TriggerEditorOps, cursorFor(id));
    return resident.draft.read();
  };
  const canEditResidentImages = (id: string) => {
    const session = inputSessions.get(id)?.session;
    const phase = editors.get(id)?.draft.read()?.phase;
    return !!session && residentInputs.has(id) && session.getSnapshot().subagent?.address.mode !== "one-shot" &&
      phase !== "adjudicating" && phase !== "submitting";
  };
  const filterResidentImages = (id: string, keep: (image: ComposerAttachment) => boolean) => {
    const images = residentImages.get(id);
    if (!images) return;
    const retained = images.filter(item => keep(item.image));
    if (retained.length === images.length) return;
    if (retained.length) residentImages.set(id, retained);
    else residentImages.delete(id);
    for (const item of images) if (!retained.includes(item)) item.release();
    notifyImages(id);
  };
  const draftListeners = new Map<string, Set<() => void>>();
  const draftSourcesBySession = new Map<string, InputDraftSource>();
  const notifyDraft = (id: string) => { for (const listener of draftListeners.get(id) ?? []) listener(); };
  const inputDraftSource = (id: string): InputDraftSource => {
    let source = draftSourcesBySession.get(id);
    if (!source) {
      source = {
        getSnapshot: () => readDraft(id),
        subscribe(listener) {
          let subscribers = draftListeners.get(id);
          if (!subscribers) { subscribers = new Set(); draftListeners.set(id, subscribers); }
          subscribers.add(listener);
          let active = true;
          return () => {
            if (!active) return;
            active = false;
            subscribers.delete(listener);
            if (!subscribers.size && draftListeners.get(id) === subscribers) draftListeners.delete(id);
          };
        },
      };
      draftSourcesBySession.set(id, source);
    }
    return source;
  };
  let draftSources: readonly InputTriggerSource[] = [];
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  return {
    bindInputSession(sessionId, session) {
      const binding = { session };
      const source = deps.residentDraft?.(sessionId);
      const resident = source && { source };
      if (resident) residentInputs.set(sessionId, resident);
      inputSessions.set(sessionId, binding);
      const offDraft = source?.subscribe(() => {
        if (inputSessions.get(sessionId) !== binding || editors.has(sessionId)) return;
        readDraft(sessionId);
        notifyDraft(sessionId);
      });
      readDraft(sessionId);
      notifyInputSessions();
      notifyDraft(sessionId);
      notifyImages(sessionId);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        offDraft?.();
        if (inputSessions.get(sessionId) !== binding) return;
        inputSessions.delete(sessionId);
        residentInputs.delete(sessionId);
        filterResidentImages(sessionId, () => false);
        notifyInputSessions();
        notifyDraft(sessionId);
        notifyImages(sessionId);
      };
    },
    inputStateSource(sessionId) {
      let source = inputStates.get(sessionId);
      if (!source) {
        source = createInputStateSource({
          draft: inputDraftSource(sessionId), images: inputImagesSource(sessionId),
          session: () => inputSessions.get(sessionId)?.session ?? deps.sessionFor?.(sessionId),
          subscribeSessions: listener => {
            sessionListeners.add(listener);
            const off = deps.subscribeSessions(listener);
            return () => { sessionListeners.delete(listener); off(); };
          },
        });
        inputStates.set(sessionId, source);
      }
      return source;
    },
    registerDraftImage(file) {
      const registry = imageRegistry(deps.images?.());
      if (!registry) return undefined;
      const image = registry.createDraftImages([file])[0];
      return image ? retain(registry, image) : undefined;
    },
    bindImages(sessionId, ops) {
      const binding = { ops };
      imageBindings.set(sessionId, binding);
      let scheduled = false;
      const transfer = () => {
        if (scheduled || !residentImages.get(sessionId)?.length) return;
        scheduled = true;
        // Native parent effects first clear the outgoing session's attachments.
        // Transfer after that commit, through the original upload path.
        queueMicrotask(() => {
          scheduled = false;
          if (imageBindings.get(sessionId) !== binding || !canEditResidentImages(sessionId) || !ops.canAdd()) return;
          const images = residentImages.get(sessionId);
          if (!images?.length) return;
          residentImages.delete(sessionId);
          ops.addImages(images);
          notifyImages(sessionId);
        });
      };
      const off = ops.subscribeImages?.(() => {
        if (imageBindings.get(sessionId) === binding) { notifyImages(sessionId); transfer(); }
      });
      const offAvailability = ops.subscribeAvailability?.(transfer);
      notifyImages(sessionId);
      transfer();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        off?.();
        offAvailability?.();
        if (imageBindings.get(sessionId) === binding) {
          imageBindings.delete(sessionId);
          notifyImages(sessionId);
        }
      };
    },
    inputImagesSource,
    inputImagesFor: sessionId => inputImagesSource(sessionId).getSnapshot(),
    pruneInputImages(sessionId, ids) {
      imageBindings.get(sessionId)?.ops.pruneImages?.(ids);
      const available = new Set(ids);
      filterResidentImages(sessionId, image => available.has(image.id));
    },
    addInputImages(sessionId, ids) {
      const binding = imageBindings.get(sessionId);
      if (binding ? !binding.ops.canAdd() : !canEditResidentImages(sessionId)) return false;
      if (ids.length === 0) return true;
      const registry = imageRegistry(deps.images?.());
      if (!registry?.draftImages) return false;
      const images = registry.draftImages(ids);
      if (images.length !== ids.length || images.some((image, i) => image.id !== ids[i])) return false;
      const registrations = images.map(image => retain(registry, image));
      if (binding) binding.ops.addImages(registrations);
      else {
        residentImages.set(sessionId, [...(residentImages.get(sessionId) ?? []), ...registrations]);
        notifyImages(sessionId);
      }
      return true;
    },
    removeInputImage(sessionId, id) {
      imageBindings.get(sessionId)?.ops.removeImage(id);
      if (canEditResidentImages(sessionId)) filterResidentImages(sessionId, image => image.id !== id);
    },
    bindSubmit(sessionId, submit) {
      const binding = { submit };
      submitters.set(sessionId, binding);
      return () => { if (submitters.get(sessionId) === binding) submitters.delete(sessionId); };
    },
    submitInput: (sessionId) => submitters.get(sessionId)?.submit() ?? false,
    inputDraftSource,
    editInputDraft(sessionId, text) {
      const editor = editors.get(sessionId);
      // A mounted editor's phase/read-only refusal must not fall through.
      if (editor) return editor.ops.editInputDraft?.(text) ?? false;
      const session = inputSessions.get(sessionId)?.session;
      if (!session || session.getSnapshot().subagent?.address.mode === "one-shot") return false;
      const draft = deps.residentDraft?.(sessionId);
      if (!draft) return false;
      draft.setDisplayText(text);
      return true;
    },
    setInputDraft(sessionId, text, expectedRevision) {
      const editor = editors.get(sessionId);
      if (editor) return editor.draft.write(text, expectedRevision);
      const session = inputSessions.get(sessionId)?.session;
      const resident = residentInputs.get(sessionId);
      if (!session || !resident || session.getSnapshot().subagent?.address.mode === "one-shot") return false;
      const before = readDraft(sessionId)!;
      if (expectedRevision !== undefined && before.draftRev !== expectedRevision) return false;
      resident.source.setDisplayText(text);
      return before.draft !== text && readDraft(sessionId)?.draft === text;
    },
    // Preserve the existing mounted-editor readiness API. Standard useInput and
    // observable draft reads include residency without changing this signal.
    inputDraftFor: (sessionId) => editors.get(sessionId)?.draft.read(),
    draftSources: () => draftSources,
    registerSources(sources, drafts = false) {
      const service = deps.inputTriggers();
      if (service === undefined) return () => {};
      const offs: Array<() => void> = [];
      try { for (const source of sources) offs.push(service.registerSource(source)); }
      catch (error) { for (const off of offs.reverse()) off(); throw error; }
      // The SAME official source objects, projected onto session-less editors.
      // Built-ins already have their own local projection and opt out.
      if (drafts) { draftSources = [...draftSources, ...sources]; notify(); }
      return () => {
        for (const off of offs) off();
        if (drafts) { draftSources = draftSources.filter((source) => !sources.includes(source)); notify(); }
      };
    },

    controllerFor(sessionId) {
      const service = deps.inputTriggers();
      if (service === undefined || !sessionId) return undefined;
      const actx = deps.scopeOf(sessionId);
      if (actx === undefined) return undefined;
      try {
        return service.sessionOf(actx);
      } catch {
        // `sessionOf` throws for a ctx with no session scope. A draft whose
        // DSH session has not materialized is exactly that, and it is not an
        // error — the seat is simply empty until it does.
        return undefined;
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      const off = deps.subscribeSessions(listener);
      return () => { listeners.delete(listener); off(); };
    },

    popupFor(sessionId) {
      const command = deps.commandUi();
      if (command === undefined || !sessionId) return undefined;
      const actx = deps.scopeOf(sessionId);
      if (actx === undefined) return undefined;
      try {
        return command.popupFor(actx) as OfficialPopupController;
      } catch {
        return undefined;
      }
    },

    bindEditor(sessionId: string, ops: TriggerEditorOps): () => void {
      const actx = deps.scopeOf(sessionId);
      if (actx === undefined) return () => {};
      const cursor = cursorFor(sessionId);
      readDraft(sessionId);
      const resident = residentInputs.get(sessionId);
      if (resident) resident.draft = undefined;
      const binding = { ops, draft: bindInputDraft(ops, cursor) };
      editors.set(sessionId, binding);
      const current = () => editors.get(sessionId) === binding;
      const offDraft = ops.subscribeInputDraft?.(() => {
        if (current()) { binding.draft.read(); notifyDraft(sessionId); }
      });
      notifyDraft(sessionId);
      // Each listener answers `true` ONLY when its verb reports an observed
      // mutation; `undefined` is the bail protocol's "not handled here", so
      // an unapplied outcome falls through exactly as it must.
      const offs = [
        actx.on("slash/input-begin-command", (request) =>
          current() && ops.beginCommand(request.claim, request.span) ? true : undefined,
        ),
        actx.on("slash/input-insert-reference", (request) =>
          current() && ops.insertReference(request.reference, request.span) ? true : undefined,
        ),
        actx.on("slash/input-consume-token", (request) =>
          current() && ops.consumeToken(request.guard) ? true : undefined,
        ),
        actx.on("slash/input-insert-text", (request) =>
          current() && ops.insertText(request.text, request.span) ? true : undefined,
        ),
      ];
      return () => {
        offDraft?.();
        if (current()) { binding.draft.read(); editors.delete(sessionId); notifyDraft(sessionId); }
        for (const off of offs) off();
      };
    },

    bindComposerFocus(sessionId: string, focus: () => void): () => void {
      const command = deps.commandUi();
      if (command === undefined) return () => {};
      return command.bindComposerFocus(sessionId as never, focus);
    },

    submitClaim(
      sessionId: string,
      claim: CommandClaim,
      args: string,
      images: Parameters<CommandClaim["submit"]>[2] = [],
    ): Promise<SubmitOutcome> {
      const actx = deps.scopeOf(sessionId);
      if (actx === undefined) {
        return Promise.reject(
          new Error(`command: session "${sessionId}" resolved no scope`),
        );
      }
      if (images.length && !claim.images) {
        return Promise.reject(new Error("This command does not accept images."));
      }
      return Promise.resolve().then(() => claim.submit(args, actx, images));
    },
  };
}
