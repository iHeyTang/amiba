import type { PropsRenderSlots } from "@deepseek-ai/dsh-client-ui-slots";
import { FolderTree } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { WorkbenchViewProps } from "@amiba/extension-sdk";
import {
  createSlotContributionsSource,
  WorkspaceFileWorkspace,
  useWorkspacePane,
} from "@amiba/dsh-plugin-ui-shell/client";
import { WorkspaceFileView } from "./FileView.js";
import { defaultFileRenderers } from "./defaults.js";
import type { FilePreviewRenderer } from "./renderers.js";
export type { FilePreviewRenderer, FilePreviewProps } from "./renderers.js";
export const name = "amiba-file-preview-ui";
export const inject = ["slots"];
function RendererRegistry({
  renderSlot,
}: PropsRenderSlots<"amiba.filePreview.renderer">) {
  void renderSlot;
  return null;
}
export function apply(ctx: ClientContext) {
  return ctx.slots.inject("amiba.workbench.view", () => {
    const source = createSlotContributionsSource<FilePreviewRenderer>(
      ctx.slots,
      "amiba.filePreview.renderer",
      (entry, face) => {
        const renderer = face?.renderer as FilePreviewRenderer | undefined;
        return renderer &&
          typeof renderer.id === "string" &&
          (typeof renderer.component === "function" ||
            (typeof renderer.component === "object" &&
              renderer.component !== null))
          ? { ...renderer, order: entry.options.order ?? renderer.order ?? 0 }
          : null;
      },
    );
    function FileWorkbench({
      resource,
      sessionId,
      openFile,
    }: WorkbenchViewProps) {
      const pane = useWorkspacePane();
      const renderers = useSyncExternalStore(
        source.subscribe,
        source.getSnapshot,
        source.getSnapshot,
      );
      const file =
        resource.type === "file"
          ? (resource.data as { path?: string; line?: number } | undefined)
          : undefined;
      if (
        !pane.files ||
        (resource.type === "file" && typeof file?.path !== "string")
      )
        return (
          <p role="status">
            {document.documentElement.lang.startsWith("zh")
              ? "文件访问暂不可用。"
              : "File access unavailable."}
          </p>
        );
      return (
        <WorkspaceFileWorkspace
          resource={
            file?.path
              ? { kind: "file", path: file.path, line: file.line }
              : null
          }
          sessionId={sessionId}
          files={pane.files}
          development={pane.development}
          workspaces={pane.workspaces}
          openFile={openFile}
          treeOpen={pane.fileTreeOpen}
          onTreeOpenChange={pane.setFileTreeOpen}
          renderPreview={(target) => (
            <WorkspaceFileView
              key={`${sessionId}:${target.path}`}
              resource={target}
              sessionId={sessionId}
              files={pane.files!}
              showHeader={false}
              renderers={renderers}
            />
          )}
        />
      );
    }
    const file = ctx.slots.register(
      {
        name: "amiba.workbench.view",
        id: "amiba.file",
        order: 100,
        inject: () => ({
          extension: {
            id: "amiba.file",
            resourceType: "file",
            order: 100,
            component: FileWorkbench,
            instanceKey: "amiba.file-workspace",
          },
        }),
        children: {
          "amiba.filePreview.renderer": { kind: "list", scope: "root" },
        },
      },
      RendererRegistry,
    );
    const browser = ctx.slots.register(
      {
        name: "amiba.workbench.view",
        id: "amiba.files",
        order: 100,
        inject: () => ({
          extension: {
            id: "amiba.files",
            resourceType: "files",
            order: 100,
            component: FileWorkbench,
            instanceKey: "amiba.file-workspace",
            launcher: {
              label: () =>
                document.documentElement.lang.startsWith("zh")
                  ? "打开文件"
                  : "Open file",
              icon: FolderTree,
            },
          },
        }),
      },
      () => null,
    );
    const defaults = defaultFileRenderers.map((renderer) =>
      ctx.slots.register(
        {
          name: "amiba.filePreview.renderer",
          id: renderer.id,
          order: renderer.order,
          inject: () => ({ renderer }),
        },
        () => null,
      ),
    );
    return () => {
      defaults.forEach((dispose) => dispose());
      browser();
      file();
    };
  });
}
