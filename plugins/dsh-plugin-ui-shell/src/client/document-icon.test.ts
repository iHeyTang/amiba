// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { installDocumentIcon } from "./document-icon.js";

afterEach(() => {
  for (const link of document.querySelectorAll("link[rel~='icon']")) link.remove();
});

describe("installDocumentIcon", () => {
  it("gives a page that declares no icon the Amiba mark", () => {
    expect(document.querySelector("link[rel~='icon']")).toBeNull();
    installDocumentIcon();
    const link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    expect(link?.rel).toBe("icon");
    expect(link?.type).toBe("image/svg+xml");
    expect(link?.href.startsWith("data:image/svg+xml;base64,")).toBe(true);
  });

  it("leaves a page that already declares one untouched", () => {
    const own = document.createElement("link");
    own.rel = "shortcut icon";
    own.href = "/own.ico";
    document.head.append(own);
    installDocumentIcon();
    expect(document.querySelectorAll("link[rel~='icon']")).toHaveLength(1);
    expect(own.href.endsWith("/own.ico")).toBe(true);
  });
});
