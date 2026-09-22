// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeInspectEvidence } from "./runtime-inspect-evidence";
import type { SemanticEvidenceContext } from "@amiba/ui/plugin";
vi.mock("@amiba/i18n", async (original) => ({
  ...(await original<typeof import("@amiba/i18n")>()),
  useT: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);
const args = { platform: "client", provider: "Service", method: "listService" };
function view(text: string) {
  return (
    <RuntimeInspectEvidence
      args={args}
      text={text}
      block={{} as SemanticEvidenceContext["block"]}
    />
  );
}
describe("runtime inspection evidence", () => {
  it("retains lightweight arguments when results arrive", () => {
    const { container, rerender } = render(view(""));
    expect(screen.getByText("client · Service.listService")).toBeTruthy();
    expect(container.querySelector("section, dl, table")).toBeNull();
    rerender(
      view(
        JSON.stringify({
          ...args,
          data: {
            mode: "service",
            service: {
              key: "layout",
              description: "Panel navigation",
              access: {
                optional: {
                  expression: 'ctx.get("layout")',
                  requiresUndefinedCheck: true,
                },
                hardDependency: { inject: ["layout"] },
              },
            },
          },
        }),
      ),
    );
    expect(screen.getByText("client · Service.listService")).toBeTruthy();
    expect(screen.getAllByText("layout").length).toBeGreaterThan(0);
    expect(screen.getByText('ctx.get("layout")')).toBeTruthy();
    expect(screen.getByText("shell.inspect.optional")).toBeTruthy();
    expect(
      container.querySelector("details:last-child")?.hasAttribute("open"),
    ).toBe(false);
  });
  it("shows a readable layout summary and collapses implementation details", () => {
    const { container } = render(
      view(
        JSON.stringify({
          ...args,
          data: {
            mode: "service",
            service: {
              key: "layout",
              description:
                "Panel navigation and geometry actions exposed through ctx.layout.",
              access: { optional: { expression: 'ctx.get("layout")' } },
            },
          },
        }),
      ),
    );
    expect(screen.getByText("shell.inspect.layoutName")).toBeTruthy();
    expect(screen.getByText("shell.inspect.layoutDescription")).toBeTruthy();
    const expression = screen.getByText('ctx.get("layout")');
    expect(expression.closest("details")?.open).toBe(false);
    expect(
      container
        .querySelector("[data-runtime-result] > details")
        ?.hasAttribute("open"),
    ).toBe(false);
  });
  it("pages long lists without dropping later entries", () => {
    render(
      view(
        JSON.stringify(
          Array.from({ length: 45 }, (_, i) => ({
            name: `token-${i}`,
            value: "#aabbcc",
          })),
        ),
      ),
    );
    expect(screen.queryByText("token-44")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("token-44")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("allows expansion beyond the previous three-level limit", async () => {
    render(view('{"one":{"two":{"three":{"four":"deep value"}}}}'));
    for (const key of ["one", "two", "three"]) {
      const summary = screen.getByText(key, {
        exact: false,
        selector: "summary",
      });
      const details = summary.parentElement as HTMLDetailsElement;
      details.open = true;
      fireEvent(details, new Event("toggle"));
      await waitFor(() => expect(details.querySelector("div")).toBeTruthy());
    }
    expect(screen.getByText("deep value")).toBeTruthy();
  });
  it.each(['{"broken":', "plain text output", "null", "[]", "{}"])(
    "preserves unusual output %s",
    (text) => {
      const { container } = render(view(text));
      expect(container.querySelector("[data-runtime-result]")).toBeTruthy();
      if (text === "plain text output" || text === '{"broken":')
        expect(screen.getByText(text)).toBeTruthy();
      else expect(container.querySelector("pre")?.textContent).toBe(text);
    },
  );
});
