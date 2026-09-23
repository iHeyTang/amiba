import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";
import { NewChatWorkspaceContext } from "../chat/new-chat-workspace";
import HomeView from "./HomeView";

const mocks = vi.hoisted(() => ({
  queue: vi.fn(),
  choose: vi.fn(),
  root: vi.fn(),
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
  const { forwardRef } = await import("react");
  const { WorkspaceControl } = await import("../chat/WorkspaceControl");
  return {
    WorkspaceControl,
    queueChatPrompt: mocks.queue,
    Composer: forwardRef(
      ({ contextRail, floatingNotice, onSubmit }: any, _ref) => (
        <div>
          {contextRail}
          {floatingNotice}
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
it("preselects the shortcut directory, allows changing it, and resets to default on a new-task request", async () => {
  const draw = (path: string | null) => (
    <NewChatWorkspaceContext.Provider value={{ path }}>
      <HomeView panelMode onOpenChat={() => {}} onOpenSettings={() => {}} />
    </NewChatWorkspaceContext.Provider>
  );
  const view = render(draw("/work/selected"));
  await waitFor(() => expect(mocks.root).toHaveBeenCalled());
  expect(
    screen.getByRole("button", { name: "Change workspace folder" }),
  ).toHaveAttribute("title", "/work/selected");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(mocks.queue).toHaveBeenLastCalledWith(
    expect.objectContaining({ text: "hello", workspacePath: "/work/selected" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Change workspace folder" }),
  );
  expect(
    screen.getByRole("button", { name: "Change workspace folder" }),
  ).toHaveAttribute("title", "/manual/project");
  view.rerender(draw(null));
  expect(
    screen.getByRole("button", { name: "Change workspace folder" }),
  ).toHaveAttribute("title", "/Users/test/Amiba/workspace");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(mocks.queue).toHaveBeenLastCalledWith(
    expect.objectContaining({ workspacePath: undefined }),
  );
});

it("hands the official staged preset and workspace to the new session without opening the native chooser", async () => {
  const reset = vi.fn();
  const hero = { store: { getSnapshot: () => ({ current: "writer" }), subscribe: () => () => {} }, load: async () => {}, select: async () => undefined, reset };
  render(<HomeView panelMode onOpenChat={() => {}} onOpenSettings={() => {}} heroPreset={hero}
    workspacePicker={(request) => request.open ? <button onClick={() => request.onPick('/official/project')}>Pick official workspace</button> : null} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Change workspace folder' }));
  await userEvent.click(screen.getByText('Pick official workspace'));
  expect(mocks.choose).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({ agent: { profileId: 'writer' }, workspacePath: '/official/project' }));
  expect(reset).toHaveBeenCalledOnce();
});
