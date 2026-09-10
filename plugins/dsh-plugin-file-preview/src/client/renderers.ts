import type { ComponentType } from "react";
import type {
  WorkspaceFileDocument,
  WorkspaceFileBytes,
} from "@amiba/app-runtime/platform";
export interface FilePreviewProps {
  document: WorkspaceFileDocument;
  line?: number;
  readBytes(): Promise<WorkspaceFileBytes>;
}
export interface FilePreviewRenderer {
  id: string;
  /** Lower values win. Built-ins: image 100, text 1000. */
  order: number;
  extensions?: readonly string[];
  mimeTypes?: readonly string[];
  /** Omit selectors and set text=true to provide a non-binary fallback. */
  text?: boolean;
  component: ComponentType<FilePreviewProps>;
}
export function selectFileRenderer(
  renderers: readonly FilePreviewRenderer[],
  document: WorkspaceFileDocument,
) {
  const extension = document.name.includes(".")
    ? document.name.split(".").pop()!.toLowerCase()
    : "";
  const mime = document.mimeType?.toLowerCase().split(";")[0];
  return renderers
    .filter(
      (renderer) =>
        renderer.extensions?.some(
          (value) => value.toLowerCase().replace(/^\./, "") === extension,
        ) ||
        renderer.mimeTypes?.some(
          (value) =>
            value === mime ||
            (value.endsWith("/*") && mime?.startsWith(value.slice(0, -1))),
        ) ||
        (renderer.text && !document.binary),
    )
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))[0];
}
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    /** inject: () => ({ renderer: FilePreviewRenderer }). Owned by file-preview. */
    "amiba.filePreview.renderer": { kind: "list"; scope: "root" };
  }
}
