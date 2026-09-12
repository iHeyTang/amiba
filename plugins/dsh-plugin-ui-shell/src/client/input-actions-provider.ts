import type { ConversationInputActions } from "@amiba/extension-sdk";
import type { SessionProvideDescriptor } from "@deepseek-ai/dsh-client-runtime/client";
import type { AmibaInputTriggerBridge } from "./input-trigger-bridge.js";

/** Standard session props target the original editor, including after rebinding. */
export function createInputActionsProvider(bridge: AmibaInputTriggerBridge): SessionProvideDescriptor & { dispose(): void } {
  const actions = new Map<string, ConversationInputActions>();
  const bindings = new Map<string, { session: unknown; ctx: unknown; dispose(): void }>();
  return {
    props: ["inputActions"],
    dispose() {
      for (const binding of [...bindings.values()]) binding.dispose();
      bindings.clear();
      actions.clear();
    },
    resolve({ sessionId, session, ctx }) {
      const previous = bindings.get(sessionId);
      if (!previous || previous.session !== session || previous.ctx !== ctx) {
        const binding = { session, ctx, dispose: () => {} };
        bindings.set(sessionId, binding);
        binding.dispose = ctx.effect(() => {
          const off = bridge.bindInputSession(sessionId, session);
          return () => {
            off();
            if (bindings.get(sessionId) === binding) bindings.delete(sessionId);
          };
        }, "native input session owner");
        previous?.dispose();
      }
      let inputActions = actions.get(sessionId);
      if (!inputActions) {
        inputActions = Object.freeze({
          setDraft(text: string) {
            const draft = bridge.inputDraftFor(sessionId);
            if (draft?.draft === text) return;
            if (!bridge.editInputDraft(sessionId, text)) {
              throw new Error(draft ? "Input editor cannot accept draft edits"
                : "Input editor is not mounted or the resident draft cannot accept edits");
            }
          },
          addImages: ids => bridge.addInputImages(sessionId, ids),
          removeImage: id => bridge.removeInputImage(sessionId, id),
          pruneImages: ids => bridge.pruneInputImages(sessionId, ids),
          submit() { bridge.submitInput(sessionId); },
        } satisfies ConversationInputActions);
        actions.set(sessionId, inputActions);
      }
      return { props: { inputActions } };
    },
  };
}
