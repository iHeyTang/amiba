import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { Bubble } from "../bubble/Bubble";
import type { UiMessage } from "../internal/types";
import {
  WorkspaceFileOpenerContext,
  isHtmlPreviewPath,
  parseWorkspaceFileLink,
  resolveWorkspaceFilePath,
  workspaceFileUrl,
} from "../workspace-file-links";

describe("parseWorkspaceFileLink", () => {
  it("accepts absolute, home, relative and dir/file paths", () => {
    expect(
      parseWorkspaceFileLink("/Users/me/annual-report/年度汇报PPT.html"),
    ).toEqual({
      path: "/Users/me/annual-report/年度汇报PPT.html",
    });
    expect(parseWorkspaceFileLink("~/notes/todo.md")).toEqual({
      path: "~/notes/todo.md",
    });
    expect(parseWorkspaceFileLink("./src/App.tsx")).toEqual({
      path: "./src/App.tsx",
    });
    expect(parseWorkspaceFileLink("src/chat/Bubble.tsx")).toEqual({
      path: "src/chat/Bubble.tsx",
    });
    expect(parseWorkspaceFileLink("C:\\work\\app\\index.ts")).toEqual({
      path: "C:\\work\\app\\index.ts",
    });
    expect(parseWorkspaceFileLink("/etc/.env")).toEqual({ path: "/etc/.env" });
  });

  it("carries a trailing :line suffix", () => {
    expect(parseWorkspaceFileLink("src/App.tsx:42")).toEqual({
      path: "src/App.tsx",
      line: 42,
    });
    expect(parseWorkspaceFileLink("src/App.tsx:42:7")).toEqual({
      path: "src/App.tsx",
      line: 42,
    });
  });

  it("rejects prose, urls, routes, branches and bare words", () => {
    for (const text of [
      "km/h",
      "feature/login",
      "/api/users",
      "https://example.com/index.html",
      "package.json",
      "pnpm run build",
      "1/2.5",
      "/Users/me/dir/",
      "a<b>/c.ts",
      "",
    ]) {
      expect(parseWorkspaceFileLink(text), text).toBeNull();
    }
  });
});

describe("workspace file paths", () => {
  it("recognises html pages", () => {
    expect(isHtmlPreviewPath("/a/b.html")).toBe(true);
    expect(isHtmlPreviewPath("/a/b.HTM")).toBe(true);
    expect(isHtmlPreviewPath("/a/b.tsx")).toBe(false);
  });

  it("resolves relative paths against the workspace", () => {
    expect(resolveWorkspaceFilePath("/abs/x.html")).toBe("/abs/x.html");
    expect(resolveWorkspaceFilePath("dist/index.html", "/ws/app/")).toBe(
      "/ws/app/dist/index.html",
    );
    expect(resolveWorkspaceFilePath("../shared/x.html", "/ws/app")).toBe(
      "/ws/shared/x.html",
    );
    expect(resolveWorkspaceFilePath("dist/index.html")).toBeNull();
    expect(resolveWorkspaceFilePath("~/x.html", "/ws")).toBeNull();
  });

  it("builds a file url that keeps CJK names and spaces", () => {
    expect(workspaceFileUrl("/Users/me/年度 报告/PPT.html")).toBe(
      "file:///Users/me/%E5%B9%B4%E5%BA%A6%20%E6%8A%A5%E5%91%8A/PPT.html",
    );
  });
});

describe("inline code file links", () => {
  const message = {
    uiId: "assistant-1",
    role: "assistant",
    content:
      "Saved to `/Users/me/annual-report/年度汇报PPT.html` — run `pnpm build` next.",
  } as UiMessage;

  it("opens a path named in inline code through the workspace opener", async () => {
    const open = vi.fn();
    render(
      <WorkspaceFileOpenerContext.Provider value={open}>
        <Bubble m={message} />
      </WorkspaceFileOpenerContext.Provider>,
    );

    const link = await screen.findByRole("button", {
      name: "/Users/me/annual-report/年度汇报PPT.html",
    });
    expect(link).toHaveAttribute("title", "workspacePane.previewInBrowser");
    await userEvent.click(link);
    expect(open).toHaveBeenCalledWith({
      path: "/Users/me/annual-report/年度汇报PPT.html",
    });
    expect(
      screen.queryByRole("button", { name: "pnpm build" }),
    ).not.toBeInTheDocument();
  });

  it("keeps plain inline code without an opener", async () => {
    render(<Bubble m={message} />);
    expect(
      await screen.findByText("/Users/me/annual-report/年度汇报PPT.html"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
