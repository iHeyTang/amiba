import { expect, it, vi } from "vitest";
import { createLauncher } from "./launcher.js";
it("defers automatic prompts for this client run but allows a manual revisit", () => {
  const launcher = createLauncher();
  const done = vi.fn();
  const notify = vi.fn();
  const off = launcher.subscribe(notify);
  launcher.open({ revisit: false, done });
  expect(launcher.getSnapshot()?.revisit).toBe(false);
  launcher.close();
  expect(done).toHaveBeenCalledOnce();
  const next = vi.fn();
  launcher.open({ revisit: false, done: next });
  expect(launcher.getSnapshot()).toBeNull();
  expect(next).toHaveBeenCalledOnce();
  launcher.open({ revisit: true, done: () => {} });
  expect(launcher.getSnapshot()?.revisit).toBe(true);
  off();
});
it("supports StrictMode teardown/remount without losing first-run ownership", () => {
  const launcher = createLauncher();
  const done = vi.fn();
  const release = launcher.open({ revisit: false, done });
  release();
  launcher.open({ revisit: false, done });
  release();
  expect(launcher.getSnapshot()).not.toBeNull();
  expect(done).not.toHaveBeenCalled();
});
