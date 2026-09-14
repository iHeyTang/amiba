import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { REFERENCE_EVENT, ReferenceButton, ReferenceText, parseReferenceHref, referenceHref } from "./reference-request";
afterEach(cleanup);
describe("provider-neutral reference UI", () => {
  it("preserves an opaque account-bound reference through its link", () => {
    const ref = { source: "resources", ref: "lark/account/identity/docx/a%2Fb" };
    expect(parseReferenceHref(referenceHref(ref))).toEqual(ref);
    expect(parseReferenceHref("https://external.example")).toBeUndefined();
  });
  it("dispatches a claimable UI intent without navigating", () => {
    const handler = vi.fn((event: Event) => event.preventDefault()); window.addEventListener(REFERENCE_EVENT, handler);
    try {
      render(<ReferenceButton source="custom" reference="opaque">Person</ReferenceButton>); fireEvent.click(screen.getByRole("button", { name: "Person" }));
      expect(handler).toHaveBeenCalledOnce(); expect(screen.queryByRole("status")).toBeNull();
      expect((handler.mock.calls[0]![0] as CustomEvent).detail).toEqual({ source: "custom", ref: "opaque" });
    } finally { window.removeEventListener(REFERENCE_EVENT, handler); }
  });
  it("shows unavailable when the source plugin has been unloaded", () => {
    render(<ReferenceButton source="gone" reference="opaque">Document</ReferenceButton>); fireEvent.click(screen.getByRole("button")); expect(screen.getByRole("status")).toBeTruthy();
  });
  it("keeps user text inert except for encoded reference links", () => {
    render(<ReferenceText text={`Read [Plan](${referenceHref({ source: "resources", ref: "opaque" })}) <script>evil()</script> [external](https://example.com)`} />);
    expect(screen.getByRole("button", { name: "Plan" })).toBeTruthy(); expect(document.querySelector("script")).toBeNull(); expect(document.querySelector("a")).toBeNull();
  });
});

it.each(["file", "folder", "session"] as const)("shows the optional %s glyph without changing the accessible label", appearance => {
  render(<ReferenceButton source="fixture" reference="id" appearance={appearance}>Label</ReferenceButton>);
  const button = screen.getByRole("button", { name: "Label" });
  expect(button.getAttribute("data-reference-appearance")).toBe(appearance);
  expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
});

it("keeps the default reference button free of appearance markup", () => {
  render(<ReferenceButton source="fixture" reference="id">Label</ReferenceButton>);
  expect(screen.getByRole("button").querySelector("svg")).toBeNull();
  expect(screen.getByRole("button").hasAttribute("data-reference-appearance")).toBe(false);
});
