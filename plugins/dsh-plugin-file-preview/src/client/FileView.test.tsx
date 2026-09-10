import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { WorkspaceFileView } from "./FileView";
import type {
  WorkspaceFilesAdapter,
  WorkspaceFileDocument,
} from "@amiba/app-runtime/platform";
const doc = (path: string): WorkspaceFileDocument => ({
  path,
  relativePath: path,
  name: path,
  size: 1,
  content: path,
  binary: false,
  truncated: false,
  modifiedAt: 0,
  revision: "1",
});
const renderers = [
  {
    id: "text",
    order: 1,
    text: true,
    component: ({ document }: any) => <div>{document.content}</div>,
  },
];
it("discards stale reads on file switch and deletion", async () => {
  let resolve!: (file: WorkspaceFileDocument) => void;
  let changed!: (value: any) => void;
  const files = {
    read: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue(doc("second")),
    watch: vi.fn((_session, _paths, cb) => {
      changed = cb;
      return () => {};
    }),
  } as unknown as WorkspaceFilesAdapter;
  const view = render(
    <WorkspaceFileView
      resource={{ path: "first" }}
      sessionId="a"
      files={files}
      renderers={renderers}
      showHeader={false}
    />,
  );
  view.rerender(
    <WorkspaceFileView
      resource={{ path: "second" }}
      sessionId="a"
      files={files}
      renderers={renderers}
      showHeader={false}
    />,
  );
  expect(await screen.findByText("second")).toBeInTheDocument();
  await act(async () => resolve(doc("first")));
  expect(screen.queryByText("first")).toBeNull();
  await act(async () => changed({ event: "unlink" }));
  expect(screen.queryByText("second")).toBeNull();
});
it("reselects the renderer after a plugin is installed and removed", async () => {
  const files = {
    read: vi.fn().mockResolvedValue(doc("hello")),
    watch: () => () => {},
  } as unknown as WorkspaceFilesAdapter;
  const view = render(
    <WorkspaceFileView
      resource={{ path: "hello" }}
      sessionId="a"
      files={files}
      renderers={renderers}
      showHeader={false}
    />,
  );
  expect(await screen.findByText("hello")).toBeInTheDocument();
  const custom = {
    id: "custom",
    order: 0,
    text: true,
    component: () => <div>custom renderer</div>,
  };
  view.rerender(
    <WorkspaceFileView
      resource={{ path: "hello" }}
      sessionId="a"
      files={files}
      renderers={[...renderers, custom]}
      showHeader={false}
    />,
  );
  expect(screen.getByText("custom renderer")).toBeInTheDocument();
  view.rerender(
    <WorkspaceFileView
      resource={{ path: "hello" }}
      sessionId="a"
      files={files}
      renderers={renderers}
      showHeader={false}
    />,
  );
  expect(screen.getByText("hello")).toBeInTheDocument();
});
