import type { InitialConfigType } from "@lexical/react/LexicalComposer"

export const EDITOR_NAMESPACE = "hermes-composer"

export function baseEditorConfig(
  overrides: Partial<InitialConfigType> = {},
): InitialConfigType {
  return {
    namespace: EDITOR_NAMESPACE,
    onError: (e) => {
      throw e
    },
    nodes: [],
    theme: {
      paragraph: "m-0",
    },
    ...overrides,
  }
}
