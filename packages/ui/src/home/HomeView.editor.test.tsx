import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";
import HomeView from "./HomeView";

const mocks = vi.hoisted(() => ({
  queue: vi.fn(),
  choose: vi.fn(),
  root: vi.fn(),
  editor: undefined as unknown as import("lexical").LexicalEditor,
}));
vi.mock("../directory-chooser", () => ({
  useDirectoryChooser: () => mocks.choose,
}));
vi.mock("../theme", () => ({
  useResolvedTheme: () => ({}),
  useDocumentTheme: () => "light",
}));
vi.mock("@amiba/app-runtime/core", () => ({
  getAgentPresets: async () => ({ ok: false }),
  normalizeAgentContext: (value: unknown) => value,
  useSessions: () => ({ ready: true }),
  useWallpaper: () => ({}),
}));
vi.mock("../chat", async () => {
  const { forwardRef, useEffect } = await import("react");
  const { useLexicalComposerContext } = await import("@lexical/react/LexicalComposerContext");
  function Capture() { const [editor] = useLexicalComposerContext(); useEffect(() => { mocks.editor = editor; }, [editor]); return null; }
  const { RichComposerEditor } = await import("../chat/composer/RichComposerEditor");
  const { WorkspaceControl } = await import("../chat/WorkspaceControl");
  return {
    WorkspaceControl,
    queueChatPrompt: mocks.queue,
    Composer: forwardRef(
      ({ contextRail, floatingNotice, onSubmit, value, onChange, draftSource }: any, ref) => (
        <div>
          {contextRail}
          {floatingNotice}
          <RichComposerEditor ref={ref as any} value={value} onChange={onChange} draftSource={draftSource}><Capture /></RichComposerEditor>
          <button onClick={() => onSubmit("hello")}>Send</button>
        </div>
      ),
    ),
    ComposerNotice: ({ detail }: any) => <div role="alert">{detail}</div>,
    useComposerAttachments: () => ({
      attachments: [],
      setAttachments: () => {},
      hasReadyAttachment: () => false,
    }),
    WallpaperBackdrop: () => null,
    WallpaperCredit: () => null,
  };
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.root.mockResolvedValue("/Users/test/Amiba/workspace");
  mocks.choose.mockImplementation(async (_initial, accept) =>
    accept("/manual/project"),
  );
  setPlatform({
    storage: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
      watch: () => () => {},
    },
    workspaces: { getDefaultRoot: mocks.root },
  } as unknown as PlatformAdapter);
});

it("retains real editor content after Home unmounts and auto-focuses on return", async () => {
  const { $getRoot, $createParagraphNode, $createTextNode } = await import("lexical");
  const home = <HomeView panelMode onOpenChat={() => {}} onOpenSettings={() => {}} />;
  const view = render(home);
  await act(async () => {});
  await act(async () => {
    mocks.editor.update(() => {
      $getRoot().clear().append($createParagraphNode().append($createTextNode("Unsent home draft")));
    }, { discrete: true, tag: "history-push" });
  });
  expect(screen.getByRole("textbox")).toHaveTextContent("Unsent home draft");
  view.rerender(<div>Existing conversation</div>);
  view.rerender(home);
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent("Unsent home draft"));
});
