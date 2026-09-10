// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MediaAccountingSummary } from "./accounting.js";
vi.mock("@amiba/ui/plugin", async (original) => ({
  ...await original<typeof import("@amiba/ui/plugin")>(),
  usePluginT: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);
it("hides unsupported accounting and distinguishes missing cost from an explicit zero", () => {
  const view = render(<MediaAccountingSummary />);
  expect(view.container.textContent).toBe("");
  view.rerender(
    <MediaAccountingSummary accounting={{ usage: { generated_images: 1 } }} />,
  );
  expect(screen.getByText("cost：missing")).toBeTruthy();
  expect(screen.queryByText("generated_images")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "usage" }));
  expect(screen.getByText("generated_images")).toBeTruthy();
  view.rerender(
    <MediaAccountingSummary
      accounting={{ cost: { amount: "0", currency: "CNY" } }}
    />,
  );
  expect(screen.getByText("cost：0 CNY")).toBeTruthy();
  expect(screen.getByText("usage：missing")).toBeTruthy();
  view.rerender(
    <MediaAccountingSummary
      accounting={{ cost: { amount: "0.00001234", currency: "USD" } }}
    />,
  );
  expect(screen.getByText("cost：0.00001234 USD")).toBeTruthy();
});
