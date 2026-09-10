// @vitest-environment jsdom
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemosPanel } from "./MemosPanel.js";
import { initialMemosStatus, type MemosStatus } from "../memos-status.js";

const locale = vi.hoisted(() => ({ language: "zh-CN" }));
vi.mock("@amiba/ui/plugin", () => {
  const Wrap = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    usePluginT: () => locale,
    PageContent: Wrap,
    ScrollArea: Wrap,
    SettingsPageActions: Wrap,
    TooltipProvider: Wrap,
    Tooltip: Wrap,
    TooltipTrigger: Wrap,
    TooltipContent: () => null,
    SettingsPageActionButton: ({
      children,
      icon: _icon,
      variant: _variant,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & {
      icon?: boolean;
      variant?: string;
    }) => <button {...props}>{children}</button>,
    Button: ({
      children,
      asChild,
      variant: _variant,
      size: _size,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & {
      asChild?: boolean;
      variant?: string;
      size?: string;
    }) => (asChild ? children : <button {...props}>{children}</button>),
    EmbeddedPage: () => {
      throw new Error("Memory must not embed its manager");
    },
  };
});
afterEach(() => {
  cleanup();
  locale.language = "zh-CN";
});
const ready: MemosStatus = {
  ...initialMemosStatus("/memory-test/memos"),
  state: "ready",
  viewerUrl: "http://127.0.0.1:18801",
};
function show(status: MemosStatus) {
  return render(
    <MemosPanel
      getStatus={async () => ({ ok: true as const, value: status })}
    />,
  );
}

describe("memory manager browser entry", () => {
  it("offers an explicit new-window link without embedding or automatically opening anything", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    show(ready);
    const link = await screen.findByRole("link", { name: "在浏览器中打开" });
    expect(link.getAttribute("href")).toBe("http://127.0.0.1:18801/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("完整模式")).toBeTruthy();
    expect(screen.queryByText(/旧版|归档|返回记忆管理/)).toBeNull();
    expect(document.querySelector("iframe, webview")).toBeNull();
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it.each(["starting", "stopped", "error"] as const)(
    "disables opening while the engine is %s",
    async (state) => {
      show({
        ...ready,
        state,
        error: state === "error" ? "viewer unavailable" : null,
      });
      await screen.findByText("完整模式");
      expect(
        (
          screen.getByRole("button", {
            name: "在浏览器中打开",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      expect(screen.queryByRole("link")).toBeNull();
      if (state === "error")
        expect(screen.getByRole("alert").textContent).toBe(
          "viewer unavailable",
        );
    },
  );

  it.each([
    "javascript:alert(1)",
    "https://example.com/",
    "http://127.0.0.1.evil.example/",
    "http://secret@127.0.0.1:18801/",
    "file:///private/data",
  ])("does not open an unsafe manager address: %s", async (viewerUrl) => {
    show({ ...ready, viewerUrl });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("uses the reported local port rather than a hardcoded endpoint", async () => {
    show({ ...ready, viewerUrl: "http://localhost:19901" });
    expect((await screen.findByRole("link")).getAttribute("href")).toBe(
      "http://localhost:19901/",
    );
  });

  it("keeps secondary guidance collapsed and exposes it with an accessible disclosure", async () => {
    show(ready);
    await screen.findByText("完整模式");
    const disclosure = screen.getByRole("button", { name: "使用说明" });
    const help = document.getElementById(
      disclosure.getAttribute("aria-controls")!,
    );
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(help?.hidden).toBe(true);
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(help?.hidden).toBe(false);
    expect(help?.textContent).toContain("无需注册云账号");
    expect(help?.textContent).toContain("可能调用当前配置的模型");
    expect(help?.textContent).toContain("重启 Amiba");
    fireEvent.click(disclosure);
    expect(help?.hidden).toBe(true);
  });

  it("shows loading without inventing an engine mode", () => {
    render(<MemosPanel getStatus={() => new Promise(() => {})} />);
    expect(screen.getByRole("status").textContent).toBe("正在读取状态");
    expect(screen.queryByText("完整模式")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "刷新状态" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("recovers from a status failure through the inline retry", async () => {
    const getStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error("Status connection lost"))
      .mockResolvedValueOnce({ ok: true, value: ready });
    render(<MemosPanel getStatus={getStatus} />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Status connection lost",
    );
    expect(screen.getByRole("status").textContent).toBe("状态不可用");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("link", { name: "在浏览器中打开" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("运行中");
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it("lets the header refresh reflect a stopped engine", async () => {
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: ready })
      .mockResolvedValueOnce({
        ok: true,
        value: { ...ready, state: "stopped" },
      });
    render(<MemosPanel getStatus={getStatus} />);
    await screen.findByRole("link");
    fireEvent.click(screen.getByRole("button", { name: "刷新状态" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("已停止"),
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("localizes the complete entry and reports lightweight mode", async () => {
    locale.language = "en";
    show({ ...ready, mode: "lightweight" });
    await screen.findByRole("link", { name: "Open in browser" });
    expect(screen.getByRole("status").textContent).toBe("Running");
    expect(screen.getByText("Lightweight mode")).toBeTruthy();
    expect(screen.getByText("This device")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Good to know" }));
    expect(screen.getByText(/No cloud account is required/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/[\u4e00-\u9fff]/);
  });
});
