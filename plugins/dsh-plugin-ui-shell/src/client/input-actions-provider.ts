import type { ConversationInputActions } from "@amiba/extension-sdk";
import type { SessionProvideDescriptor } from "@deepseek-ai/dsh-client-runtime/client";
import type { AmibaInputTriggerBridge } from "./input-trigger-bridge.js";

/** Standard session props target the original editor, including after rebinding. */
export function createInputActionsProvider(bridge: AmibaInputTriggerBridge): SessionProvideDescriptor {
  const actions = new Map<string, ConversationInputActions>();
  return {
    props: ["inputActions"],
    resolve({ sessionId }) {
      let inputActions = actions.get(sessionId);
      if (!inputActions) {
        inputActions = Object.freeze({
          setDraft(text: string) {
            const draft = bridge.inputDraftFor(sessionId);
            if (!draft) throw new Error("Input editor is not mounted for this session");
            if (draft.draft === text) return;
            if (!bridge.editInputDraft(sessionId, text)) {
              throw new Error("Input editor cannot accept draft edits");
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
