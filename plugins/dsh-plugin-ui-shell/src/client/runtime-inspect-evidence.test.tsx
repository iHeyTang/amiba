// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeInspectEvidence } from "./runtime-inspect-evidence";
import fixtures from "../dev/runtime-inspect-fixtures.json";
vi.mock("@amiba/i18n", async (original) => ({
  ...(await original<typeof import("@amiba/i18n")>()),
  useT: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);
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
    const buttons = [
      ...container.querySelectorAll('button[aria-expanded="false"]'),
    ];
    if (!buttons.length) return;
    buttons.forEach((button) => fireEvent.click(button));
  }
  throw new Error("JSON did not fully expand");
}
function content(container: HTMLElement) {
  return container.querySelector("[data-json-viewer]")!.textContent!;
}
describe("folding JSON results", () => {
  it.each(fixtures)("preserves the complete JSON for $label", (fixture) => {
    const { container } = render(view(fixture.result, fixture.args));
    revealAll(container);
    expect(JSON.parse(content(container))).toEqual(fixture.result);
    expect(content(container)).toBe(
      JSON.stringify(fixture.result, null, 2) + "\n",
    );
    expect(container.querySelector("table,input,details")).toBeNull();
  });
  it("toggles nested collections independently without changing their values", () => {
    const { container } = render(
      view({ data: { first: { secret: "hello" }, second: [1, 2] } }),
    );
    expect(content(container)).not.toContain("hello");
    const first = screen.getByRole("button", {
      name: 'shell.inspect.expand $["data"]["first"]',
    });
    fireEvent.click(first);
    expect(content(container)).toContain('"secret": "hello"');
    expect(
      screen.getByRole("button", {
        name: 'shell.inspect.expand $["data"]["second"]',
      }),
    ).toBeTruthy();
    fireEvent.click(first);
    expect(content(container)).not.toContain("hello");
    fireEvent.click(first);
    expect(content(container)).toContain('"secret": "hello"');
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
    expect(JSON.parse(content(container))).toEqual(value);
  });
  it("retains escaped keys, long strings and unknown nested fields", () => {
    const value = { 'a"\nb': { a: { b: { c: "x".repeat(5000) } } }, empty: "" };
    const { container } = render(view(value));
    revealAll(container);
    expect(JSON.parse(content(container))).toEqual(value);
  });
  it("resets folded state and content when the result changes", () => {
    const { container, rerender } = render(view({ old: true }));
    fireEvent.click(screen.getByRole("button"));
    rerender(view({ fresh: false }));
    expect(JSON.parse(content(container))).toEqual({ fresh: false });
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
