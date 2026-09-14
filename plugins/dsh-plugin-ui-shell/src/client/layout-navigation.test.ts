import { describe, expect, it } from "vitest";
import { LayoutNavigation } from "./layout-navigation.js";

describe("layout navigation cancellation", () => {
  it("supersedes pending navigation without cancelling the replacement", () => {
    const navigation = new LayoutNavigation();
    const first = navigation.beginNavigation();
    expect(first.aborted).toBe(false);
    const second = navigation.beginNavigation();
    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
    navigation.commit();
    expect(second.aborted).toBe(true);
    expect(navigation.beginNavigation().aborted).toBe(false);
  });
  it("does not allow a late callback to commit after a newer navigation", async () => {
    const navigation = new LayoutNavigation();
    const first = navigation.beginNavigation();
    const committed: string[] = [];
    const delayed = Promise.resolve().then(() => { if (!first.aborted) committed.push("stale"); });
    navigation.commit();
    committed.push("current");
    await delayed;
    expect(committed).toEqual(["current"]);
  });
  it("aborts pending and future requests after its root owner is disposed", () => {
    const navigation = new LayoutNavigation();
    const pending = navigation.beginNavigation();
    navigation.dispose();
    expect(pending.aborted).toBe(true);
    expect(navigation.beginNavigation().aborted).toBe(true);
  });
});
