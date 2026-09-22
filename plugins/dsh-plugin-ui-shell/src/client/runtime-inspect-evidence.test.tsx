// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeInspectEvidence } from "./runtime-inspect-evidence";
import fixtures from "../dev/runtime-inspect-fixtures.json";
vi.mock("@amiba/i18n", async (original) => ({
  ...(await original<typeof import("@amiba/i18n")>()),
  useT: () => ({ t: (key: string) => key }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function view(value: unknown, args: Record<string, unknown> = {}) {
  return (
    <RuntimeInspectEvidence
      args={args}
      text={JSON.stringify(value)}
      block={{} as never}
    />
  );
}
function revealAll(container: HTMLElement) {
  for (let pass = 0; pass < 30; pass++) {
    const buttons = [...container.querySelectorAll(".w-rjv-ellipsis")];
    if (!buttons.length) return;
    buttons.forEach((button) => fireEvent.click(button));
  }
  throw new Error("JSON did not fully expand");
}
function content(container: HTMLElement) {
  return container.querySelector("[data-json-viewer]")!.textContent!;
}
function leaves(value: unknown): string[] {
  if (value !== null && typeof value === "object")
    return Object.values(value).flatMap(leaves);
  return [String(value)];
}
describe("folding JSON results", () => {
  it.each(fixtures)("preserves the complete JSON for $label", (fixture) => {
    const { container } = render(view(fixture.result, fixture.args));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    fireEvent.mouseEnter(container.querySelector(".w-rjv-inner")!);
    fireEvent.click(container.querySelector(".w-rjv-copied")!);
    expect(JSON.parse(writeText.mock.calls[0][0])).toEqual(fixture.result);
    revealAll(container);
    for (const value of leaves(fixture.result))
      expect(content(container)).toContain(value);
    expect(container.querySelector(".w-json-view-container")).toBeTruthy();
    expect(container.querySelector("table,input,details")).toBeNull();
  });
  it("uses the library to expand and collapse nested collections", () => {
    const { container } = render(
      view({ data: { first: { nested: { secret: "hello" } } } }),
    );
    expect(content(container)).not.toContain("hello");
    revealAll(container);
    expect(content(container)).toContain("hello");
    fireEvent.click(container.querySelector(".w-rjv-arrow")!);
    expect(content(container)).not.toContain("hello");
    fireEvent.click(container.querySelector(".w-rjv-arrow")!);
    revealAll(container);
    expect(content(container)).toContain("hello");
  });
  it.each([
    null,
    false,
    0,
    "",
    'line\n"quoted"\\slash',
    [],
    {},
    [false, null, {}, []],
  ])("preserves root value %j", (value) => {
    const { container } = render(view(value));
    revealAll(container);
    if (value === null || typeof value !== "object")
      expect(JSON.parse(content(container))).toEqual(value);
    else
      for (const leaf of leaves(value))
        expect(content(container)).toContain(leaf);
  });
  it("retains escaped keys, long strings and unknown nested fields", () => {
    const value = { 'a"\nb': { a: { b: { c: "x".repeat(5000) } } }, empty: "" };
    const { container } = render(view(value));
    revealAll(container);
    for (const leaf of leaves(value))
      expect(content(container)).toContain(leaf);
  });
  it("resets folded state and content when the result changes", () => {
    const { container, rerender } = render(view({ old: true }));
    fireEvent.click(container.querySelector(".w-rjv-arrow")!);
    rerender(view({ fresh: false }));
    expect(content(container)).toContain("fresh");
    expect(content(container)).not.toContain("old");
  });
  it("keeps pending parameters lightweight", () => {
    const { container } = render(
      <RuntimeInspectEvidence
        args={{ provider: "Custom", method: "read" }}
        text=""
        block={{} as never}
      />,
    );
    expect(screen.getByText("Custom", { exact: false })).toBeTruthy();
    expect(
      container.querySelector("[data-json-viewer],table,details"),
    ).toBeNull();
  });
  it.each(['{"broken":', "plain text output"])(
    "keeps non-JSON output %s",
    (text) => {
      const { container } = render(
        <RuntimeInspectEvidence args={{}} text={text} block={{} as never} />,
      );
      expect(content(container)).toBe(text);
    },
  );
});
