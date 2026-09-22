import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FileTypeIcon, resolveFileIcon } from "../file-type-icon";

describe("file icon identification", () => {
  it.each([
    ["index.ts", "typescript"],
    ["types.d.ts", "typescript"],
    ["C:\\project\\APP.JS", "javascript"],
    ["src/main.py", "python"],
    ["README.md", "markdown"],
    ["App.tsx", "react_ts"],
    ["App.jsx", "react"],
    ["package.json", "nodejs"],
    ["config.json", "json"],
    ["Dockerfile", "docker"],
    ["Dockerfile.production", "docker"],
    [".env.local", "settings"],
    [".gitignore", "git"],
    ["report.pdf", "pdf"],
    ["data.csv", "table"],
    ["archive.tar.gz", "zip"],
    ["photo.png", "image"],
    ["README", "file"],
    ["unknown.blob", "file"],
    ["constructor", "file"],
    ["a.__proto__", "file"],
  ])("identifies %s as %s", (name, expected) => {
    expect(resolveFileIcon(name)).toBe(expected);
  });

  it("uses attachment kind when an extension is missing or unknown", () => {
    expect(resolveFileIcon("download", "pdf")).toBe("pdf");
    expect(resolveFileIcon("pasted", "image")).toBe("image");
  });

  it("uses folder icons even when a directory name has a file extension", () => {
    const { container, rerender } = render(
      <FileTypeIcon name="src.ts" directory />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toContain(
      "folder.svg",
    );
    rerender(<FileTypeIcon name="src.ts" directory expanded />);
    const icon = container.querySelector("img")!;
    expect(icon.getAttribute("src")).toContain("folder-open.svg");
    expect(icon).toHaveAttribute("alt", "");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });
});
