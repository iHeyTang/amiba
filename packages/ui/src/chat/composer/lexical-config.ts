import type { InitialConfigType } from "@lexical/react/LexicalComposer"
import { MentionNode } from "./MentionNode"

export const EDITOR_NAMESPACE = "amiba-composer"

export function baseEditorConfig(
  overrides: Partial<InitialConfigType> = {},
): InitialConfigType {
  return {
    namespace: EDITOR_NAMESPACE,
    onError: (e) => {
      throw e
    },
    nodes: [MentionNode],
    theme: {
      paragraph: "m-0",
    },
    ...overrides,
  }
}
