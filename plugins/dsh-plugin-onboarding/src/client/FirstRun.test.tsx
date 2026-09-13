import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { FirstRun } from "./FirstRun.js";
import { createLauncher } from "./launcher.js";

afterEach(cleanup);
function fixture(hasConfiguredProvider: () => Promise<boolean>) {
  const launcher = createLauncher();
  const complete = vi.fn();
  const props = { launcher, complete, openSection: vi.fn(), hasConfiguredProvider, stepId: "amiba-first-run" };
  return { launcher, complete, props };
}
it("opens the guide only after confirming no provider is configured", async () => {
  let resolve!: (configured: boolean) => void;
  const { launcher, complete, props } = fixture(() => new Promise(r => { resolve = r; }));
  render(<FirstRun {...props} />);
  expect(launcher.getSnapshot()).toBeNull();
  resolve(false);
  await waitFor(() => expect(launcher.getSnapshot()?.revisit).toBe(false));
  expect(complete).not.toHaveBeenCalled();
  launcher.close();
  expect(complete).toHaveBeenCalledOnce();
});
it("skips the guide for an existing provider even without onboarding history", async () => {
  const { launcher, complete, props } = fixture(async () => true);
  render(<FirstRun {...props} />);
  await waitFor(() => expect(complete).toHaveBeenCalledOnce());
  expect(launcher.getSnapshot()).toBeNull();
});
it("does not misclassify a failed provider lookup as a new user", async () => {
  const { launcher, complete, props } = fixture(async () => { throw new Error("offline"); });
  render(<FirstRun {...props} />);
  await waitFor(() => expect(complete).toHaveBeenCalledOnce());
  expect(launcher.getSnapshot()).toBeNull();
});
it("does not open a stale guide after unmount", async () => {
  let resolve!: (configured: boolean) => void;
  const { launcher, complete, props } = fixture(() => new Promise(r => { resolve = r; }));
  const view = render(<FirstRun {...props} />);
  view.unmount();
  resolve(false);
  await Promise.resolve();
  expect(launcher.getSnapshot()).toBeNull();
  expect(complete).not.toHaveBeenCalled();
});
