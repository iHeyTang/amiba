import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { getPlatform, setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";
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

it("keeps real editor history while the preparation draft becomes a real session", async () => {
  let complete!: (value: { sessionId: string }) => void;
  let row: any;
  const create = vi.fn(({ cwd, agentPreset }) => new Promise<{ sessionId: string }>(resolve => {
    row = { sessionId: 'prepared-editor', cwd, agentPreset, blank: true, running: false };
    complete = resolve;
  }));
  const platform = getPlatform();
  setPlatform({ ...platform, workspaces: { ...platform.workspaces, bind: async () => {} }, agentSessions: { create, list: async () => row ? [row] : [] } } as unknown as PlatformAdapter);
  const prepared = vi.fn();
  const home = <HomeView panelMode onOpenChat={() => {}} onOpenSettings={() => {}} onPreparedSession={prepared} />;
  const view = render(home);
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  const { $getRoot, $createParagraphNode, $createTextNode } = await import("lexical");
  await act(async () => { mocks.editor.update(() => {
    $getRoot().clear().append($createParagraphNode().append($createTextNode("Typed during preparation")));
  }, { discrete: true, tag: "history-push" }); });
  await act(async () => { complete({ sessionId: 'prepared-editor' }); });
  await waitFor(() => expect(prepared).toHaveBeenLastCalledWith('prepared-editor'));
  expect(screen.getByRole('textbox')).toHaveTextContent('Typed during preparation');
  const { sessionComposerDraft } = await import('../chat/composer-draft-store');
  expect(sessionComposerDraft(platform.storage, 'prepared-editor').getSnapshot()).toBe('Typed during preparation');
  view.rerender(<div>Existing conversation</div>);
  view.rerender(home);
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveTextContent('Typed during preparation'));
  expect(create).toHaveBeenCalledOnce();
});
