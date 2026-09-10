// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatform } from "@amiba/app-runtime/platform";
import { DshCronPage, type CronAdapter } from "./DshCronPage.js";
import { CronNavigation } from "./index.js";
import type { CronTaskView } from "../types.js";
import type { SessionActivity } from "./activity.js";

let root: Root;
let container: HTMLDivElement;
const task: CronTaskView = {
  id: "cron_a",
  name: "Daily digest",
  prompt: "Summarize",
  enabled: true,
  catchUp: false,
  createdAt: 1,
  updatedAt: 1,
  rule: { kind: "every", everySeconds: 300 },
  nextRunAt: 900,
  runs: [
    { sessionId: "new", startedAt: 200, finishedAt: 250 },
    { sessionId: "old", startedAt: 100, finishedAt: 150 },
  ],
};
let adapter: CronAdapter;
let activity: SessionActivity;
const buttons = () => [...container.querySelectorAll("button")];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  setPlatform({
    storage: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
      watch: () => () => {},
    },
  } as never);
  document.documentElement.lang = "en";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  adapter = {
    list: vi.fn(async () => [task]),
    create: vi.fn(),
    update: vi.fn(),
    removeTask: vi.fn(),
    runNow: vi.fn(),
  };
  activity = {
    sessions: [
      { id: "new", unread: true },
      { id: "old", readAt: 160 },
    ],
    visibleSessionId: "",
    markRead: vi.fn(async () => {}),
    markUnread: vi.fn(async () => {}),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("cron history and navigation", () => {
  it("expands all runs without acknowledging them, and opens the selected conversation", async () => {
    const open = vi.fn();
    await act(async () =>
      root.render(
        <DshCronPage
          adapter={adapter}
          sessionActivity={activity}
          onOpenSession={open}
          onStartChat={() => {}}
        />,
      ),
    );
    const toggle = buttons().find((button) =>
      button.textContent?.includes("Daily digest"),
    )!;
    expect(toggle).toBeDefined();
    await act(async () => toggle.click());
    const history = container.querySelector('ul[aria-label="Run history"]')!;
    expect(history.querySelectorAll("li")).toHaveLength(2);
    expect(
      history.querySelectorAll('[aria-label="Unread task runs"]'),
    ).toHaveLength(1);
    expect(activity.markRead).not.toHaveBeenCalled();
    await act(async () =>
      (history.querySelectorAll("button")[1] as HTMLButtonElement).click(),
    );
    expect(open).toHaveBeenCalledWith("old");
  });
  it("keeps the menu unread while viewing the panel and clears it after the result is read", async () => {
    const props = {
      adapter,
      sessionActivity: activity,
      activeView: "cron",
      openWorkspace: vi.fn(),
    };
    await act(async () => root.render(<CronNavigation {...props} />));
    expect(
      container.querySelector('[aria-label="Unread task runs"]'),
    ).not.toBeNull();
    expect(activity.markRead).not.toHaveBeenCalled();
    activity = {
      ...activity,
      sessions: [
        { id: "new", readAt: 300 },
        { id: "old", readAt: 160 },
      ],
    };
    await act(async () =>
      root.render(
        <CronNavigation {...{ ...props, sessionActivity: activity }} />,
      ),
    );
    expect(
      container.querySelector('[aria-label="Unread task runs"]'),
    ).toBeNull();
  });
  it("shows an empty run history for a task that has never run", async () => {
    adapter.list = vi.fn(async () => [{ ...task, runs: [] }]);
    await act(async () =>
      root.render(
        <DshCronPage
          adapter={adapter}
          onOpenSession={() => {}}
          onStartChat={() => {}}
        />,
      ),
    );
    await act(async () =>
      buttons()
        .find((button) => button.textContent?.includes("Daily digest"))!
        .click(),
    );
    expect(container.textContent).toContain("No runs yet.");
  });
});
