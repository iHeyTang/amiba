// @vitest-environment jsdom
import type { ButtonHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryPage, type MemoryAdapter } from "./MemoryPage.js";
import type { MemoryEntry, MemoryPage as PageData } from "../dashboard.js";
vi.mock("@amiba/markdown", () => ({
  ChatMarkdown: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@amiba/ui/plugin", async () => ({
  ...(await vi.importActual("../../../../packages/ui/src/primitives/popover")),
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
    beginCorrection: vi.fn().mockResolvedValue("correction prompt"),
    update: vi.fn().mockResolvedValue({ ...entry, kind: "policies" }),
    detail: vi.fn().mockResolvedValue({ entry, relations: [], facts: [] }),
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
function mount(api: MemoryAdapter, startChat = vi.fn()) {
  return render(
    <MemoryPage
      startChat={startChat}
      adapter={api}
      expandSidebar={vi.fn()}
      openSettings={vi.fn()}
    />,
  );
}
describe("native memory workspace", () => {
  it("unlocks protected memories and clears the password field", async () => {
    const api = adapter();
    vi.mocked(api.browse).mockRejectedValueOnce(
      new Error("MEMOS_AUTH_REQUIRED"),
    );
    mount(api);
    const password = await screen.findByLabelText("管理密码");
    expect(screen.queryByRole("group", { name: "记忆分类" })).toBeNull();
    expect(screen.queryByLabelText("搜索当前分类")).toBeNull();
    expect(screen.queryByLabelText("记忆列表")).toBeNull();
    expect(screen.queryByText("概览暂不可用")).toBeNull();
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
    fireEvent.change(password, { target: { value: "test-password" } });
    fireEvent.click(screen.getByRole("button", { name: "进入" }));
    await waitFor(() =>
      expect(api.login).toHaveBeenCalledWith("test-password"),
    );
    await screen.findByRole("button", { name: /使用中文回答/ });
    expect(screen.queryByLabelText("管理密码")).toBeNull();
  });

  it("shows source details and requests pagination and text search", async () => {
    const api = adapter();
    mount(api);
    fireEvent.click(
      await screen.findByRole("button", { name: /使用中文回答/ }),
    );
    expect(await screen.findByText("session-1")).toBeTruthy();
    expect(
      within(screen.getByRole("article")).getByText("请使用中文与我交流。"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() =>
      expect(api.browse).toHaveBeenLastCalledWith({
        kind: "remembered",
        query: "",
        offset: 30,
      }),
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "中文" },
    });
    await waitFor(() =>
      expect(api.browse).toHaveBeenLastCalledWith({
        kind: "remembered",
        query: "中文",
        offset: 0,
      }),
    );
  });
  it("ignores a late response after switching category", async () => {
    const api = adapter();
    let resolve!: (page: PageData) => void;
    vi.mocked(api.browse)
      .mockResolvedValueOnce({ entries: [entry], total: 1, nextOffset: null })
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue({ entries: [], total: 0, nextOffset: null });
    mount(api);
    await screen.findByRole("button", { name: /使用中文回答/ });
    fireEvent.click(screen.getByRole("button", { name: /对话记录/ }));
    fireEvent.click(screen.getByRole("button", { name: /记住的事/ }));
    await screen.findByText("还没有提炼出值得保留的记忆");
    resolve({ entries: [entry], total: 1, nextOffset: null });
    await waitFor(() => expect(screen.queryByText("使用中文回答")).toBeNull());
    expect(screen.getByText("还没有提炼出值得保留的记忆")).toBeTruthy();
  });
  it("shows a retry for service failures outside the login screen", async () => {
    const api = adapter();
    vi.mocked(api.browse)
      .mockRejectedValueOnce(new Error("SERVICE_UNAVAILABLE"))
      .mockResolvedValue({ entries: [], total: 0, nextOffset: null });
    mount(api);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "暂时无法读取记忆",
    );
    expect(screen.queryByText("还没有提炼出值得保留的记忆")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("还没有提炼出值得保留的记忆");
  });
  it("keeps failed sign-ins on the standalone login screen", async () => {
    const api = adapter();
    vi.mocked(api.browse).mockRejectedValue(new Error("MEMOS_AUTH_REQUIRED"));
    vi.mocked(api.login).mockRejectedValue(new Error("Invalid password"));
    mount(api);
    const password = await screen.findByLabelText("管理密码");
    fireEvent.change(password, { target: { value: "wrong-password" } });
    fireEvent.submit(password.closest("form")!);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "验证失败",
    );
    expect((password as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("heading", { name: "进入记忆库" })).toBeTruthy();
    expect(screen.queryByLabelText("搜索当前分类")).toBeNull();
    expect(api.browse).toHaveBeenCalledTimes(1);
  });

  it("waits for the initial access check before showing library controls", () => {
    const api = adapter();
    vi.mocked(api.browse).mockImplementation(() => new Promise(() => {}));
    mount(api);
    expect(screen.getByRole("status").textContent).toContain("正在连接记忆库");
    expect(screen.queryByRole("group", { name: "记忆分类" })).toBeNull();
    expect(screen.queryByLabelText("搜索当前分类")).toBeNull();
  });
  it("opens linked records and returns without changing the list", async () => {
    const api = adapter();
    vi.mocked(api.detail).mockImplementation(async ({ id }) => ({
      entry:
        id === entry.id
          ? entry
          : { ...entry, id, title: "关联经验", status: "active" },
      relations:
        id === entry.id
          ? [{ kind: "policies", id: "p1", title: "关联经验" }]
          : [],
      facts: [],
    }));
    mount(api);
    fireEvent.click(
      await screen.findByRole("button", { name: /使用中文回答/ }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /关联经验/ }));
    await screen.findByRole("heading", { name: "关联经验" });
    expect(api.detail).toHaveBeenLastCalledWith({ kind: "policies", id: "p1" });
    fireEvent.click(screen.getByRole("button", { name: "返回上一条记录" }));
    await screen.findByRole("heading", { name: "使用中文回答" });
    expect(api.browse).toHaveBeenCalledTimes(1);
    const listener = vi.fn();
    window.addEventListener("amiba:open-session", listener);
    fireEvent.click(screen.getByRole("button", { name: "打开来源任务" }));
    expect((listener.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      sessionId: "session-1",
    });
    window.removeEventListener("amiba:open-session", listener);
  });
  it("retries missing details without hiding the list", async () => {
    const api = adapter();
    vi.mocked(api.detail).mockRejectedValueOnce(new Error("MEMOS_HTTP_404"));
    mount(api);
    fireEvent.click(
      await screen.findByRole("button", { name: /使用中文回答/ }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain("不存在");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("heading", { name: "使用中文回答" });
  });
  it("returns to the exact prior offset and clears search across categories", async () => {
    const api = adapter();
    vi.mocked(api.browse).mockResolvedValue({
      entries: [entry],
      total: 100,
      nextOffset: 17,
    });
    mount(api);
    await screen.findByRole("button", { name: /使用中文回答/ });
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() =>
      expect(api.browse).toHaveBeenLastCalledWith({
        kind: "remembered",
        query: "",
        offset: 17,
      }),
    );
    await screen.findByRole("button", { name: /使用中文回答/ });
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    await waitFor(() =>
      expect(api.browse).toHaveBeenLastCalledWith({
        kind: "remembered",
        query: "",
        offset: 0,
      }),
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "keyword" },
    });
    await waitFor(() =>
      expect(api.browse).toHaveBeenLastCalledWith({
        kind: "remembered",
        query: "keyword",
        offset: 0,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /对话记录/ }));
    await waitFor(() =>
      expect(api.browse).toHaveBeenLastCalledWith({
        kind: "traces",
        query: "",
        offset: 0,
      }),
    );
  });
  it("ignores late detail responses after selecting another record", async () => {
    const api = adapter();
    const second = { ...entry, id: "trace-2", title: "第二条记忆" };
    vi.mocked(api.browse).mockResolvedValue({
      entries: [entry, second],
      total: 2,
      nextOffset: null,
    });
    let resolve!: (value: Awaited<ReturnType<MemoryAdapter["detail"]>>) => void;
    vi.mocked(api.detail)
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue({ entry: second, relations: [], facts: [] });
    mount(api);
    fireEvent.click(
      await screen.findByRole("button", { name: /使用中文回答/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /第二条记忆/ }));
    await screen.findByRole("heading", { name: "第二条记忆" });
    resolve({ entry, relations: [], facts: [] });
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "使用中文回答" }),
      ).toBeNull(),
    );
  });
  it("returns to the access gate if verification expires while reading details", async () => {
    const api = adapter();
    vi.mocked(api.detail).mockRejectedValue(new Error("MEMOS_AUTH_REQUIRED"));
    mount(api);
    fireEvent.click(
      await screen.findByRole("button", { name: /使用中文回答/ }),
    );
    await screen.findByRole("heading", { name: "进入记忆库" });
    expect(screen.queryByLabelText("记忆列表")).toBeNull();
  });
  it("defaults to lasting memories and does not invent processing progress", async () => {
    const api = adapter();
    vi.mocked(api.browse).mockResolvedValue({
      entries: [],
      total: 0,
      nextOffset: null,
    });
    mount(api);
    await screen.findByText("还没有提炼出值得保留的记忆");
    expect(api.browse).toHaveBeenCalledWith({
      kind: "remembered",
      query: "",
      offset: 0,
    });
    expect(screen.queryByText("正在整理")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "对话记录" }));
    await screen.findByText("还没有对话记录");
  });
  it("saves a correction and updates the visible memory", async () => {
    const api = adapter();
    vi.mocked(api.update).mockResolvedValue({
      ...entry,
      kind: "policies",
      title: "中文简洁回答",
    });
    mount(api);
    fireEvent.click(
      await screen.findByRole("button", { name: /使用中文回答/ }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "纠正方式" }));
    fireEvent.click(screen.getByRole("button", { name: "手动修改" }));
    fireEvent.change(screen.getByLabelText("记住的事"), {
      target: { value: "中文简洁回答" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存纠正" }));
    await screen.findByRole("heading", { name: "中文简洁回答" });
    expect(api.update).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "policies",
        id: entry.id,
        action: "correct",
        title: "中文简洁回答",
      }),
    );
    expect(screen.getByRole("button", { name: /中文简洁回答/ })).toBeTruthy();
  });
  it("preserves edits after a failed save and allows cancellation", async () => {
    const api = adapter();
    vi.mocked(api.update).mockRejectedValue(new Error("MEMOS_HTTP_500"));
    mount(api);
    fireEvent.click(
      await screen.findByRole("button", { name: /使用中文回答/ }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "纠正方式" }));
    fireEvent.click(screen.getByRole("button", { name: "手动修改" }));
    fireEvent.change(screen.getByLabelText("记住的事"), {
      target: { value: "我的纠正" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存纠正" }));
    await screen.findByRole("alert");
    expect((screen.getByLabelText("记住的事") as HTMLInputElement).value).toBe(
      "我的纠正",
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("heading", { name: "使用中文回答" })).toBeTruthy();
  });
  it("defaults correction to an Agent draft without opening the manual editor or writing data", async () => {
    const api = adapter();
    const startChat = vi.fn();
    mount(api, startChat);
    fireEvent.click(
      await screen.findByRole("button", { name: /使用中文回答/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "纠正这条记忆" }),
    );
    await waitFor(() =>
      expect(startChat).toHaveBeenCalledWith("correction prompt"),
    );
    expect(api.beginCorrection).toHaveBeenCalledWith({
      kind: "policies",
      id: entry.id,
      language: "zh",
    });
    expect(api.update).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "保存纠正" })).toBeNull();
  });
  it("keeps the detail visible when the correction conversation cannot be prepared", async () => {
    const api = adapter();
    vi.mocked(api.beginCorrection).mockRejectedValue(
      new Error("MEMOS_UNAVAILABLE"),
    );
    const startChat = vi.fn();
    mount(api, startChat);
    fireEvent.click(
      await screen.findByRole("button", { name: /使用中文回答/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "纠正这条记忆" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "纠正对话",
    );
    expect(startChat).not.toHaveBeenCalled();
  });
});
