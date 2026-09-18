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
  it("opens the run history in the side panel and opens the selected conversation", async () => {
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
    const panel = container.querySelector("[data-cron-history-panel]")!;
    expect(panel).not.toBeNull();
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
  it("shows the basic-details card when a task is selected", async () => {
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
    const panel = container.querySelector("[data-cron-history-panel]")!;
    expect(panel.textContent).toContain("Details");
    expect(panel.textContent).toContain("Every 5 min");
    expect(panel.textContent).toContain("New chat on every run");
    expect(panel.textContent).toContain("Off"); // catch-up off
  });
  it("keeps the list visible while the side panel is open, and closes it again", async () => {
    await act(async () =>
      root.render(
        <DshCronPage
          adapter={adapter}
          onOpenSession={() => {}}
          onStartChat={() => {}}
        />,
      ),
    );
    const toggle = buttons().find((button) =>
      button.textContent?.includes("Daily digest"),
    )!;
    await act(async () => toggle.click());
    // Master–detail: the task list stays rendered next to the panel.
    expect(
      container.querySelector('ul[aria-label="Run history"]'),
    ).not.toBeNull();
    expect(
      buttons().some((button) => button.textContent?.includes("Daily digest")),
    ).toBe(true);
    await act(async () =>
      (
        container.querySelector(
          'button[aria-label="Close"]',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(container.querySelector('ul[aria-label="Run history"]')).toBeNull();
    expect(
      buttons().some((button) => button.textContent?.includes("Daily digest")),
    ).toBe(true);
  });
  it("switches the side panel when another task is selected", async () => {
    adapter.list = vi.fn(async () => [
      task,
      { ...task, id: "cron_b", name: "Nightly wrap-up", runs: [] },
    ]);
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
    expect(container.querySelector("[data-cron-history-panel]")).not.toBeNull();
    await act(async () =>
      buttons()
        .find((button) => button.textContent?.includes("Nightly wrap-up"))!
        .click(),
    );
    const panel = container.querySelector("[data-cron-history-panel]")!;
    expect(panel.textContent).toContain("Nightly wrap-up");
    expect(panel.textContent).toContain("No runs yet.");
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
