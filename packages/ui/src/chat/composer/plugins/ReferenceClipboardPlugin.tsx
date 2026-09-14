import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect } from "react";
import { registerReferenceClipboard } from "../reference-clipboard";

export function ReferenceClipboardPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => registerReferenceClipboard(editor), [editor]);
  return null;
}
