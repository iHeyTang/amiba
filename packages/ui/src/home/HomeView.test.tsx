import { StrictMode } from "react";
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

it("opens only one native dialog in StrictMode and ignores its result after replacement", async () => {
  let accept!: (path: string) => Promise<void>;
  let finish!: () => void;
  mocks.choose.mockImplementation((_initial, callback) => {
    accept = callback;
    return new Promise<void>(resolve => { finish = resolve; });
  });
  const draw = (replace: boolean) => <StrictMode><HomeView panelMode onOpenChat={() => {}} onOpenSettings={() => {}}
    workspacePicker={(_request, fallback) => replace ? null : fallback} /></StrictMode>;
  const view = render(draw(false));
  await userEvent.click(await screen.findByRole('button', { name: 'Change workspace folder' }));
  await waitFor(() => expect(mocks.choose).toHaveBeenCalledOnce());
  view.rerender(draw(true));
  await accept('/stale-result'); finish();
  expect(screen.getByRole('button', { name: 'Change workspace folder' })).not.toHaveAttribute('title', '/stale-result');
});
it("consumes a prepared preset only after a successful prompt handoff", async () => {
  const commit = vi.fn();
  const prepareSubmission = vi.fn(async () => ({ profileId: 'prepared', commit }));
  const reset = vi.fn();
  const hero = { store: { getSnapshot: () => ({ current: 'stale' }), subscribe: () => () => {} }, load: async () => {}, select: async () => undefined, reset, prepareSubmission };
  render(<HomeView panelMode onOpenChat={() => {}} onOpenSettings={() => {}} heroPreset={hero} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
  expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({ agent: { profileId: 'prepared' } }));
  expect(commit).toHaveBeenCalledOnce();
  expect(reset).not.toHaveBeenCalled();
});

it("reports a rejected preset preparation without queuing or consuming the selection", async () => {
  const commit = vi.fn(), reset = vi.fn();
  const hero = { store: { getSnapshot: () => ({ current: 'writer' }), subscribe: () => () => {} }, load: async () => {}, select: async () => undefined, reset,
    prepareSubmission: vi.fn(async () => { throw new Error('Preset is busy'); return { profileId: 'writer', commit }; }) };
  render(<HomeView panelMode onOpenChat={() => {}} onOpenSettings={() => {}} heroPreset={hero} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Preset is busy');
  expect(mocks.queue).not.toHaveBeenCalled();
  expect(reset).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});
