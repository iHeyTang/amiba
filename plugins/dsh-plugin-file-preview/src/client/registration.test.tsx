import "../../../../packages/ui/src/test/setup";
import { act, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  type PropsRenderSlots,
  SlotCore,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import { apply } from "./index";
import { createWorkbenchSource } from "../../../dsh-plugin-ui-shell/src/client/workbench-source";
import { WorkbenchExtensionsProvider } from "../../../../packages/ui/src/chat/workbench-extensions";
import {
  WorkspacePaneProvider,
  WorkspacePane,
  useWorkspacePane,
} from "../../../../packages/ui/src/chat/WorkspacePane";
import type { WorkspaceFilesAdapter } from "@amiba/app-runtime/platform";

it("registers both extension layers in the real slot ledger and releases them on unload", async () => {
  const core = new SlotCore();
  const root = core.register(
    {
      name: "root",
      children: { "amiba.workbench.view": { kind: "list", scope: "root" } },
    },
    ({ renderSlot }: PropsRenderSlots<"amiba.workbench.view">) => {
      void renderSlot;
      return null;
    },
  );
  const ctx = {
    slots: {
      register: core.register.bind(core),
      getVersion: core.getVersion.bind(core),
      subscribe: core.subscribe.bind(core),
      entriesOfSlot: core.entriesOfSlot.bind(core),
      inject: (_name: string, callback: () => () => void) => callback(),
    },
  };
  const dispose = apply(ctx as unknown as ClientContext);
  const source = createWorkbenchSource(core);
  expect(source.getSnapshot().map((view) => view.resourceType)).toEqual([
    "file",
    "files",
  ]);
  expect(source.getSnapshot().map((view) => view.instanceKey)).toEqual([
    "amiba.file-workspace", "amiba.file-workspace",
  ]);
  expect(source.getSnapshot()[0]!.component).toBe(source.getSnapshot()[1]!.component);
  expect(core.entriesOfSlot("amiba.filePreview.renderer")).toHaveLength(2);
  const files: WorkspaceFilesAdapter = {
    list: async () => [],
    search: async () => [],
    read: async () => ({
      path: "/a.txt",
      relativePath: "a.txt",
      name: "a.txt",
      size: 4,
      modifiedAt: 1,
      revision: "1",
      content: "hello file plugin",
      binary: false,
      truncated: false,
    }),
    watch: () => () => {},
    reveal: async () => {},
    openExternal: async () => {},
  };
  function Probe() {
    const pane = useWorkspacePane();
    return (
      <button onClick={() => pane.openFile("/a.txt")}>open fixture</button>
    );
  }
  const view = render(
    <WorkbenchExtensionsProvider extensions={source.getSnapshot()}>
      <WorkspacePaneProvider sessionId="s1" capability={{ files }}>
        <Probe />
        <WorkspacePane />
      </WorkspacePaneProvider>
    </WorkbenchExtensionsProvider>,
  );
  await act(async () => screen.getByText("open fixture").click());
  expect(await screen.findByText("hello file plugin")).toBeInTheDocument();
  await act(async () => dispose());
  expect(source.getSnapshot()).toEqual([]);
  expect(core.entriesOfSlot("amiba.filePreview.renderer")).toHaveLength(0);
  view.unmount();
  root();
});
