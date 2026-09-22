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
      ({ contextRail, floatingNotice, onSubmit, value, onChange }: any, _ref) => (
        <div>
          {contextRail}
          {floatingNotice}
          <textarea aria-label="Draft" value={value} onChange={event => onChange(event.target.value)} />
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

it("restores the home input after a conversation unmounts the empty-state view", async () => {
  const home = <HomeView panelMode onOpenChat={() => {}} onOpenSettings={() => {}} />;
  const view = render(home);
  await userEvent.type(screen.getByRole("textbox", { name: "Draft" }), "Unsent home draft");
  view.rerender(<div>Existing conversation</div>);
  expect(screen.queryByRole("textbox", { name: "Draft" })).not.toBeInTheDocument();
  view.rerender(home);
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("Unsent home draft");
});

it("consumes the home draft after a successful prompt handoff", async () => {
  mocks.queue.mockResolvedValue(undefined);
  const home = <HomeView panelMode onOpenChat={() => {}} onOpenSettings={() => {}} />;
  const view = render(home);
  await userEvent.type(screen.getByRole("textbox", { name: "Draft" }), "Unsent home draft");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue(""));
  view.rerender(<div>Existing conversation</div>);
  view.rerender(home);
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("");
});

it("does not clear newer home edits when a previous handoff finishes", async () => {
  let finish!: () => void;
  mocks.queue.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<HomeView panelMode onOpenChat={() => {}} onOpenSettings={() => {}} />);
  const input = screen.getByRole("textbox", { name: "Draft" });
  await userEvent.type(input, "Original");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await userEvent.type(input, " newer edit");
  finish();
  await waitFor(() => expect(input).toHaveValue("Original newer edit"));
});
