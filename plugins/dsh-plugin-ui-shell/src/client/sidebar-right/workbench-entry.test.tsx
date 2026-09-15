// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NativeSidebarSeat } from "./native-seat.js";
vi.mock("./dockkit/react.js", () => ({ DockSurface: () => null, FloatLayer: () => null }));
vi.mock("./stores.js", () => ({ canCloseTab: () => true }));
afterEach(cleanup);
it("initializes the legacy bridge collapsed without adding an open-sidebar tab", () => {
  const actions = { open: vi.fn(), setExpanded: vi.fn() };
  const props = {
    sessionId: "one", workbenchSessionId: "one", placement: "tab", activePanel: null,
    usePanelInfo: (select: any) => select({ activePanelId: null }),
    useStore: (select: any) => select({ bySession: {} }),
    actions, t: (key: string) => key, renderSlot: () => null,
    bindService: () => () => {}, openTab: vi.fn(), openPanel: vi.fn(), closePanel: vi.fn(),
    dockHost: document.createElement("div"),
  };
  render(<NativeSidebarSeat {...props as any} />);
  expect(screen.queryByRole("tab")).toBeNull();
  expect(actions.open).toHaveBeenCalledWith("one");
  expect(actions.setExpanded).toHaveBeenCalledWith("one", false);
  expect(props.openPanel).not.toHaveBeenCalled();
});
