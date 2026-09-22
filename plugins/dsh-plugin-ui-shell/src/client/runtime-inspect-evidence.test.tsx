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
    const groups = [
      ...container.querySelectorAll<HTMLDetailsElement>(
        "[data-inspection-content] details:not([open])",
      ),
    ];
    const buttons = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[data-inspection-content] button[aria-expanded="false"], [data-inspection-content] button:not([aria-expanded])',
      ),
    ];
    if (!groups.length && !buttons.length) return;
    for (const details of groups) {
      details.open = true;
      fireEvent(details, new Event("toggle"));
    }
    for (const button of buttons) fireEvent.click(button);
  }
  throw new Error("Fixture did not fully expand");
}
function leaves(value: unknown): string[] {
  if (value && typeof value === "object")
    return Object.values(value).flatMap(leaves);
  return [value === "" ? '""' : String(value)];
}
describe("structural runtime inspection", () => {
  it.each(fixtures)("retains all content for $label", (fixture) => {
    const { container } = render(view(fixture.result, fixture.args));
    revealAll(container);
    const result = fixture.result as Record<string, unknown>;
    const data = "data" in result ? result.data : result;
    const body = container.querySelector("[data-inspection-content]")!;
    for (const leaf of leaves(data)) expect(body.textContent).toContain(leaf);
    expect(container.querySelector("pre")?.textContent).toBe(
      JSON.stringify(fixture.result),
    );
    expect(
      container
        .querySelector("[data-runtime-result] > details")
        ?.hasAttribute("open"),
    ).toBe(false);
  });
  it("compares records using one header row and preserves detail access", () => {
    const { container } = render(
      view({
        tokens: [
          {
            name: "one",
            description: "First token",
            valueType: "CSS color",
            metadata: { enabled: false },
          },
          {
            name: "two",
            description: "Second token",
            valueType: "CSS color",
            metadata: { enabled: true },
          },
        ],
      }),
    );
    expect(
      screen.getAllByRole("columnheader").map((node) => node.textContent),
    ).toEqual(["name", "description", "valueType", "shell.inspect.details"]);
    expect(container.querySelectorAll("tbody > tr")).toHaveLength(2);
    expect(screen.queryByText("enabled")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "shell.inspect.details: one" }),
    );
    revealAll(container);
    expect(screen.getAllByText("enabled").length).toBeGreaterThan(0);
  });
  it("finds an unpaged record and its description without manually expanding", () => {
    render(
      view({
        records: Array.from({ length: 45 }, (_, index) => ({
          name: `record-${index}`,
          description: `Description ${index}`,
        })),
      }),
    );
    expect(screen.queryByText("record-44")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "record-44" },
    });
    expect(screen.getByText("record-44")).toBeTruthy();
    expect(screen.getByText("Description 44")).toBeTruthy();
    expect(screen.getByText('$["records"][44]')).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "shell.inspect.clear" }),
    );
    expect(screen.getByRole("table")).toBeTruthy();
  });
  it("searches hidden schema fields and envelope extensions with exact paths", () => {
    render(
      view({
        platform: "host",
        provider: "Custom",
        method: "read",
        revision: 42,
        data: {
          inputSchema: {
            properties: { needle: { description: "hidden match" } },
          },
        },
      }),
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "hidden match" },
    });
    expect(screen.getByText("hidden match")).toBeTruthy();
    expect(
      screen.getByText('$["data"]["inputSchema"]["properties"]["needle"]'),
    ).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "revision" },
    });
    expect(screen.getByText("revision")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "not-found-anywhere" },
    });
    expect(screen.getByRole("status").textContent).toBe(
      "shell.inspect.noMatches",
    );
  });
  it("surfaces the error before package metadata and source", () => {
    const fixture = fixtures.find((item) => item.id === "self")!;
    const { container } = render(view(fixture.result));
    const content = container.querySelector("[data-inspection-content]")!;
    expect(content.textContent).toContain("demo");
    expect(content.textContent).not.toContain("package-1");
    expect(content.querySelector("[data-inspection-diagnostics]")).toBeTruthy();
    const message = screen.getByText("demo", { exact: true });
    expect(message.closest("details")?.open).toBe(true);
    expect(
      screen.getByText("shell.inspect.packageDetails").closest("details")?.open,
    ).toBe(false);
  });
  it("navigates trees by node names without children/index wrapper groups", () => {
    render(
      view({
        trees: [
          {
            name: "root",
            children: [
              { name: "branch", children: [{ name: "leaf", children: [] }] },
            ],
          },
        ],
      }),
    );
    expect(screen.getByRole("button", { name: /root/ })).toBeTruthy();
    expect(screen.queryByText("leaf")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /branch/ }));
    expect(screen.getByText("leaf")).toBeTruthy();
    expect(screen.queryByText(/^children/)).toBeNull();
  });
  it("falls back safely when a tree has unfamiliar deeper children", () => {
    const { container } = render(
      view({
        trees: [
          {
            name: "root",
            children: [{ name: "branch", children: [1, { unexpected: true }] }],
          },
        ],
      }),
    );
    revealAll(container);
    expect(screen.getByText("unexpected")).toBeTruthy();
  });
  it("renders the same unknown shape for any platform or provider", () => {
    const data = {
      signature: "custom(): void",
      description: "Untranslated description",
      extra: { result: false },
    };
    const { container, rerender } = render(
      view(data, { platform: "host", provider: "Custom", method: "one" }),
    );
    const before = container.innerHTML;
    rerender(
      view(data, { platform: "other", provider: "Future", method: "two" }),
    );
    expect(container.innerHTML).toBe(before);
  });
  it("pages both arrays and object fields without dropping the remainder", () => {
    const { container } = render(
      view({
        list: Array.from({ length: 45 }, (_, i) => `item-${i}`),
        fields: Object.fromEntries(
          Array.from({ length: 45 }, (_, i) => [`key-${i}`, i]),
        ),
      }),
    );
    expect(screen.queryByText("item-44")).toBeNull();
    revealAll(container);
    expect(screen.getByText("item-44")).toBeTruthy();
    expect(screen.getByText("key-44")).toBeTruthy();
  });
  it("retains long text, nulls, empty values, booleans and deep unknown fields", () => {
    const long = "x".repeat(1200);
    const { container } = render(
      view({
        long,
        zero: 0,
        no: false,
        nil: null,
        blank: "",
        emptyArray: [],
        emptyObject: {},
        a: { b: { c: { d: { e: "deep value" } } } },
      }),
    );
    revealAll(container);
    for (const text of [
      long,
      "0",
      "false",
      "null",
      '""',
      "[]",
      "{}",
      "deep value",
    ])
      expect(screen.getByText(text)).toBeTruthy();
  });
  it("preserves envelope extensions alongside the data", () => {
    render(
      view({
        platform: "client",
        provider: "Custom",
        method: "read",
        revision: 7,
        data: { ok: true },
      }),
    );
    expect(screen.getByText("revision=", { exact: false })).toBeTruthy();
    expect(screen.getByText("true")).toBeTruthy();
  });
  it("shows compact parameters without a card while running", () => {
    const { container } = render(
      <RuntimeInspectEvidence
        args={{ provider: "Custom", method: "read" }}
        text=""
        block={{} as never}
      />,
    );
    expect(screen.getByText("Custom", { exact: false })).toBeTruthy();
    expect(container.querySelector("section,table,details")).toBeNull();
  });
  it.each(['{"broken":', "plain text output"])(
    "keeps non-JSON output %s",
    (text) => {
      render(
        <RuntimeInspectEvidence args={{}} text={text} block={{} as never} />,
      );
      expect(screen.getByText(text)).toBeTruthy();
    },
  );
});
