// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeInspectEvidence } from "./runtime-inspect-evidence";
vi.mock("@amiba/i18n", async (original) => ({
  ...(await original<typeof import("@amiba/i18n")>()),
  useT: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);
const args = { platform: "client", provider: "Service", method: "listService" };
const service = {
  key: "layout",
  description:
    "Panel navigation and geometry actions exposed through ctx.layout.",
  access: {
    optional: { expression: 'ctx.get("layout")', requiresUndefinedCheck: true },
    hardDependency: { inject: ["layout"] },
  },
  methods: [
    { name: "openPanel", description: "Open a panel in the workspace." },
    { name: "closePanel", description: "Close a workspace panel." },
  ],
};
function view(text: string, theme = false) {
  return (
    <RuntimeInspectEvidence
      args={theme ? { provider: "Theme", method: "listTokens" } : args}
      text={text}
      block={{} as never}
    />
  );
}
describe("runtime inspection evidence", () => {
  it("shows purpose without a technical parameter card while running", () => {
    const { container } = render(view(""));
    expect(screen.getByText("shell.inspect.servicePurpose")).toBeTruthy();
    expect(container.querySelector("section, details, dl, table")).toBeNull();
    expect(container.textContent).not.toContain("listService");
  });
  it("organizes readable service information and keeps code only in raw JSON", () => {
    const text = JSON.stringify({
      ...args,
      data: { mode: "service", service },
    });
    const { container } = render(view(text));
    for (const key of [
      "capabilityName",
      "purpose",
      "operations",
      "openPanel",
      "closePanel",
    ])
      expect(screen.getByText(`shell.inspect.${key}`)).toBeTruthy();
    const body = container.querySelector("[data-runtime-result] > div")!;
    for (const technical of [
      "ctx.get",
      "inject",
      "methods",
      "Service.listService",
    ])
      expect(body.textContent).not.toContain(technical);
    expect(screen.queryByText("shell.inspect.conditions")).toBeNull();
    expect(screen.queryByText("shell.inspect.availability")).toBeNull();
    expect(container.querySelectorAll("details")).toHaveLength(1);
    expect(container.querySelector("details")?.open).toBe(false);
    expect(container.querySelector("pre")?.textContent).toBe(text);
  });
  it("does not invent capabilities when metadata is unfamiliar", () => {
    const text = JSON.stringify({
      mode: "service",
      service: { ...service, description: "A different service", methods: [] },
    });
    render(view(text));
    expect(screen.queryByText("shell.inspect.layoutDescription")).toBeNull();
    expect(screen.queryByText("shell.inspect.openPanel")).toBeNull();
    expect(screen.getByText("shell.inspect.unrecognized")).toBeTruthy();
  });
  it("pages theme values with explicit column meanings", () => {
    render(
      view(
        JSON.stringify(
          Array.from({ length: 45 }, (_, i) => ({
            name: `token-${i}`,
            value: "#aabbcc",
          })),
        ),
        true,
      ),
    );
    expect(screen.getByText("shell.inspect.variable")).toBeTruthy();
    expect(screen.getByText("shell.inspect.value")).toBeTruthy();
    expect(screen.queryByText("token-44")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("token-44")).toBeTruthy();
  });
  it.each(['{"deep":{"a":{"b":{"c":42}}}}', "null", "[]", "{}"])(
    "retains the complete unfamiliar result %s",
    (text) => {
      const { container } = render(view(text));
      expect(container.querySelector("pre")?.textContent).toBe(text);
    },
  );
  it.each(['{"broken":', "plain text output"])(
    "preserves non-JSON output %s",
    (text) => {
      render(view(text));
      expect(screen.getByText(text)).toBeTruthy();
    },
  );
});
