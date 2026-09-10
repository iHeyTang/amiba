// @vitest-environment jsdom
import type { ButtonHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryPage, type MemoryAdapter } from "./MemoryPage.js";
import type { MemoryEntry, MemoryPage as PageData } from "../dashboard.js";
vi.mock("@amiba/ui/plugin", () => ({
  usePluginT: () => ({ language: "zh-CN" }),
  SidebarExpandControl: () => null,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
  Button: ({
    variant: _v,
    size: _s,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
  }) => <button {...props} />,
}));
afterEach(cleanup);
const entry: MemoryEntry = {
  id: "trace-1",
  title: "使用中文回答",
  sessionId: "session-1",
  profile: "standard",
  timestamp: 123,
  status: null,
  tags: [],
  sections: [{ label: "userText", text: "请使用中文与我交流。" }],
};
function adapter(): MemoryAdapter {
  return {
    login: vi.fn().mockResolvedValue(undefined),
    overview: vi.fn().mockResolvedValue({
      traces: 31,
      episodes: 5,
      policies: 0,
      worldModels: 0,
      skills: 0,
    }),
    browse: vi
      .fn()
      .mockResolvedValue({ entries: [entry], total: 31, nextOffset: 30 }),
  };
}
function mount(api: MemoryAdapter) {
  return render(
    <MemoryPage adapter={api} expandSidebar={vi.fn()} openSettings={vi.fn()} />,
  );
}
describe("native memory workspace", () => {
  it("unlocks protected memories and clears the password field", async () => {
    const api = adapter();
    vi.mocked(api.browse).mockRejectedValueOnce(
      new Error("MEMOS_AUTH_REQUIRED"),
    );
    mount(api);
    const password = await screen.findByLabelText("MemOS 管理密码");
    fireEvent.change(password, { target: { value: "test-password" } });
    fireEvent.click(screen.getByRole("button", { name: "解锁记忆" }));
    await waitFor(() =>
      expect(api.login).toHaveBeenCalledWith("test-password"),
    );
    await screen.findByRole("button", { name: /使用中文回答/ });
    expect(screen.queryByLabelText("MemOS 管理密码")).toBeNull();
  });

  it("shows source details and requests pagination and text search", async () => {
    const api = adapter();
    mount(api);
    fireEvent.click(
      await screen.findByRole("button", { name: /使用中文回答/ }),
    );
    expect(screen.getByText("session-1")).toBeTruthy();
    expect(screen.getByText("请使用中文与我交流。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() =>
      expect(api.browse).toHaveBeenLastCalledWith({
        kind: "traces",
        query: "",
        offset: 30,
      }),
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "中文" },
    });
    await waitFor(() =>
      expect(api.browse).toHaveBeenLastCalledWith({
        kind: "traces",
        query: "中文",
        offset: 0,
      }),
    );
  });
  it("ignores a late response after switching category", async () => {
    const api = adapter();
    let resolve!: (page: PageData) => void;
    vi.mocked(api.browse)
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue({ entries: [], total: 0, nextOffset: null });
    mount(api);
    fireEvent.click(screen.getByRole("button", { name: /经验/ }));
    await screen.findByText("这里还没有内容");
    resolve({ entries: [entry], total: 1, nextOffset: null });
    await waitFor(() => expect(screen.queryByText("使用中文回答")).toBeNull());
    expect(screen.getByText("这里还没有内容")).toBeTruthy();
  });
  it("distinguishes protected data from empty memories and can retry", async () => {
    const api = adapter();
    vi.mocked(api.browse)
      .mockRejectedValueOnce(new Error("MEMOS_AUTH_REQUIRED"))
      .mockResolvedValue({ entries: [], total: 0, nextOffset: null });
    mount(api);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "密码保护",
    );
    expect(screen.queryByText("这里还没有内容")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("这里还没有内容");
  });
});
