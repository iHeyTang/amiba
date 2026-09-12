import { expect, it, vi } from "vitest";
import { createDirectoryFlow } from "./directory-flow.js";
function fixture() {
  let entries: unknown[] = [];
  const listeners = new Set<() => void>();
  const slots = {
    entriesOfSlot: () => entries,
    subscribe(_name: string, fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return {
    slots,
    replace(next: unknown[]) {
      entries = next;
      for (const fn of listeners) fn();
    },
    listeners,
  };
}
it("preserves the native chooser and initial path when unoccupied", async () => {
  const f = fixture();
  const adopt = vi.fn();
  const native = vi.fn().mockResolvedValue("/chosen");
  const flow = createDirectoryFlow(f.slots, "flow", adopt);
  expect(await flow.choose("/initial", native)).toBe("/chosen");
  expect(native).toHaveBeenCalledWith("/initial");
  expect(adopt).not.toHaveBeenCalled();
  expect(flow.getSnapshot().owner.open).toBe(false);
  flow.dispose();
});
it("adopts exactly once and stays busy until Host acceptance", async () => {
  const f = fixture();
  f.replace([{}]);
  let accept!: () => void;
  const adopt = vi.fn(() => new Promise<void>((resolve) => (accept = resolve)));
  const flow = createDirectoryFlow(f.slots, "flow", adopt);
  const selected = flow.choose();
  const owner = flow.getSnapshot().owner;
  owner.onPicked("/chosen");
  owner.onPicked("/duplicate");
  expect(flow.getSnapshot().owner.busy).toBe(true);
  await Promise.resolve();
  expect(adopt).toHaveBeenCalledTimes(1);
  expect(adopt).toHaveBeenCalledWith("/chosen");
  accept();
  expect(await selected).toBe("/chosen");
  expect(flow.getSnapshot().owner.open).toBe(false);
  flow.dispose();
});
it("cancels on replacement and ignores stale picker callbacks", async () => {
  const f = fixture();
  f.replace([{}]);
  const adopt = vi.fn();
  const flow = createDirectoryFlow(f.slots, "flow", adopt);
  const first = flow.choose();
  const old = flow.getSnapshot().owner;
  f.replace([{}]);
  expect(await first).toBeNull();
  const second = flow.choose();
  old.onPicked("/old");
  expect(adopt).not.toHaveBeenCalled();
  flow.getSnapshot().owner.onCancel();
  expect(await second).toBeNull();
  flow.dispose();
  expect(f.listeners.size).toBe(0);
});
it("reports picker and Host errors through the caller's existing error surface", async () => {
  const f = fixture();
  f.replace([{}]);
  const flow = createDirectoryFlow(f.slots, "flow", async () => {
    throw new Error("Host rejected path");
  });
  const first = flow.choose();
  const rejected = expect(first).rejects.toThrow("listing denied");
  flow.getSnapshot().owner.onError("listing denied");
  await rejected;
  const second = flow.choose();
  const hostRejected = expect(second).rejects.toThrow("Host rejected path");
  flow.getSnapshot().owner.onPicked("/path");
  await hostRejected;
  flow.dispose();
});
it("does not apply late adoption after cancellation or disposal", async () => {
  const f = fixture();
  f.replace([{}]);
  let accept!: () => void;
  const flow = createDirectoryFlow(
    f.slots,
    "flow",
    () => new Promise<void>((resolve) => (accept = resolve)),
  );
  const first = flow.choose();
  flow.getSnapshot().owner.onPicked("/path");
  await Promise.resolve();
  flow.dispose();
  expect(await first).toBeNull();
  accept();
  await Promise.resolve();
  expect(flow.getSnapshot().available).toBe(false);
  expect(await flow.choose()).toBeNull();
});
