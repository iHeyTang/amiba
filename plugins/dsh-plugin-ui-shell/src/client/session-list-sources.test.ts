import { describe, expect, it, vi } from "vitest";

import {
  createSessionBadgesSource,
  createSessionFiltersSource,
  createSlotContributionsSource,
  type SlotContributionEntry,
  type SlotContributionsCtx,
} from "./session-list-sources.js";

/** A fake `ctx.slots` good enough to drive the source without DSH. */
function fakeSlots(initialEntries: SlotContributionEntry[] = []) {
  let entries = initialEntries;
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    ctx: {
      getVersion: () => version,
      entriesOfSlot: () => entries,
      subscribe: (_name: string, listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    } satisfies SlotContributionsCtx,
    setEntries(next: SlotContributionEntry[]) {
      entries = next;
      version += 1;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

interface Row {
  id: string;
  order: number;
  label: string;
}

function mapRow(entry: SlotContributionEntry): Row | null {
  const id = entry.options.id ?? "";
  if (!id) return null;
  return { id, order: entry.options.order ?? 0, label: id };
}

describe("createSlotContributionsSource", () => {
  it("projects entries into contributions sorted by order", () => {
    const { ctx } = fakeSlots([
      { options: { id: "b", order: 2 } },
      { options: { id: "a", order: 1 } },
      { options: { id: "c", order: 0 } },
    ]);
    const source = createSlotContributionsSource(ctx, "test.slot", mapRow);
    expect(source.getSnapshot().map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("drops entries mapEntry rejects (e.g. missing id)", () => {
    const { ctx } = fakeSlots([
      { options: { id: "" } },
      { options: { id: "keep" } },
    ]);
    const source = createSlotContributionsSource(ctx, "test.slot", mapRow);
    expect(source.getSnapshot().map((r) => r.id)).toEqual(["keep"]);
  });

  it("caches the snapshot until the slot version changes", () => {
    const fake = fakeSlots([{ options: { id: "a", order: 0 } }]);
    const source = createSlotContributionsSource(fake.ctx, "test.slot", mapRow);
    const first = source.getSnapshot();
    expect(source.getSnapshot()).toBe(first);

    fake.setEntries([
      { options: { id: "a", order: 0 } },
      { options: { id: "b", order: 1 } },
    ]);
    const second = source.getSnapshot();
    expect(second).not.toBe(first);
    expect(second.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("wires subscribe to the underlying slots.subscribe", () => {
    const fake = fakeSlots();
    const source = createSlotContributionsSource(fake.ctx, "test.slot", mapRow);
    const listener = vi.fn();
    const dispose = source.subscribe(listener);
    expect(fake.listenerCount()).toBeGreaterThanOrEqual(1);
    fake.setEntries([{ options: { id: "x", order: 0 } }]);
    expect(listener).toHaveBeenCalled();
    dispose();
  });

  it("a contribution's own subscribe firing yields a new snapshot identity and notifies", () => {
    let contributionListener: (() => void) | undefined;
    const contributionDispose = vi.fn();
    const { ctx } = fakeSlots([
      {
        options: { id: "a", order: 0 },
        inject: () => ({
          subscribe: (listener: () => void) => {
            contributionListener = listener;
            return contributionDispose;
          },
        }),
      },
    ]);
    const source = createSlotContributionsSource(ctx, "test.slot", mapRow);
    const outerListener = vi.fn();
    const dispose = source.subscribe(outerListener);
    expect(contributionListener).toBeTypeOf("function");

    const before = source.getSnapshot();
    contributionListener?.();
    expect(outerListener).toHaveBeenCalledTimes(1);
    const after = source.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));

    dispose();
    expect(contributionDispose).toHaveBeenCalled();
  });

  it("re-wires contribution subscriptions when entries are re-enumerated", () => {
    const disposeA = vi.fn();
    const subscribeB = vi.fn((listener: () => void) => {
      void listener;
      return vi.fn();
    });
    const fake = fakeSlots([
      {
        options: { id: "a", order: 0 },
        inject: () => ({ subscribe: () => disposeA }),
      },
    ]);
    const source = createSlotContributionsSource(fake.ctx, "test.slot", mapRow);
    const dispose = source.subscribe(vi.fn());
    expect(disposeA).not.toHaveBeenCalled();

    fake.setEntries([
      { options: { id: "b", order: 0 }, inject: () => ({ subscribe: subscribeB }) },
    ]);
    expect(disposeA).toHaveBeenCalledTimes(1);
    expect(subscribeB).toHaveBeenCalledTimes(1);

    dispose();
  });
});

describe("createSessionBadgesSource", () => {
  it("reads the resolve face and falls back to id as the label", () => {
    const resolve = vi.fn(() => true);
    const { ctx } = fakeSlots([
      {
        options: { id: "steward", order: 5, label: "Steward" },
        inject: () => ({ resolve }),
      },
    ]);
    const source = createSessionBadgesSource(ctx);
    const [row] = source.getSnapshot();
    expect(row).toMatchObject({ id: "steward", order: 5, label: "Steward" });
    expect(row?.resolve).toBe(resolve);
  });

  it("drops an entry with no resolve function", () => {
    const { ctx } = fakeSlots([
      { options: { id: "broken" }, inject: () => ({}) },
      { options: { id: "no-inject" } },
    ]);
    const source = createSessionBadgesSource(ctx);
    expect(source.getSnapshot()).toEqual([]);
  });
});

describe("createSessionFiltersSource", () => {
  it("reads the test face", () => {
    const test = vi.fn(() => false);
    const { ctx } = fakeSlots([
      {
        options: { id: "adopted", order: 1, label: "Adopted" },
        inject: () => ({ test }),
      },
    ]);
    const source = createSessionFiltersSource(ctx);
    const [row] = source.getSnapshot();
    expect(row).toMatchObject({ id: "adopted", order: 1, label: "Adopted" });
    expect(row?.test).toBe(test);
  });

  it("drops an entry with no test function", () => {
    const { ctx } = fakeSlots([{ options: { id: "broken" }, inject: () => ({}) }]);
    const source = createSessionFiltersSource(ctx);
    expect(source.getSnapshot()).toEqual([]);
  });
});
