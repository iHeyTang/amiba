// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { SessionLogDownloadState } from "@deepseek-ai/dsh-session-log-export/client";
import { SessionExportDialog } from "./session-export.js";

afterEach(cleanup);

it("adds no header content while idle and follows the official export controller without starting another download", () => {
  document.documentElement.lang = "en";
  let snapshot: SessionLogDownloadState = { bySession: {} };
  const listeners = new Set<() => void>();
  const store = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next: SessionLogDownloadState) => {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
  const dismiss = vi.fn((sessionId: SessionId) =>
    store.set({
      bySession: {
        [sessionId]: { open: false, status: "success", error: null },
      },
    }),
  );
  const { container } = render(
    <SessionExportDialog
      sessionId={"session-a" as SessionId}
      controller={{ store, dismiss }}
    />,
  );
  expect(container.innerHTML).toBe("");
  expect(screen.queryByRole("button")).toBeNull();
  act(() =>
    store.set({
      bySession: {
        "session-b": { open: true, status: "success", error: null },
      },
    }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() =>
    store.set({
      bySession: {
        "session-a": { open: true, status: "downloading", error: null },
      },
    }),
  );
  expect(screen.getByRole("dialog").textContent).toContain(
    "Preparing session log",
  );
  act(() =>
    store.set({
      bySession: {
        "session-a": {
          open: true,
          status: "error",
          error: "Archive unavailable",
        },
      },
    }),
  );
  expect(screen.getByRole("dialog").textContent).toContain(
    "Archive unavailable",
  );
  fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
  expect(dismiss).toHaveBeenCalledWith("session-a");
  expect(screen.queryByRole("dialog")).toBeNull();
});
