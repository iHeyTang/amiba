import type { ConversationInputState, ObservableSnapshot } from "@amiba/extension-sdk";
import type { InputDraftSource, InputImagesSource } from "./input-trigger-bridge.js";

export type InputQueueSession = ObservableSnapshot<Pick<ConversationInputState, "queue"> & {
  subagent?: { address: { mode: "one-shot" | "continuable" } } | null;
}>;
export interface InputStateSource {
  getSnapshot(): ConversationInputState | undefined;
  subscribe(listener: () => void): () => void;
}

/** Compose actual native input state with the session's Host inbox projection.
 * An absent editor, attachment binding, or session is explicitly unavailable.
 */
export function createInputStateSource(deps: {
  draft: InputDraftSource;
  images: InputImagesSource;
  session(): InputQueueSession | undefined;
  subscribeSessions(listener: () => void): () => void;
}): InputStateSource {
  let snapshot: ConversationInputState | undefined;
  let previousDraft: ReturnType<InputDraftSource["getSnapshot"]>;
  return {
    getSnapshot() {
      const draft = deps.draft.getSnapshot();
      const images = deps.images.getSnapshot();
      const session = deps.session();
      if (!draft || !images || !session) {
        previousDraft = undefined;
        return snapshot = undefined;
      }
      const queue = session.getSnapshot().queue;
      const unchangedImages = snapshot && snapshot.imageIds.length === images.length &&
        images.every((image, i) => image.id === snapshot!.imageIds[i]);
      if (snapshot && previousDraft === draft && unchangedImages && snapshot.queue === queue) return snapshot;
      const imageIds = unchangedImages ? snapshot!.imageIds : Object.freeze(images.map(image => image.id));
      previousDraft = draft;
      snapshot = Object.freeze({ ...draft, imageIds, queue });
      return snapshot;
    },
    subscribe(listener) {
      let active = true;
      let session: InputQueueSession | undefined;
      let offQueue: (() => void) | undefined;
      let queueBinding: object | undefined;
      const notify = () => { if (active) listener(); };
      const rebind = () => {
        if (!active) return;
        const next = deps.session();
        if (session === next) return;
        offQueue?.();
        session = next;
        const binding = {};
        queueBinding = binding;
        offQueue = next?.subscribe(() => { if (queueBinding === binding) notify(); });
      };
      const offDraft = deps.draft.subscribe(notify);
      const offImages = deps.images.subscribe(notify);
      const offSessions = deps.subscribeSessions(() => { rebind(); notify(); });
      rebind();
      return () => {
        if (!active) return;
        active = false;
        queueBinding = undefined;
        offDraft(); offImages(); offSessions(); offQueue?.();
      };
    },
  };
}
