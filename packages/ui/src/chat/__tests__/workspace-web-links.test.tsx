import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  WorkspaceMarkdown,
  WorkspaceUrlOpenerContext,
  chatMarkdownComponents,
} from "../workspace-file-links";

it("opens chat web links internally and uses a separate external-browser action", () => {
  const opener = { open: vi.fn(), openExternal: vi.fn() };
  render(
    <WorkspaceUrlOpenerContext.Provider value={opener}>
      <WorkspaceMarkdown mode="static" components={chatMarkdownComponents}>
        {"[Example](https://example.com/page)"}
      </WorkspaceMarkdown>
    </WorkspaceUrlOpenerContext.Provider>,
  );
  fireEvent.click(screen.getByRole("link", { name: "Example" }));
  expect(opener.open).toHaveBeenCalledWith("https://example.com/page");
  expect(opener.openExternal).not.toHaveBeenCalled();
  const external = screen.getByRole("button", {
    name: "Open in default browser",
  });
  expect(external).toHaveAttribute("title", "Open in default browser");
  fireEvent.click(external);
  expect(opener.openExternal).toHaveBeenCalledWith("https://example.com/page");
  expect(opener.open).toHaveBeenCalledTimes(1);
});

it("keeps email links and links outside the conversation as ordinary anchors", () => {
  const opener = { open: vi.fn(), openExternal: vi.fn() };
  render(
    <>
      <WorkspaceUrlOpenerContext.Provider value={opener}>
        <WorkspaceMarkdown mode="static" components={chatMarkdownComponents}>
          {"[Email](mailto:hello@example.com)"}
        </WorkspaceMarkdown>
      </WorkspaceUrlOpenerContext.Provider>
      <WorkspaceMarkdown mode="static" components={chatMarkdownComponents}>
        {"[Example](https://example.com)"}
      </WorkspaceMarkdown>
    </>,
  );
  expect(screen.getByRole("link", { name: "Email" })).toHaveAttribute(
    "href",
    "mailto:hello@example.com",
  );
  expect(screen.getByRole("link", { name: "Example" })).toHaveAttribute(
    "href",
    "https://example.com/",
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
