// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  TrajectoryHeaderAction,
  TrajectoryNavigationContext,
} from "./trajectory-header-action.js";
vi.mock("@amiba/i18n/plugin", () => ({
  usePluginT: () => ({ language: "zh-CN" }),
}));
afterEach(cleanup);
it("opens records and returns through the same title action alongside other actions", () => {
  const select = vi.fn();
  const value = { sessionId: "one", available: true, active: false, select };
  const view = (state = value, sessionId = "one") => (
    <TrajectoryNavigationContext.Provider value={state}>
      <button>同步飞书</button>
      <TrajectoryHeaderAction sessionId={sessionId} />
    </TrajectoryNavigationContext.Provider>
  );
  const { rerender } = render(view());
  fireEvent.click(screen.getByRole("button", { name: "会话记录" }));
  expect(select).toHaveBeenLastCalledWith("trajectory");
  rerender(view({ ...value, active: true }));
  fireEvent.click(screen.getByRole("button", { name: "返回对话" }));
  expect(select).toHaveBeenLastCalledWith(null);
  expect(screen.getByRole("button", { name: "同步飞书" })).toBeTruthy();
  rerender(view({ ...value, available: false }));
  expect(screen.queryByRole("button", { name: "会话记录" })).toBeNull();
  rerender(view(value, "other-session"));
  expect(screen.queryByRole("button", { name: "会话记录" })).toBeNull();
});
